"""Assertion engine for the MetricStudio QA evaluation set (v1.11.0).

Kept dependency-free and importable from both scripts/eval_qa.py and the
pytest suite so the pass/fail semantics are exactly the same everywhere.
"""

from __future__ import annotations

import re
from typing import Any

_CITE_RE = re.compile(r"\[(\d+)\]")


def evaluate(case: dict[str, Any], result: dict[str, Any]) -> list[tuple[str, bool, str]]:
    """Run one case's assertions against an agent result.

    Returns a list of (check_id, passed, detail). An assertion error inside a
    single check degrades to a failed check, never an exception — one broken
    case must not abort the whole report.
    """
    checks: list[tuple[str, bool, str]] = []
    expect = case.get("expect", {})
    facts = result.get("facts") or []
    answer = result.get("answer") or ""
    tool_names = {f.get("tool") for f in facts}

    for tool in expect.get("tools_required", []):
        checks.append((f"tool:{tool}", tool in tool_names, f"called tools: {sorted(tool_names)}"))

    for spec in expect.get("facts_contain", []):
        ok = any(
            f.get("tool") == spec["tool"] and spec["pattern"] in str(f.get("detail", ""))
            for f in facts
        )
        checks.append((f"fact:{spec['tool']}:{spec['pattern'][:32]}", ok,
                       "pattern found in matching fact" if ok else "no matching fact detail"))

    if expect.get("must_cite"):
        cites = _CITE_RE.findall(answer)
        numbers = [int(n) for n in cites]
        ok = bool(numbers) and all(1 <= n <= len(facts) for n in numbers)
        detail = f"citations={numbers[:6]} facts={len(facts)}"
        checks.append(("citations-valid", ok, detail))

    for text in expect.get("answer_contains", []):
        checks.append((f"answer:{text[:32]}", text in answer, f"answer length={len(answer)}"))

    return checks


def summarize(results: list[dict[str, Any]]) -> dict[str, Any]:
    """Aggregate per-case outcomes into report totals."""
    total_checks = sum(len(r["checks"]) for r in results)
    passed_checks = sum(1 for r in results for _, ok, _ in r["checks"] if ok)
    passed_cases = sum(1 for r in results if r["passed"])
    return {
        "cases": len(results),
        "passed_cases": passed_cases,
        "pass_rate": round(passed_cases / len(results), 4) if results else 0.0,
        "checks": total_checks,
        "passed_checks": passed_checks,
    }
