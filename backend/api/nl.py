"""Natural-language transform: query -> validated operation chain via LLM."""

from __future__ import annotations

import json
import re
from typing import Any

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

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


class LLMConfig(BaseModel):
    base_url: str
    model: str
    api_key: str = ""


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


@router.get("/config")
async def get_llm_config():
    return load_config()


@router.post("/config")
async def set_llm_config(config: LLMConfig):
    data = config.model_dump()
    save_config(data)
    return data
