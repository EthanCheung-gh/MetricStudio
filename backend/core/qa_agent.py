"""Iterative tool-calling agent for dataset Q&A.

Protocol (JSON-in-prompt, provider-agnostic):
- Each round the LLM replies with EXACTLY ONE JSON object:
  - {"tools": [{"name": "...", "args": {...}}]} to call deterministic tools;
  - {"answer": "...", "followups": [...], "clarify": null|{...}} to finish.
- Tool results come back numbered ([1], [2], ...) and the final answer must
  cite them inline as [n], giving users a verifiable trail.
- Degradation ladder (never worse than the v1.1 static path):
  1. Final-round tool calls are ignored and answered from gathered facts;
  2. Unparseable replies fall back to plain-text answers;
  3. A chat failure mid-loop degrades to the best content collected so far;
  4. Only a failure on the very first call raises, surfacing a 502 like v1.1.
"""

from __future__ import annotations

import json
import os
import time
from typing import Any

from backend.core.agent_trace import trace_event
from backend.core.llm import chat, chat_stream
from backend.core.logging_setup import get_logger, round_var
from backend.core.qa_tools import TOOLS_DESC, run as run_tool

_log = get_logger("qa_agent")

MAX_ROUNDS = 3
MAX_CALLS_PER_ROUND = 3
MAX_FOLLOWUPS = 3
MAX_CLARIFY_OPTIONS = 4
HISTORY_ROUNDS = 8
HISTORY_SUMMARY_LIMIT = 2000
DEFAULT_BUDGET_SECONDS = 240.0


def _budget_seconds() -> float:
    """Wall-clock budget for one full agent run (v1.9.0).

    Checked before each round after the first; when exceeded the run degrades
    to the facts gathered so far instead of starting another LLM round.
    """
    raw = os.environ.get("METRICSTUDIO_QA_BUDGET_S", "").strip()
    if not raw:
        return DEFAULT_BUDGET_SECONDS
    try:
        return max(0.0, float(raw))
    except ValueError:
        return DEFAULT_BUDGET_SECONDS


def _facts_fallback(facts: list[dict[str, Any]]) -> str:
    return "\n".join(f"[{fact['n']}] {fact['detail']}" for fact in facts)


def _zero_usage() -> dict[str, Any]:
    return {"prompt": 0, "completion": 0, "total": 0, "estimated": False}


def _accumulate_usage(total: dict[str, Any], round_usage: dict[str, Any]) -> None:
    """Sum per-round token usage into the run total (v1.10.0)."""
    if not round_usage:
        return
    total["prompt"] += round_usage.get("prompt", 0)
    total["completion"] += round_usage.get("completion", 0)
    total["total"] += round_usage.get("total", 0)
    total["estimated"] = bool(total["estimated"] or round_usage.get("estimated"))

_SYSTEM_TEMPLATE = """You are MetricStudio's data-analysis assistant. You answer questions about ONE dataset using the data context below and, when needed, deterministic tools computed on the real data.

Data context:
{context}

{tools_desc}

Reply protocol - respond with EXACTLY ONE JSON object and nothing else:
1. Call tools when the context is not enough:
   {{"tools": [{{"name": "...", "args": {{...}}}}]}}  # up to {max_calls} per round
   Use tools for ANY exact number you are unsure of: counts, sums, averages, rankings, time trends, correlations, distributions, quantiles.
2. Give the final answer:
   {{"answer": "<answer in 简体中文>", "followups": ["<deeper question 1>", "<deeper question 2>"], "clarify": null}}
   Rules for the final answer:
   - Cite computed facts inline as [1], [2] matching the numbered tool results you received. Never invent or approximate numbers that a tool could compute.
   - Format with simple Markdown: bold key numbers, bullet lists, and GFM tables when comparing values. Do not use headings (#) and do not output HTML tags.
   - "followups": 2-3 concrete follow-up questions to dig deeper ([] if none).
   - If the question is ambiguous, do NOT guess: set "clarify": {{"question": "<one clarifying question>", "options": ["<interpretation 1>", "<interpretation 2>"]}} with 2-4 concrete interpretations instead of an answer.
   - If the dataset truly cannot answer the question, say so plainly in the answer.

Behavior:
- If the data context already answers the question, give the final answer immediately in round 1.
- After tool results arrive, answer immediately if they are sufficient.
- Invalid tool results (ok=false) mean your arguments were wrong: fix them and retry with a corrected call, or answer without that fact."""


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


