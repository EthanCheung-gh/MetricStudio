"""Tests for the v1.11.0 QA evaluation assertion engine (and golden set)."""

from __future__ import annotations

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "scripts"))

import eval_engine  # noqa: E402

GOLDEN = Path(__file__).resolve().parent / "eval" / "qa_golden.json"


def _result(answer="共 24 行 [1]", facts=None):
    return {
        "answer": answer,
        "facts": facts or [{"n": 1, "tool": "row_count", "detail": "row_count = 24"}],
    }


def test_golden_file_is_wellformed():
    data = json.loads(GOLDEN.read_text(encoding="utf-8"))
    cases = data["cases"]
    assert len(cases) >= 14
    fixtures = {c["fixture"] for c in cases}
    assert fixtures <= {"sales", "timeseries", "categorical", "injected"}
    for case in cases:
        assert case["expect"].get("tools_required"), case["id"]
        assert case.get("replay"), case["id"]


def test_all_checks_pass_on_conforming_result():
    case = {
        "id": "t",
        "expect": {
            "tools_required": ["row_count"],
            "facts_contain": [{"tool": "row_count", "pattern": "row_count = 24"}],
            "must_cite": True,
            "answer_contains": ["24"],
        },
    }
    checks = eval_engine.evaluate(case, _result())
    assert checks and all(ok for _, ok, _ in checks)


def test_missing_tool_and_bad_citation_fail():
    case = {
        "id": "t",
        "expect": {
            "tools_required": ["groupby_agg"],
            "must_cite": True,
            "answer_contains": ["999"],
        },
    }
    # answer cites [1] which exists, but groupby_agg was never called and 999 absent
    checks = dict((cid, ok) for cid, ok, _ in eval_engine.evaluate(case, _result()))
    assert checks["tool:groupby_agg"] is False
    assert checks["citations-valid"] is True
    assert checks["answer:999"] is False


def test_citation_out_of_range_fails():
    case = {"id": "t", "expect": {"must_cite": True}}
    checks = eval_engine.evaluate(case, _result(answer="见 [5]", facts=[{"n": 1, "tool": "row_count", "detail": "x"}]))
    assert dict((cid, ok) for cid, ok, _ in checks)["citations-valid"] is False


def test_check_errors_degrade_to_failed():
    case = {"id": "t", "expect": {"facts_contain": [{"tool": "row_count", "pattern": "x"}]}}
    result = _result(facts=[{"n": 1, "tool": "row_count", "detail": None}])  # None detail
    checks = eval_engine.evaluate(case, result)
    assert checks[0][1] is False  # failed check, not an exception


def test_summarize_counts():
    results = [
        {"passed": True, "checks": [("a", True, ""), ("b", True, "")]},
        {"passed": False, "checks": [("a", True, ""), ("b", False, "")]},
    ]
    summary = eval_engine.summarize(results)
    assert summary["cases"] == 2 and summary["passed_cases"] == 1
    assert summary["pass_rate"] == 0.5 and summary["checks"] == 4 and summary["passed_checks"] == 3
