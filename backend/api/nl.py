"""Natural-language transform: query -> validated operation chain via LLM."""

from __future__ import annotations

import json
import re
from datetime import datetime, timezone
from typing import Any, Literal

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field, field_validator

import pandas as pd

from backend.api.chart import _filter_by_filters
from backend.core.llm import chat, load_config, save_config
from backend.core.privacy import prepare_for_llm, sensitive_columns
from backend.core.session import session
from backend.models.chart import FilterSpec

router = APIRouter(prefix="/api/v1/nl", tags=["nl"])

VALID_OP_TYPES = {
    "filter", "sort", "dropna", "fillna", "rename", "dtype",
    "compute", "pivot", "melt", "join", "dedupe", "clip", "parse_numeric",
}

OPERATORS_DESC = """Available transform operators (each is an object with "type" and "params"):
- filter: {column, operator(eq|ne|gt|gte|lt|lte|contains|startswith|endswith), value}
- sort: {column, ascending(bool)}
- dropna: {columns?(optional list)}
- fillna: {column, value}
- rename: {mappings: {old_name: new_name}}
- dtype: {mappings: {column: "float"|"int"|"string"}}
- compute: {name, expression(pandas eval)}
- pivot: {index, columns, values, aggfunc(sum|mean|count|min|max)}
- melt: {id_vars, value_vars?, var_name?, value_name?}
- join: {right_dataset_id, on?|left_on?+right_on?, how(inner|left|right|outer)}
- dedupe: {}
- clip: {column, min?, max?}
- parse_numeric: {column}"""


class NLTransformRequest(BaseModel):
    dataset_id: str
    query: str


class NLAskTurn(BaseModel):
    question: str
    answer: str


class NLAskRequest(BaseModel):
    dataset_id: str
    question: str
    history: list[NLAskTurn] = Field(default_factory=list)
    snapshot_id: str | None = None
    filters: list[FilterSpec] = Field(default_factory=list)


class LLMConfig(BaseModel):
    base_url: str
    model: str
    api_key: str = ""
    provider: Literal["local", "cloud"] = "local"
    data_scope: Literal["all", "redact_sensitive", "exclude_sensitive"] = "all"
    clear_api_key: bool = False

    @field_validator("base_url", "model")
    @classmethod
    def require_value(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("value must not be empty")
        return value


class ExplainChartRequest(BaseModel):
    dataset_id: str
    encoding: dict[str, Any] = {}


def _build_prompt(dataset: Any, query: str) -> str:
    columns = [(c.name, c.dtype) for c in dataset.meta.columns]
    if load_config().get("data_scope") == "exclude_sensitive":
        protected = set(sensitive_columns([name for name, _ in columns]))
        columns = [(name, dtype) for name, dtype in columns if name not in protected]
    col_desc = ", ".join(f"{name}({dtype})" for name, dtype in columns)
    return (
        f"Dataset columns: {col_desc}\n\n"
        f"{OPERATORS_DESC}\n\n"
        "User request: " + query + "\n\n"
        "Respond with ONLY a JSON array of operations, e.g. "
        '[{"type":"filter","params":{"column":"value","operator":"gt","value":100}}]. '
        "No prose, no markdown fences."
    )


def _parse_chain(text: str) -> list[dict[str, Any]]:
    """Extract a JSON array from the LLM text (tolerates markdown fences)."""
    text = text.strip()
    # strip ```json ... ``` fences if present
    fenced = re.search(r"```(?:json)?\s*(\[.*?\])\s*```", text, re.DOTALL)
    if fenced:
        text = fenced.group(1)
    start = text.find("[")
    end = text.rfind("]")
    if start < 0 or end <= start:
        raise ValueError("LLM response did not contain a JSON array")
    try:
        parsed = json.loads(text[start : end + 1])
    except json.JSONDecodeError as exc:
        raise ValueError(f"Invalid JSON from LLM: {exc}") from exc
    if not isinstance(parsed, list):
        raise ValueError("LLM response must be a JSON array")
    return parsed


def _validate_ops(ops: list[dict[str, Any]]) -> None:
    if not ops:
        raise ValueError("Empty operation chain")
    for op in ops:
        if not isinstance(op, dict):
            raise ValueError(f"Operation must be an object: {op!r}")
        op_type = op.get("type")
        if op_type not in VALID_OP_TYPES:
            raise ValueError(f"Invalid operation type: {op_type!r}")
        params = op.get("params")
        if not isinstance(params, dict):
            raise ValueError(f"Operation {op_type!r} must have a params object")


@router.post("/transform")
async def nl_transform(request: NLTransformRequest):
    dataset = session.get(request.dataset_id)
    prompt = _build_prompt(dataset, request.query)
    try:
        raw = chat([{"role": "user", "content": prompt}])
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"LLM unavailable: {exc}") from exc

    try:
        ops = _parse_chain(raw)
        _validate_ops(ops)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=f"LLM output invalid: {exc}") from exc

    return {"operations": ops, "raw": raw}