def _parse_reply(text: str) -> dict[str, Any]:
    """Classify a reply into tools / answer / plain-text fallback."""
    parsed = _extract_json_object(text)
    if parsed is None:
        return {"kind": "text", "text": text.strip()}
    if isinstance(parsed.get("tools"), list) and not isinstance(parsed.get("answer"), str):
        return {"kind": "tools", "tools": parsed["tools"]}
    answer = parsed.get("answer")
    clarify_raw = parsed.get("clarify")
    clarify = None
    if isinstance(clarify_raw, dict) and isinstance(clarify_raw.get("question"), str) and clarify_raw["question"].strip():
        options_raw = clarify_raw.get("options")
        options = [str(o) for o in options_raw if isinstance(o, str) and o.strip()][:MAX_CLARIFY_OPTIONS] if isinstance(options_raw, list) else []
        clarify = {"question": clarify_raw["question"].strip(), "options": options}
    answer_text = answer.strip() if isinstance(answer, str) else ""
    if answer_text or clarify:
        raw_followups = parsed.get("followups")
        followups = [str(f) for f in raw_followups if isinstance(f, str) and f.strip()][:MAX_FOLLOWUPS] if isinstance(raw_followups, list) else []
        return {"kind": "answer", "answer": answer_text, "followups": followups, "clarify": clarify}
    return {"kind": "text", "text": text.strip()}


def _build_history_block(history: list[dict[str, str]]) -> str:
    turns = [turn for turn in history if isinstance(turn, dict)]
    # v1.6.0: compaction turns carry pre-made summaries; they are always shown
    # and never occupy the recent-dialog window.
    summaries = [turn for turn in turns if turn.get("kind") == "compaction"]
    dialog = [turn for turn in turns if turn.get("kind") != "compaction"]
    recent = dialog[-HISTORY_ROUNDS:]
    older = dialog[:-HISTORY_ROUNDS]
    blocks: list[str] = []
    for turn in summaries:
        text = (turn.get("summary") or turn.get("answer") or "").strip()
        if not text:
            continue
        rng = turn.get("compacted_range")
        label = f"turns {rng[0]}-{rng[1]}" if isinstance(rng, list) and len(rng) == 2 else "earlier turns"
        blocks.append(f"Summary of {label} (context compacted):\n{text}")
    if older:
        summary = "\n".join(f"Q: {t.get('question', '')}\nA: {t.get('answer', '')}" for t in older)
        blocks.append(f"Earlier conversation (truncated):\n{summary[:HISTORY_SUMMARY_LIMIT]}")
    if recent:
        conversation = "\n".join(f"User: {t.get('question', '')}\nAssistant: {t.get('answer', '')}" for t in recent)
        blocks.append(f"Previous conversation:\n{conversation}")
    if not blocks:
        return ""
    return "\n\n".join(blocks) + "\n\n"


