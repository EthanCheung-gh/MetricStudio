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
from typing import Any

from backend.core.llm import chat
from backend.core.qa_tools import TOOLS_DESC, run as run_tool

MAX_ROUNDS = 3
MAX_CALLS_PER_ROUND = 3
MAX_FOLLOWUPS = 3
MAX_CLARIFY_OPTIONS = 4
HISTORY_ROUNDS = 8
HISTORY_SUMMARY_LIMIT = 2000

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
    recent = turns[-HISTORY_ROUNDS:]
    older = turns[:-HISTORY_ROUNDS]
    blocks: list[str] = []
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

    for round_index in range(1, MAX_ROUNDS + 1):
        rounds_used = round_index
        is_final_round = round_index == MAX_ROUNDS
        try:
            reply = chat(messages)
        except Exception:
            if round_index == 1:
                raise  # No content at all: surface the 502 like the v1.1 path.
            # Mid-loop failure: degrade to the best facts collected so far.
            fallback = "\n".join(f"[{fact['n']}] {fact['detail']}" for fact in facts) or "抱歉，本次未能生成有效回答，请重试。"
            return {
                "answer": fallback,
                "followups": [],
                "clarify": None,
                "facts": facts,
                "rounds_used": rounds_used,
                "tool_call_count": tool_call_count,
            }
        parsed = _parse_reply(reply)

        if parsed["kind"] == "tools" and not is_final_round:
            calls = [call for call in parsed["tools"] if isinstance(call, dict)][:MAX_CALLS_PER_ROUND]
            if calls:
                result_lines: list[str] = []
                for call in calls:
                    tool_call_count += 1
                    name = str(call.get("name", ""))
                    args = call.get("args") if isinstance(call.get("args"), dict) else {}
                    result = run_tool(df, name, args)
                    facts.append({"n": len(facts) + 1, "tool": name, "detail": result["detail"]})
                    status = "ok" if result["ok"] else "error"
                    result_lines.append(f"[{facts[-1]['n']}] {name} ({status}): {result['detail']}")
                messages.append({"role": "assistant", "content": reply})
                messages.append({"role": "user", "content": "\n".join([
                    "Tool results:",
                    *result_lines,
                    "Continue: answer now citing facts as [n], or call more tools if still needed.",
                ])})
                continue

        if parsed["kind"] == "answer":
            return {
                "answer": parsed["answer"],
                "followups": parsed["followups"],
                "clarify": parsed["clarify"],
                "facts": facts,
                "rounds_used": rounds_used,
                "tool_call_count": tool_call_count,
            }

        # Plain text, or an unactionable/late tool call: degrade gracefully.
        fallback_text = parsed.get("text", "").strip()
        if facts and not fallback_text:
            fallback_text = "\n".join(f"[{fact['n']}] {fact['detail']}" for fact in facts)
        return {
            "answer": fallback_text or "抱歉，本次未能生成有效回答，请重试或换个问法。",
            "followups": [],
            "clarify": None,
            "facts": facts,
            "rounds_used": rounds_used,
            "tool_call_count": tool_call_count,
        }

    # Unreachable (every branch returns), kept as a safety net.
    return {
        "answer": "",
        "followups": [],
        "clarify": None,
        "facts": facts,
        "rounds_used": rounds_used,
        "tool_call_count": tool_call_count,
    }
