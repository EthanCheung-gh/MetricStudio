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
from backend.core.llm import (
    activate_profile,
    chat,
    create_profile,
    delete_profile,
    list_profiles,
    load_config,
    probe_llm,
    save_config,
    update_profile,
)
from backend.core.privacy import prepare_for_llm, sensitive_columns
from backend.core.qa_agent import run_agent
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


class LLMProfilePayload(LLMConfig):
    name: str = ""


class LLMTestRequest(BaseModel):
    base_url: str | None = None
    model: str | None = None
    api_key: str | None = None


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


def _question_tokens(question: str) -> list[str]:
    """Cheap tokenizer: latin/number words plus Chinese character bigrams."""
    text = (question or "").casefold()
    tokens: set[str] = set()
    for word in re.findall(r"[a-z0-9_]+", text):
        if len(word) >= 2:
            tokens.add(word)
    for segment in re.findall(r"[\u4e00-\u9fff]{2,}", text):
        if len(segment) <= 4:
            tokens.add(segment)
        else:
            tokens.update(segment[i : i + 2] for i in range(len(segment) - 1))
    return list(tokens)[:12]


def _relevant_sample_rows(df: Any, question: str, limit: int = 5) -> Any:
    """Pick sample rows whose text matches question keywords, else head(limit)."""
    tokens = _question_tokens(question)
    if not tokens or df.empty:
        return df.head(limit)
    window = df.head(1000)
    row_strings = window.astype(str).agg(" | ".join, axis=1)
    scores = row_strings.apply(lambda text: sum(1 for token in tokens if token in text))
    hits = scores[scores > 0].sort_values(ascending=False).head(limit).index
    if len(hits) == 0:
        return df.head(limit)
    return window.loc[sorted(hits)]


def _categorical_line(df: Any, column: str) -> str | None:
    """Adaptive summary line for one non-numeric column (D upgrade)."""
    series = df[column].dropna()
    if series.empty:
        return f"{column}: all values missing"
    cardinality = int(series.nunique())
    if cardinality <= 50:
        counts = series.value_counts().head(5)
        total = len(series)
        parts = ", ".join(f"{index}={int(value)}({value / total:.0%})" for index, value in counts.items())
        return f"{column} (categorical, {cardinality} distinct): {parts}"
    examples = ", ".join(str(value)[:40] for value in series.unique()[:3])
    return f"{column} (high-cardinality, {cardinality} distinct): e.g. {examples}"


def _datetime_range_line(df: Any, column: str) -> str | None:
    """Return a range line when the column parses as datetime (>=80%)."""
    series = df[column].dropna()
    if series.empty:
        return None
    sample = series.head(100)
    parsed = pd.to_datetime(sample, errors="coerce", format="mixed")
    if parsed.notna().mean() < 0.8:
        return None
    full = pd.to_datetime(series, errors="coerce", format="mixed")
    return f"{column} (datetime): from={full.min()}, to={full.max()}"


def _build_data_context(dataset: Any, df: Any, question: str = "") -> str:
    """Adaptive overview: richer per-dtype facts and question-relevant samples."""
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
    for column in df.columns:
        if column in numeric.columns:
            continue
        range_line = _datetime_range_line(df, str(column))
        if range_line:
            lines.append(range_line)
            continue
        line = _categorical_line(df, str(column))
        if line:
            lines.append(line)
    sample = _relevant_sample_rows(df, question)
    lines.append("Sample rows (closest to the question):" if question else "Sample rows:")
    for _, row in sample.iterrows():
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


# --- v1.2.0 iterative agent ---------------------------------------------------
# /ask is orchestrated by backend.core.qa_agent: an iterative tool loop with
# numbered, citable facts. See qa_agent for the degradation ladder.

@router.post("/ask")
async def nl_ask(request: NLAskRequest):
    try:
        dataset = session.get(request.dataset_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    df = _ask_dataframe(dataset, request)
    context = _build_data_context(dataset, df, request.question)
    history = [turn.model_dump() for turn in request.history]
    try:
        agent = run_agent(request.question, df, context, history)
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"LLM unavailable: {exc}") from exc
    config = load_config()
    evidence = _build_data_evidence(dataset, df, request.snapshot_id)
    fact_source: dict[str, str] = {"datasetId": dataset.id}
    if request.snapshot_id:
        fact_source["snapshotId"] = request.snapshot_id
    evidence.extend(
        {"id": f"fact:{fact['n']}", "kind": "tool", "detail": f"[{fact['n']}] {fact['tool']}: {fact['detail']}", "source": dict(fact_source)}
        for fact in agent["facts"]
    )
    return {
        "answer": agent["answer"],
        "evidence": evidence[:20],
        "facts": agent["facts"],
        "followups": agent["followups"],
        "clarify": agent["clarify"],
        "rounds_used": agent["rounds_used"],
        "tool_call_count": agent["tool_call_count"],
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


def _profile_view(profile: dict[str, Any]) -> dict[str, Any]:
    api_key = profile.get("api_key", "")
    return {
        "id": profile["id"],
        "name": profile["name"],
        "base_url": profile["base_url"],
        "model": profile["model"],
        "provider": profile["provider"],
        "data_scope": profile["data_scope"],
        "has_api_key": bool(api_key),
        "api_key_hint": api_key[-4:] if api_key else "",
    }


def _store_view(store: dict[str, Any]) -> dict[str, Any]:
    return {
        "active_id": store["active"],
        "profiles": [_profile_view(p) for p in store["profiles"]],
    }


@router.get("/profiles")
async def get_llm_profiles():
    return _store_view(list_profiles())


@router.post("/profiles")
async def create_llm_profile(payload: LLMProfilePayload):
    store = create_profile(payload.model_dump())
    store_view = _store_view(store)
    return {**store_view, "created_id": store_view["active_id"]}


@router.put("/profiles/{profile_id}")
async def update_llm_profile(profile_id: str, payload: LLMProfilePayload):
    try:
        store = update_profile(profile_id, payload.model_dump(), clear_api_key=payload.clear_api_key)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return _store_view(store)


@router.delete("/profiles/{profile_id}")
async def delete_llm_profile(profile_id: str):
    try:
        store = delete_profile(profile_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return _store_view(store)


@router.post("/profiles/{profile_id}/activate")
async def activate_llm_profile(profile_id: str):
    try:
        store = activate_profile(profile_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return _store_view(store)


@router.post("/test")
async def test_llm_connection(request: LLMTestRequest):
    """Probe an endpoint with a tiny chat request (no config is written)."""
    active = load_config()
    base_url = (request.base_url or active.get("base_url", "")).strip()
    model = (request.model or active.get("model", "")).strip()
    api_key = request.api_key.strip() if request.api_key else active.get("api_key", "")
    if not base_url or not model:
        raise HTTPException(status_code=422, detail="base_url and model are required")
    ok, latency_ms, error = probe_llm(base_url, model, api_key)
    return {"ok": ok, "latency_ms": latency_ms, "error": error}