def run_agent(
    question: str,
    df: Any,
    context: str,
    history: list[dict[str, str]] | None = None,
) -> dict[str, Any]:
    """Run the iterative tool loop. Raises only if the very first call fails."""
    messages: list[dict[str, str]] = [
        {"role": "system", "content": _SYSTEM_TEMPLATE.format(
            context=context, tools_desc=TOOLS_DESC, max_calls=MAX_CALLS_PER_ROUND,
        )},
    ]
    history_block = _build_history_block(history or [])
    messages.append({"role": "user", "content": f"{history_block}Question: {question}"})

    facts: list[dict[str, Any]] = []
    rounds_used = 0
    tool_call_count = 0
    usage_total = _zero_usage()
    trace_event("agent_start", span="qa_agent", mode="sync", question=question)
    budget = _budget_seconds()
    started = time.monotonic()

    def _result(answer: str, *, followups: list[str] | None = None, clarify: Any = None) -> dict[str, Any]:
        return {
            "answer": answer,
            "followups": followups or [],
            "clarify": clarify,
            "facts": facts,
            "rounds_used": rounds_used,
            "tool_call_count": tool_call_count,
            "usage": dict(usage_total),
        }

    for round_index in range(1, MAX_ROUNDS + 1):
        if round_index > 1 and time.monotonic() - started >= budget:
            trace_event("agent_budget_exhausted", span="qa_agent", round=round_index, facts=len(facts))
            _log.event("agent_budget_exhausted", span="qa_agent", mode="sync", round=round_index, facts=len(facts))
            return _result(_facts_fallback(facts) or "抱歉，本次未能生成有效回答，请重试。")
        rounds_used = round_index
        is_final_round = round_index == MAX_ROUNDS
        round_var.set(round_index)
        trace_event("round_start", span="qa_agent", round=round_index, final=is_final_round)
        round_usage: dict[str, Any] = {}
        try:
            reply = chat(messages, usage_out=round_usage)
        except Exception as exc:
            if round_index == 1:
                trace_event("agent_error", span="qa_agent", round=round_index, error=str(exc))
                raise  # No content at all: surface the 502 like the v1.1 path.
            # Mid-loop failure: degrade to the best facts collected so far.
            fallback = "\n".join(f"[{fact['n']}] {fact['detail']}" for fact in facts) or "抱歉，本次未能生成有效回答，请重试。"
            trace_event("agent_degraded", span="qa_agent", round=round_index, reason="chat_failed", facts=len(facts))
            return _result(fallback)
        _accumulate_usage(usage_total, round_usage)
        parsed = _parse_reply(reply)
        trace_event("llm_decision", span="qa_agent", round=round_index, kind=parsed["kind"],
                    tools=parsed.get("tools") if parsed["kind"] == "tools" else None)

        if parsed["kind"] == "tools" and not is_final_round:
            calls = [call for call in parsed["tools"] if isinstance(call, dict)][:MAX_CALLS_PER_ROUND]
            if calls:
                result_lines: list[str] = []
                for call in calls:
                    tool_call_count += 1
                    name = str(call.get("name", ""))
                    args = call.get("args") if isinstance(call.get("args"), dict) else {}
                    _t0 = time.monotonic()
                    result = run_tool(df, name, args)
                    facts.append({"n": len(facts) + 1, "tool": name, "detail": result["detail"]})
                    status = "ok" if result["ok"] else "error"
                    trace_event("tool_call", span="qa_tools", round=round_index, n=facts[-1]["n"],
                                tool=name, args=args, ok=bool(result["ok"]),
                                elapsed_ms=round((time.monotonic() - _t0) * 1000, 1))
                    result_lines.append(f"[{facts[-1]['n']}] {name} ({status}): {result['detail']}")
                messages.append({"role": "assistant", "content": reply})
                messages.append({"role": "user", "content": "\n".join([
                    "Tool results:",
                    *result_lines,
                    "Continue: answer now citing facts as [n], or call more tools if still needed.",
                ])})
                continue

        if parsed["kind"] == "answer":
            trace_event("agent_done", span="qa_agent", round=round_index,
                        rounds=rounds_used, tool_calls=tool_call_count, facts=len(facts))
            return _result(parsed["answer"], followups=parsed["followups"], clarify=parsed["clarify"])

        # Plain text, or an unactionable/late tool call: degrade gracefully.
        fallback_text = parsed.get("text", "").strip()
        if facts and not fallback_text:
            fallback_text = "\n".join(f"[{fact['n']}] {fact['detail']}" for fact in facts)
        trace_event("agent_done", span="qa_agent", round=round_index, degraded=True,
                    reason="unparseable_or_late_tools", rounds=rounds_used, tool_calls=tool_call_count)
        return _result(fallback_text or "抱歉，本次未能生成有效回答，请重试或换个问法。")

    # Unreachable (every branch returns), kept as a safety net.
    return _result("")


