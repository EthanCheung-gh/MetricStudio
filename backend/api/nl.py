"""Natural-language transform: query -> validated operation chain via LLM."""

from __future__ import annotations

import json
import re
import time
import uuid
from contextlib import contextmanager
from datetime import datetime, timezone
from typing import Any, Literal

from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field, field_validator

import pandas as pd

from backend.api.chart import _filter_by_filters
from backend.core.llm import (
    activate_profile,
    chat,
    chat_stream,
    create_profile,
    delete_profile,
    list_profiles,
    load_config,
    probe_llm,
    save_config,
    update_profile,
)
from backend.core.logging_setup import get_logger, session_id_var, turn_id_var
from backend.core.privacy import prepare_for_llm, sensitive_columns
from backend.core.qa_agent import run_agent, run_agent_stream
from backend.core.session import session
from backend.models.chart import FilterSpec

router = APIRouter(prefix="/api/v1/nl", tags=["nl"])


@contextmanager
def _qa_turn_context(request):
    """Pin QA correlation ids (v1.8.0) so every agent/llm/trace log line in
    this request carries session_id/turn_id; trace_id comes from the HTTP
    middleware (SPA-generated) via its own ContextVar."""
    session_token = session_id_var.set(request.session_id)
    turn_token = turn_id_var.set(request.turn_id or uuid.uuid4().hex[:12])
    try:
        yield
    finally:
        session_id_var.reset(session_token)
        turn_id_var.reset(turn_token)


def _sse(payload: dict) -> str:
    return f"data: {json.dumps(payload, ensure_ascii=False)}\n\n"

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
    kind: Literal["dialog", "compaction"] = "dialog"
    summary: str | None = None
    compacted_range: list[int] | None = None


class NLAskRequest(BaseModel):
    dataset_id: str
    question: str
    history: list[NLAskTurn] = Field(default_factory=list)
    snapshot_id: str | None = None
    filters: list[FilterSpec] = Field(default_factory=list)
    # v1.8.0: optional correlation ids — the SPA sends the QA session id and
    # a per-turn turn id so agent-trace lines join up with the UI session.
    session_id: str | None = None
    turn_id: str | None = None


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
def nl_transform(request: NLTransformRequest):
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


class _OpExtractor:
    """Incrementally extract complete objects from a streamed JSON array.

    The transform protocol streams a JSON array of operations like
    ``[{"type": "filter", "params": {...}}, ...]``. Each time an object
    closes, it is decoded and emitted so the UI can light the operation up
    while the LLM is still writing the rest of the chain. String-aware
    bracket counting keeps braces inside JSON strings from confusing the
    depth tracking. A parse failure on a single object is tolerated here —
    the done frame re-validates the whole chain via _parse_chain.
    """

    def __init__(self) -> None:
        self._buf = ""
        self._scan = 0
        self._started = False
        self._obj_start: int | None = None
        self._depth = 0
        self._in_string = False
        self._escape = False
        self.ops: list[dict[str, Any]] = []

    def feed(self, delta: str) -> list[dict[str, Any]]:
        if not delta:
            return []
        self._buf += delta
        buf = self._buf
        out: list[dict[str, Any]] = []
        i = self._scan
        while i < len(buf):
            char = buf[i]
            if self._obj_start is None:
                if not self._started:
                    if char == "[":
                        self._started = True
                    elif char == "{":
                        # Tolerate a bare object without the array wrapper.
                        self._started = True
                        self._obj_start = i
                        self._depth = 1
                elif char == "{":
                    self._obj_start = i
                    self._depth = 1
                    self._in_string = False
                    self._escape = False
            else:
                if self._escape:
                    self._escape = False
                elif char == "\\":
                    self._escape = True
                elif char == '"':
                    self._in_string = not self._in_string
                elif not self._in_string:
                    if char in "{[":
                        self._depth += 1
                    elif char in "}]":
                        self._depth -= 1
                        if self._depth == 0:
                            try:
                                op = json.loads(buf[self._obj_start : i + 1])
                                if isinstance(op, dict):
                                    self.ops.append(op)
                                    out.append(op)
                            except json.JSONDecodeError:
                                pass
                            self._obj_start = None
                            self._in_string = False
            i += 1
        self._scan = i
        return out