def _build_data_context(dataset: Any, df: Any) -> str:
    from backend.core.insights import generate_insights

    df, _ = prepare_for_llm(df, load_config())
    lines = [f"Dataset overview: {len(df)} rows × {len(df.columns)} columns"]
    lines.append("Columns: " + ", ".join(f"{name}({dtype})" for name, dtype in df.dtypes.items()))
    if df.empty:
        lines.append("No rows matched the selected context.")
        return "\n".join(lines)
    numeric = df.select_dtypes(include="number")
    if not numeric.empty:
        desc = numeric.describe().T
        for col in desc.index:
            row = desc.loc[col]
            lines.append(
                f"{col}: count={int(row['count'])}, missing={int(df[col].isna().sum())}, "
                f"min={row['min']}, max={row['max']}, mean={row['mean']:.2f}, median={df[col].median():.2f}"
            )
    lines.append("Sample rows:")
    for _, row in df.head(5).iterrows():
        lines.append("  " + ", ".join(f"{key}={value}" for key, value in row.items()))
    insights = generate_insights(df)
    if insights:
        lines.append("Insights: " + "; ".join(item["text"] for item in insights))
    return "\n".join(lines)


def _build_data_evidence(dataset: Any, df: Any, snapshot_id: str | None) -> list[dict[str, Any]]:
    """Build deterministic references shown with an answer."""
    from backend.core.insights import generate_insights

    df, _ = prepare_for_llm(df, load_config())
    source: dict[str, str] = {"datasetId": dataset.id}
    if snapshot_id:
        source["snapshotId"] = snapshot_id
    evidence: list[dict[str, Any]] = [
        {"id": "schema", "kind": "schema", "detail": ", ".join(f"{name} ({dtype})" for name, dtype in df.dtypes.items()), "source": source},
        {"id": "overview", "kind": "overview", "detail": f"{len(df)} rows × {len(df.columns)} columns", "source": source},
    ]
    if df.empty:
        return evidence
    numeric = df.select_dtypes(include="number")
    if not numeric.empty:
        desc = numeric.describe().T
        for col in desc.index:
            row = desc.loc[col]
            evidence.append(
                {
                    "id": f"statistics:{col}",
                    "kind": "statistics",
                    "detail": (
                        f"{col}: count={int(row['count'])}, missing={int(df[col].isna().sum())}, "
                        f"min={row['min']}, max={row['max']}, "
                        f"mean={row['mean']:.2f}, median={df[col].median():.2f}"
                    ),
                    "source": {**source, "field": str(col)},
                }
            )
    for index, row in df.head(3).iterrows():
        values = ", ".join(f"{key}={value}" for key, value in row.items())
        evidence.append({"id": f"sample:{index}", "kind": "sample", "detail": f"row {index}: {values}", "source": {**source, "row": str(index)}})
    for insight_index, insight in enumerate(generate_insights(df)[:3]):
        evidence.append({"id": f"insight:{insight_index}", "kind": "insight", "detail": str(insight["text"]), "source": source})
    return evidence[:12]


def _ask_dataframe(dataset: Any, request: NLAskRequest) -> Any:
    df = dataset.df
    if request.snapshot_id:
        try:
            snapshot = session.get_snapshot(request.snapshot_id)
        except KeyError as exc:
            raise HTTPException(status_code=404, detail=str(exc)) from exc
        if snapshot["dataset_id"] != dataset.id:
            raise HTTPException(status_code=400, detail="Snapshot does not belong to the requested dataset")
        try:
            df = session.snapshot_df(request.snapshot_id)
        except ValueError as exc:
            raise HTTPException(status_code=409, detail=str(exc)) from exc
    return _filter_by_filters(df, request.filters) if request.filters else df