# --- v1.3.0 streaming agent ----------------------------------------------------

_JSON_ESCAPES = {'"': '"', "\\": "\\", "/": "/", "b": "\b", "f": "\f", "n": "\n", "r": "\r", "t": "\t"}


class _AnswerExtractor:
    """Incrementally decode the JSON ``answer`` value out of a delta stream.

    The agent protocol receives JSON objects like ``{"answer": "...", ...}``.
    As soon as the opening quote of the ``answer`` value is reached, decoded
    text is produced chunk by chunk so the UI can render a live typewriter
    answer while the LLM is still writing. Tool-round replies (no ``answer``
    key) produce nothing and are later parsed as a whole by ``_parse_reply``.
    """

    _KEY, _COLON, _QUOTE, _STRING, _DONE = range(5)

    def __init__(self) -> None:
        self._buffer = ""
        self._pos = 0
        self._state = self._KEY
        self._escape = False
        self._unicode_active = False
        self._unicode = ""
        self.emitted = False
        self.decoded = ""

    def feed(self, delta: str) -> str:
        if self._state == self._DONE or not delta:
            return ""
        self._buffer += delta
        out: list[str] = []
        buf = self._buffer
        while self._pos < len(buf):
            if self._state == self._KEY:
                idx = buf.find('"answer"', self._pos)
                if idx < 0:
                    # A key may straddle chunk boundaries: keep scanning from
                    # just before the tail of the buffer next time.
                    self._pos = max(self._pos, max(0, len(buf) - 8))
                    break
                self._pos = idx + len('"answer"')
                self._state = self._COLON
            elif self._state == self._COLON:
                while self._pos < len(buf) and buf[self._pos].isspace():
                    self._pos += 1
                if self._pos >= len(buf):
                    break
                if buf[self._pos] == ":":
                    self._pos += 1
                    self._state = self._QUOTE
                else:
                    # The "answer" match was inside another string; resume.
                    self._state = self._KEY
            elif self._state == self._QUOTE:
                while self._pos < len(buf) and buf[self._pos].isspace():
                    self._pos += 1
                if self._pos >= len(buf):
                    break
                if buf[self._pos] == '"':
                    self._pos += 1
                    self._state = self._STRING
                else:
                    self._state = self._KEY
            else:  # _STRING
                i = self._pos
                while i < len(buf):
                    char = buf[i]
                    if self._unicode_active:
                        self._unicode += char
                        if len(self._unicode) == 4:
                            try:
                                out.append(chr(int(self._unicode, 16)))
                            except ValueError:
                                out.append(self._unicode)
                            self._unicode = ""
                            self._unicode_active = False
                        i += 1
                        continue
                    if self._escape:
                        self._escape = False
                        if char == "u":
                            self._unicode_active = True
                            self._unicode = ""
                        elif char in _JSON_ESCAPES:
                            out.append(_JSON_ESCAPES[char])
                        else:
                            out.append(char)
                        i += 1
                        continue
                    if char == "\\":
                        self._escape = True
                        i += 1
                        continue
                    if char == '"':
                        i += 1
                        self._state = self._DONE
                        break
                    out.append(char)
                    i += 1
                self._pos = i
                break

        text = "".join(out)
        if text:
            self.emitted = True
            self.decoded += text
        return text


def _final_result(
    answer: str,
    facts: list[dict[str, Any]],
    rounds_used: int,
    tool_call_count: int,
    followups: list[str] | None = None,
    clarify: dict[str, Any] | None = None,
    usage: dict[str, Any] | None = None,
) -> dict[str, Any]:
    return {
        "answer": answer,
        "followups": followups or [],
        "clarify": clarify,
        "facts": facts,
        "rounds_used": rounds_used,
        "tool_call_count": tool_call_count,
        "usage": dict(usage) if usage else _zero_usage(),
    }


