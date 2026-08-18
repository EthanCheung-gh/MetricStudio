"""Natural-language transform: query -> validated operation chain via LLM."""

from __future__ import annotations

import json
import re
from typing import Any

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, field_validator

from backend.core.llm import chat, load_config, save_config
from backend.core.session import session

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


class NLAskRequest(BaseModel):
    dataset_id: str
    question: str


class LLMConfig(BaseModel):
    base_url: str
    model: str
    api_key: str = ""
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


def _build_data_context(dataset: Any) -> str:
    from backend.core.insights import generate_insights

    df = dataset.df
    lines: list[str] = []
    lines.append("Columns: " + ", ".join(f"{c.name}({c.dtype})" for c in dataset.meta.columns))
    numeric = df.select_dtypes(include="number")
    if not numeric.empty:
        desc = numeric.describe().T
        for col in desc.index:
            row = desc.loc[col]
            lines.append(
                f"{col}: min={row['min']}, max={row['max']}, mean={row['mean']:.2f}, median={df[col].median():.2f}"
            )
    lines.append("Sample rows:")
    for _, r in df.head(5).iterrows():
        lines.append("  " + ", ".join(f"{k}={v}" for k, v in r.items()))
    insights = generate_insights(df)
    if insights:
        lines.append("Insights: " + "; ".join(i["text"] for i in insights))
    return "\n".join(lines)


@router.post("/ask")
async def nl_ask(request: NLAskRequest):
    dataset = session.get(request.dataset_id)
    context = _build_data_context(dataset)
    prompt = (
        "You are analyzing a dataset. Use ONLY the data context below; never invent numbers.\n\n"
        f"Data context:\n{context}\n\n"
        f"Question: {request.question}\n\n"
        "请用简体中文简洁回答，引用上下文中的具体数字。"
    )
    try:
        answer = chat([{"role": "user", "content": prompt}])
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"LLM unavailable: {exc}") from exc
    return {"answer": answer}


@router.post("/narrate")
async def nl_narrate(payload: dict):
    """Generate a Chinese analysis narrative from the dataset insights."""
    dataset_id = payload.get("dataset_id")
    if not dataset_id:
        raise HTTPException(status_code=400, detail="dataset_id is required")
    dataset = session.get(dataset_id)
    from backend.core.insights import generate_insights

    insights = generate_insights(dataset.df)
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
    context = _build_data_context(dataset)
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