@router.post("/transform/stream")
def nl_transform_stream(request: NLTransformRequest):
    """SSE variant of /transform (v1.4.0).

    Frames: {"type":"thinking"} -> {"type":"op","index":n,"op":{...}}* ->
    {"type":"done","operations":[...]} | {"type":"error","message":...}.
    """
    try:
        dataset = session.get(request.dataset_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    prompt = _build_prompt(dataset, request.query)

    def event_stream():
        yield _sse({"type": "thinking"})
        extractor = _OpExtractor()
        chunks: list[str] = []
        try:
            for delta in chat_stream([{"role": "user", "content": prompt}]):
                chunks.append(delta)
                for op in extractor.feed(delta):
                    yield _sse({"type": "op", "index": len(extractor.ops) - 1, "op": op})
        except Exception as exc:  # noqa: BLE001 - terminal frame must be sent
            yield _sse({"type": "error", "message": f"LLM unavailable: {exc}"})
            return
        try:
            ops = _parse_chain("".join(chunks))
            _validate_ops(ops)
        except ValueError as exc:
            yield _sse({"type": "error", "message": f"LLM output invalid: {exc}"})
            return
        yield _sse({"type": "done", "operations": ops})

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


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
    try:
        # itertuples + explicit str(): pandas 3 string dtypes make
        # astype(str).agg(join, axis=1) unsafe on mixed-type real data.
        row_strings = pd.Series(
            (" | ".join(map(str, values)) for values in window.itertuples(index=False, name=None)),
            index=window.index,
        )
        scores = row_strings.map(lambda text: sum(1 for token in tokens if token in text))
    except Exception:  # noqa: BLE001 - sampling must never break the ask flow
        return df.head(limit)
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
def nl_ask(request: NLAskRequest):
    """Sync endpoint: the agent loop makes blocking LLM calls (up to 3
    rounds x 60s). A sync def keeps them on FastAPI's threadpool so the
    event loop (health checks, other LAN clients) stays responsive."""
    with _qa_turn_context(request):
        try:
            dataset = session.get(request.dataset_id)
        except KeyError as exc:
            raise HTTPException(status_code=404, detail=str(exc)) from exc
        df = _ask_dataframe(dataset, request)
        context = _build_data_context(dataset, df, request.question)
        history = [turn.model_dump() for turn in request.history]
        started = time.monotonic()
        try:
            agent = run_agent(request.question, df, context, history)
        except Exception as exc:
            get_logger("nl").event("ask_failed", span="nl", error=str(exc), exc=exc)
            raise HTTPException(status_code=502, detail=f"LLM unavailable: {exc}") from exc
        config = load_config()
        get_logger("nl").event(
            "ask_done", span="nl", dataset_id=request.dataset_id,
            question=request.question, rounds=agent["rounds_used"],
            tool_calls=agent["tool_call_count"], facts=len(agent["facts"]),
            elapsed_ms=round((time.monotonic() - started) * 1000, 1),
        )
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


@router.post("/ask/stream")
def nl_ask_stream(request: NLAskRequest):
    """SSE endpoint for the agent loop (v1.3.0).

    Emits ``data: {json}\\n\\n`` frames:
    round_start / tool_call / tool_result / answer_delta / done / error.
    ``done`` carries the same payload as the sync /ask response. A sync def
    keeps the blocking LLM stream on FastAPI's threadpool.
    """
    with _qa_turn_context(request):
        return _ask_stream_response(request)


def _ask_stream_response(request: NLAskRequest):
    try:
        dataset = session.get(request.dataset_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    df = _ask_dataframe(dataset, request)
    context = _build_data_context(dataset, df, request.question)
    history = [turn.model_dump() for turn in request.history]
    snapshot_id = request.snapshot_id
    started = time.monotonic()

    def event_stream():
        try:
            config = load_config()
            evidence = _build_data_evidence(dataset, df, snapshot_id)
            fact_source: dict[str, str] = {"datasetId": dataset.id}
            if snapshot_id:
                fact_source["snapshotId"] = snapshot_id
            agent_result: dict[str, Any] | None = None
            for event in run_agent_stream(request.question, df, context, history):
                if event["type"] == "done":
                    agent_result = event["result"]
                    evidence.extend(
                        {"id": f"fact:{fact['n']}", "kind": "tool", "detail": f"[{fact['n']}] {fact['tool']}: {fact['detail']}", "source": dict(fact_source)}
                        for fact in agent_result["facts"]
                    )
                    get_logger("nl").event(
                        "ask_done", span="nl", mode="stream", dataset_id=request.dataset_id,
                        question=request.question, rounds=agent_result["rounds_used"],
                        tool_calls=agent_result["tool_call_count"], facts=len(agent_result["facts"]),
                        elapsed_ms=round((time.monotonic() - started) * 1000, 1),
                    )
                    yield _sse({"type": "done", "result": {
                        **agent_result,
                        "evidence": evidence[:20],
                        "model": config.get("model", "unknown"),
                        "generated_at": datetime.now(timezone.utc).isoformat(),
                    }})
                elif event["type"] == "error":
                    agent_result = {}  # terminal: a error frame was already sent
                    get_logger("nl").event("ask_failed", span="nl", mode="stream",
                                           dataset_id=request.dataset_id, question=request.question)
                    yield _sse(event)
                else:
                    yield _sse(event)
            if agent_result is None:  # generator ended without done (defensive)
                yield _sse({"type": "error", "message": "agent stream ended unexpectedly"})
        except Exception as exc:  # noqa: BLE001 - stream must end with a terminal frame
            yield _sse({"type": "error", "message": str(exc) or exc.__class__.__name__})

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


class NLCompactRequest(BaseModel):
    dataset_id: str
    turns: list[NLAskTurn] = Field(default_factory=list)


@router.post("/compact")
def nl_compact(request: NLCompactRequest):
    """Summarize a run of past dialog turns into one compact summary (v1.6.0).

    The caller replaces the summarized turns with the returned summary turn;
    the agent then sees the summary instead of the raw history.
    """
    if len(request.turns) < 2:
        raise HTTPException(status_code=422, detail="Need at least 2 turns to compact")
    dataset = None
    if request.dataset_id:
        try:
            dataset = session.get(request.dataset_id)
        except KeyError:
            dataset = None
    lines = []
    for index, turn in enumerate(request.turns, start=1):
        lines.append(f"[Turn {index}] User: {turn.question}\nAssistant: {turn.answer}")
    dataset_hint = ""
    if dataset is not None:
        columns = ", ".join(c.name for c in dataset.meta.columns[:20])
        dataset_hint = f"\n\nThe conversation is about the dataset \"{dataset.name}\" with columns: {columns}."
    prompt = (
        "Below is a past data-analysis Q&A conversation."
        + dataset_hint
        + "\n\nWrite a concise summary in 简体中文 (max 300 characters) that preserves:\n"
        "1. Each question and its confirmed conclusion, including exact numbers;\n"
        "2. Important data facts established by tools (row counts, aggregations, filters);\n"
        "3. Any unresolved question or pending direction.\n"
        "Output ONLY the summary text, no preamble, no markdown headers.\n\n"
        + "\n\n".join(lines)
    )
    try:
        summary = chat([{"role": "user", "content": prompt}])
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"LLM unavailable: {exc}") from exc
    summary = summary.strip() or "（摘要生成失败，请重试）"
    return {
        "summary": summary,
        "turns_compacted": len(request.turns),
        "model": load_config().get("model", "unknown"),
        "generated_at": datetime.now(timezone.utc).isoformat(),
    }


@router.post("/narrate")
def nl_narrate(payload: dict):
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
def explain_chart(request: ExplainChartRequest):
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
def test_llm_connection(request: LLMTestRequest):
    """Probe an endpoint with a tiny chat request (no config is written)."""
    active = load_config()
    base_url = (request.base_url or active.get("base_url", "")).strip()
    model = (request.model or active.get("model", "")).strip()
    api_key = request.api_key.strip() if request.api_key else active.get("api_key", "")
    if not base_url or not model:
        raise HTTPException(status_code=422, detail="base_url and model are required")
    ok, latency_ms, error = probe_llm(base_url, model, api_key)
    return {"ok": ok, "latency_ms": latency_ms, "error": error}