def _fallback_from_facts(facts: list[dict[str, Any]]) -> str:
    return "\n".join(f"[{fact['n']}] {fact['tool']}: {fact['detail']}" for fact in facts)


def run_agent_stream(
    question: str,
    df: Any,
    context: str,
    history: list[dict[str, str]] | None = None,
    trace_ids: dict[str, Any] | None = None,
) -> Any:
    """Streaming variant of :func:`run_agent`; yields event dicts.

    Events:
    - {"type": "round_start", "round": n}
    - {"type": "tool_call",   "round": n, "calls": [{"name", "args"}]}
    - {"type": "tool_result", "round": n, "n": fact_n, "tool", "ok", "detail"}
    - {"type": "answer_delta", "text": "..."}   (decoded final-answer text)
    - {"type": "done", "result": {...}}          (same shape as run_agent)
    - {"type": "error", "message": "..."}        (first-round failure only)

    The degradation ladder mirrors run_agent: mid-loop chat failures degrade
    to the best facts gathered so far; only a failure on the very first call
    yields an error event.

    trace_ids: explicit correlation ids (session_id/turn_id). Sync generators
    are iterated through anyio's threadpool where ContextVar writes do not
    survive across next() calls, so the caller passes ids explicitly instead
    of relying on ambient context.
    """
    base_ids = dict(trace_ids or {})

    def emit(event: str, span: str = "qa_agent", **fields: Any) -> None:
        trace_event(event, span=span, **base_ids, **fields)

    messages: list[dict[str, str]] = [
        {"role": "system", "content": _SYSTEM_TEMPLATE.format(
            context=context, tools_desc=TOOLS_DESC, max_calls=MAX_CALLS_PER_ROUND,
        )},
    ]
    history_block = _build_history_block(history or [])
    messages.append({"role": "user", "content": f"{history_block}Question: {question}"})

    facts: list[dict[str, Any]] = []
    rounds_used = 0
    tool_call_count = 0
    usage_total = _zero_usage()
    emit("agent_start", mode="stream", question=question)

    try:
        budget = _budget_seconds()
        started = time.monotonic()
        for round_index in range(1, MAX_ROUNDS + 1):
            if round_index > 1 and time.monotonic() - started >= budget:
                emit("agent_budget_exhausted", round=round_index, facts=len(facts), tool_calls=tool_call_count)
                _log.event("agent_budget_exhausted", span="qa_agent", mode="stream",
                           round=round_index, facts=len(facts), tool_calls=tool_call_count)
                answer = _facts_fallback(facts)
                if answer:
                    yield {"type": "answer_delta", "text": answer}
                yield {"type": "done", "result": _final_result(
                    answer or "抱歉，本次未能生成有效回答，请重试。", facts, rounds_used, tool_call_count,
                    usage=usage_total)}
                return
            rounds_used = round_index
            is_final_round = round_index == MAX_ROUNDS
            yield {"type": "round_start", "round": round_index}
            round_var.set(round_index)
            emit("round_start", round=round_index, final=is_final_round)
            extractor = _AnswerExtractor()
            chunks: list[str] = []
            round_usage: dict[str, Any] = {}
            try:
                for delta in chat_stream(
                    messages,
                    trace_ids={**base_ids, "round": round_index} if base_ids else None,
                    usage_out=round_usage,
                ):
                    chunks.append(delta)
                    text = extractor.feed(delta)
                    if text:
                        yield {"type": "answer_delta", "text": text}
            except Exception as exc:
                if round_index == 1:
                    emit("agent_error", round=round_index, error=str(exc))
                    yield {"type": "error", "message": str(exc) or exc.__class__.__name__}
                    return
                answer = extractor.decoded if extractor.emitted and extractor.decoded.strip() else _fallback_from_facts(facts)
                if not extractor.emitted and answer:
                    yield {"type": "answer_delta", "text": answer}
                emit("agent_degraded", round=round_index, reason="chat_failed", facts=len(facts))
                _accumulate_usage(usage_total, round_usage)
                yield {"type": "done", "result": _final_result(answer or "抱歉，本次未能生成有效回答，请重试。", facts, rounds_used, tool_call_count, usage=usage_total)}
                return
            _accumulate_usage(usage_total, round_usage)
            full_text = "".join(chunks)
            parsed = _parse_reply(full_text)
            emit("llm_decision", round=round_index, kind=parsed["kind"],
                 tools=parsed.get("tools") if parsed["kind"] == "tools" else None)

            if parsed["kind"] == "tools" and not is_final_round:
                calls = [call for call in parsed["tools"] if isinstance(call, dict)][:MAX_CALLS_PER_ROUND]
                if calls:
                    yield {"type": "tool_call", "round": round_index,
                           "calls": [{"name": str(call.get("name", "")), "args": call.get("args") if isinstance(call.get("args"), dict) else {}} for call in calls]}
                    result_lines: list[str] = []
                    for call in calls:
                        tool_call_count += 1
                        name = str(call.get("name", ""))
                        args = call.get("args") if isinstance(call.get("args"), dict) else {}
                        _t0 = time.monotonic()
                        result = run_tool(df, name, args)
                        facts.append({"n": len(facts) + 1, "tool": name, "detail": result["detail"]})
                        status = "ok" if result["ok"] else "error"
                        emit("tool_call", span="qa_tools", round=round_index, n=facts[-1]["n"],
                             tool=name, args=args, ok=bool(result["ok"]),
                             elapsed_ms=round((time.monotonic() - _t0) * 1000, 1))
                        result_lines.append(f"[{facts[-1]['n']}] {name} ({status}): {result['detail']}")
                        yield {"type": "tool_result", "round": round_index, "n": facts[-1]["n"], "tool": name,
                               "ok": bool(result["ok"]), "detail": result["detail"]}
                    messages.append({"role": "assistant", "content": full_text})
                    messages.append({"role": "user", "content": "\n".join([
                        "Tool results:",
                        *result_lines,
                        "Continue: answer now citing facts as [n], or call more tools if still needed.",
                    ])})
                    continue

            if parsed["kind"] == "answer":
                answer = parsed["answer"]
                if not extractor.emitted and answer:
                    # clarify-only answers or providers that ignore streaming.
                    yield {"type": "answer_delta", "text": answer}
                emit("agent_done", round=round_index, rounds=rounds_used,
                     tool_calls=tool_call_count, facts=len(facts))
                yield {"type": "done", "result": _final_result(
                    answer, facts, rounds_used, tool_call_count,
                    followups=parsed["followups"], clarify=parsed["clarify"], usage=usage_total,
                )}
                return

            # Plain text, or an unactionable/late tool call: degrade gracefully.
            fallback_text = parsed.get("text", "").strip()
            if extractor.emitted and extractor.decoded.strip():
                # The stream already showed the answer value; trust it over the
                # raw text (which may be a truncated JSON wrapper).
                fallback_text = extractor.decoded
            elif facts and not fallback_text:
                fallback_text = _fallback_from_facts(facts)
            if fallback_text and not extractor.emitted:
                yield {"type": "answer_delta", "text": fallback_text}
            emit("agent_done", round=round_index, degraded=True,
                 reason="unparseable_or_late_tools", rounds=rounds_used, tool_calls=tool_call_count)
            yield {"type": "done", "result": _final_result(
                fallback_text or "抱歉，本次未能生成有效回答，请重试或换个问法。",
                facts, rounds_used, tool_call_count, usage=usage_total,
            )}
            return

    except GeneratorExit:  # v1.9.0: client disconnected mid-stream
        emit("agent_cancelled", round=rounds_used, facts=len(facts), tool_calls=tool_call_count)
        _log.event("agent_cancelled", span="qa_agent", mode="stream",
                   round=rounds_used, facts=len(facts), tool_calls=tool_call_count)
        raise