# --- v1.1.0 tool calling -----------------------------------------------------
# A lightweight, provider-agnostic tool protocol: a short "router" call asks
# the LLM which deterministic tools it needs; the backend executes them and
# feeds the exact results into the main prompt. Any failure degrades silently
# to the static-overview path (v1.0.1 behavior).

_TOOL_SPEC = """Available tools (deterministic, executed on the real data):
- {"name": "row_count", "args": {}}
- {"name": "column_stats", "args": {"column": "<numeric column>"}}
- {"name": "distinct_count", "args": {"column": "<column>"}}

Question: """

_TOOL_LIMIT = 3


def _extract_json_object(text: str) -> dict[str, Any] | None:
    start = text.find("{")
    end = text.rfind("}")
    if start < 0 or end <= start:
        return None
    try:
        parsed = json.loads(text[start : end + 1])
    except json.JSONDecodeError:
        return None
    return parsed if isinstance(parsed, dict) else None


def _run_tool(df: Any, name: str, args: dict[str, Any]) -> str | None:
    if name == "row_count":
        return f"row_count = {len(df)}"
    if name == "column_stats":
        column = str(args.get("column", ""))
        if column not in df.columns or not pd.api.types.is_numeric_dtype(df[column]):
            return None
        series = df[column].dropna()
        if series.empty:
            return f"column_stats({column}): all values missing"
        return (
            f"column_stats({column}): count={len(series)}, missing={int(df[column].isna().sum())}, "
            f"min={series.min()}, max={series.max()}, mean={series.mean():.4f}, median={series.median()}"
        )
    if name == "distinct_count":
        column = str(args.get("column", ""))
        if column not in df.columns:
            return None
        return f"distinct_count({column}) = {int(df[column].nunique(dropna=True))}"
    return None


def _route_and_run_tools(question: str, df: Any) -> list[dict[str, Any]]:
    """Ask the LLM which tools the question needs, execute them, return facts.

    Never raises: any routing/parsing/execution failure yields an empty list
    so the ask flow falls back to the static data context.
    """
    try:
        raw = chat([
            {"role": "user", "content": (
                "You are a router for a data-analysis assistant. Decide which tools are "
                "needed to answer the question factually. Respond with ONLY a JSON object: "
                '{"tools": [<tool objects>]} with an empty array when none apply. No prose.\n\n'
                + _TOOL_SPEC + question
            )}
        ])
    except Exception:
        return []
    parsed = _extract_json_object(raw)
    if not parsed or not isinstance(parsed.get("tools"), list):
        return []
    facts: list[dict[str, Any]] = []
    for tool in parsed["tools"][:_TOOL_LIMIT]:
        if not isinstance(tool, dict):
            continue
        name = str(tool.get("name", ""))
        args = tool.get("args") if isinstance(tool.get("args"), dict) else {}
        try:
            detail = _run_tool(df, name, args)
        except Exception:
            detail = None
        if detail:
            facts.append({"id": f"tool:{name}", "kind": "tool", "detail": detail})
    return facts


@router.post("/ask")
async def nl_ask(request: NLAskRequest):
    try:
        dataset = session.get(request.dataset_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    df = _ask_dataframe(dataset, request)
    context = _build_data_context(dataset, df)
    tool_facts = _route_and_run_tools(request.question, df)
    facts_block = ""
    if tool_facts:
        lines = "\n".join(f"- {fact['detail']}" for fact in tool_facts)
        facts_block = f"Computed facts (exact, may be cited directly):\n{lines}\n\n"
    history = request.history[-8:]
    conversation = "\n".join(
        f"User: {turn.question}\nAssistant: {turn.answer}" for turn in history
    )
    older = request.history[:-8]
    summary_block = ""
    if older:
        summary = "\n".join(f"Q: {turn.question}\nA: {turn.answer}" for turn in older)
        summary_block = f"Earlier conversation summary (truncated):\n{summary[:2000]}\n\n"
    history_block = f"{summary_block}Previous conversation:\n{conversation}\n\n" if conversation or summary_block else ""
    prompt = (
        "You are analyzing a dataset. Use ONLY the data context below; never invent numbers. "
        "Treat previous answers as conversation context, not as evidence.\n\n"
        f"Data context:\n{context}\n\n"
        f"{facts_block}"
        f"{history_block}"
        f"Question: {request.question}\n\n"
        "请用简体中文简洁回答，引用上下文中的具体数字；如果数据不足，请明确说明。"
    )
    try:
        answer = chat([{"role": "user", "content": prompt}])
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"LLM unavailable: {exc}") from exc
    config = load_config()
    evidence = _build_data_evidence(dataset, df, request.snapshot_id)
    evidence.extend(tool_facts)
    return {
        "answer": answer,
        "evidence": evidence[:15],
        "model": config.get("model", "unknown"),
        "generated_at": datetime.now(timezone.utc).isoformat(),
    }


@router.post("/narrate")
async def nl_narrate(payload: dict):
    """Generate a Chinese analysis narrative from the dataset insights."""
    dataset_id = payload.get("dataset_id")
    if not dataset_id:
        raise HTTPException(status_code=400, detail="dataset_id is required")
    dataset = session.get(dataset_id)
    from backend.core.insights import generate_insights

    protected_df, _ = prepare_for_llm(dataset.df, load_config())
    insights = generate_insights(protected_df)
    if not insights:
        return {"narrative": ""}
    insight_texts = "\n".join("- " + i["text"] for i in insights)
    prompt = (
        "以下是数据集的分析洞察：\n" + insight_texts +
        "\n\n请用简体中文撰写一段 2-3 句的连贯分析叙述，基于上述洞察并引用具体数字，不要编造。"
    )
    try:
        narrative = chat([{"role": "user", "content": prompt}])
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"LLM unavailable: {exc}") from exc
    return {"narrative": narrative}


def _describe_encoding(enc: dict[str, Any]) -> str:
    """Human-readable summary of a chart encoding for the LLM prompt."""
    if not enc:
        return "(no chart config provided)"
    parts = [f"chart type: {enc.get('chartType', '?')}"]
    x = enc.get("x")
    if isinstance(x, dict) and x.get("field"):
        parts.append(f"x = {x['field']}")
    yfs = enc.get("yFields") or []
    if yfs:
        parts.append(
            "y = "
            + ", ".join(
                f"{y.get('field')}({y.get('aggregate') or 'raw'})" for y in yfs if isinstance(y, dict)
            )
        )
    color = enc.get("color")
    if isinstance(color, dict) and color.get("field"):
        parts.append(f"color = {color['field']}")
    return "; ".join(parts)


@router.post("/explain-chart")
async def explain_chart(request: ExplainChartRequest):
    """Generate a Chinese natural-language interpretation of a chart."""
    try:
        dataset = session.get(request.dataset_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    context = _build_data_context(dataset, dataset.df)
    chart_desc = _describe_encoding(request.encoding)
    prompt = (
        "用户在一个数据分析工具中创建了一张图表。请基于下面的数据上下文与图表配置，"
        "用简体中文写 2-4 句解读：主要趋势 / 分布 / 异常，以及一个值得进一步探索的方向。"
        "只基于提供的数据，引用具体数字，不要编造。\n\n"
        f"数据上下文:\n{context}\n\n"
        f"图表配置:\n{chart_desc}\n\n"
        "解读:"
    )
    try:
        explanation = chat([{"role": "user", "content": prompt}])
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"LLM unavailable: {exc}") from exc
    return {"explanation": explanation}


@router.get("/config")
async def get_llm_config():
    config = load_config()
    return {**config, "api_key": ""}


@router.post("/config")
async def set_llm_config(config: LLMConfig):
    data = config.model_dump(exclude={"clear_api_key"})
    data["api_key"] = data["api_key"].strip()
    if config.clear_api_key:
        data["api_key"] = ""
    elif not data["api_key"]:
        data["api_key"] = load_config().get("api_key", "")
    save_config(data)
    return {**data, "api_key": ""}
