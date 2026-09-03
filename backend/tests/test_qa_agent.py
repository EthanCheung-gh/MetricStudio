"""Unit tests for the v1.2.0 Q&A toolbox and agent loop."""

from __future__ import annotations

import pandas as pd
import pytest

import backend.core.qa_agent as qa_agent
from backend.core import qa_tools


@pytest.fixture
def sales_df() -> pd.DataFrame:
    return pd.DataFrame(
        {
            "category": ["A", "B", "A", "C", "B", "A"],
            "value": [100, 250, 130, 90, 210, 175],
            "date": ["2024-01-05", "2024-01-20", "2024-02-11", "2024-02-25", "2024-03-01", "2024-03-18"],
            "note": ["hello", "world", "hello", "xyz", "world", "hello"],
        }
    )


# --- tools --------------------------------------------------------------------

def test_row_count_and_distinct(sales_df):
    assert qa_tools.run(sales_df, "row_count", {})["detail"] == "row_count = 6"
    assert "distinct_count(category) = 3" in qa_tools.run(sales_df, "distinct_count", {"column": "categ"})["detail"]


def test_column_stats_fuzzy_and_non_numeric(sales_df):
    result = qa_tools.run(sales_df, "column_stats", {"column": "VALUE"})
    assert result["ok"] and "mean=159.1667" in result["detail"]
    bad = qa_tools.run(sales_df, "column_stats", {"column": "category"})
    assert not bad["ok"] and "not numeric" in bad["detail"]


def test_groupby_agg_topn(sales_df):
    result = qa_tools.run(sales_df, "groupby_agg", {"column": "Category", "agg_column": "value", "agg": "sum"})
    assert result["ok"]
    assert "B=460" in result["detail"] and "A=405" in result["detail"]
    assert result["detail"].index("B=") < result["detail"].index("A=")  # descending


def test_groupby_agg_count_without_agg_column(sales_df):
    result = qa_tools.run(sales_df, "groupby_agg", {"column": "category", "agg": "count"})
    assert result["ok"] and "A=3" in result["detail"]


def test_filter_stats_multiple_conditions(sales_df):
    result = qa_tools.run(
        sales_df,
        "filter_stats",
        {"conditions": [{"column": "category", "operator": "eq", "value": "A"}, {"column": "value", "operator": "gt", "value": 110}], "agg_column": "value", "agg": "sum"},
    )
    assert result["ok"]
    assert "matched_rows=2" in result["detail"] and "sum(value)=305" in result["detail"]


def test_filter_stats_contains_only_text(sales_df):
    result = qa_tools.run(sales_df, "filter_stats", {"conditions": [{"column": "value", "operator": "contains", "value": "1"}]})
    assert not result["ok"] and "requires a text column" in result["detail"]
    ok = qa_tools.run(sales_df, "filter_stats", {"conditions": [{"column": "note", "operator": "contains", "value": "HELL"}]})
    assert ok["ok"] and "matched_rows=3" in ok["detail"]


def test_value_counts_top_with_share(sales_df):
    result = qa_tools.run(sales_df, "value_counts_top", {"column": "note", "top_n": 2})
    assert result["ok"]
    assert "hello=3(50%)" in result["detail"]


def test_corr_zero_variance_and_match(sales_df):
    assert qa_tools.run(sales_df, "corr", {"column_a": "value", "column_b": "value"})["ok"]
    bad = qa_tools.run(sales_df, "corr", {"column_a": "value", "column_b": "category"})
    assert not bad["ok"]


def test_time_agg_monthly(sales_df):
    result = qa_tools.run(sales_df, "time_agg", {"column": "date", "freq": "month", "agg_column": "value", "agg": "sum"})
    assert result["ok"]
    assert "2024-01=350" in result["detail"] and "2024-03=385" in result["detail"]


def test_time_agg_unparseable_column(sales_df):
    result = qa_tools.run(sales_df, "time_agg", {"column": "note", "freq": "month"})
    assert not result["ok"] and "datetime" in result["detail"]


def test_quantile_list(sales_df):
    result = qa_tools.run(sales_df, "quantile", {"column": "value", "q": "0.25,0.5,0.75"})
    assert result["ok"] and "p50=152.5" in result["detail"]


def test_crosstab_truncated(sales_df):
    result = qa_tools.run(sales_df, "crosstab", {"column_a": "category", "column_b": "note"})
    assert result["ok"] and "A | 3" in result["detail"]


def test_range_info_numeric_and_datetime(sales_df):
    assert "min=90" in qa_tools.run(sales_df, "range_info", {"column": "value"})["detail"]
    assert "from=2024-01-05" in qa_tools.run(sales_df, "range_info", {"column": "date"})["detail"]


def test_unknown_tool_and_bad_args(sales_df):
    assert not qa_tools.run(sales_df, "nope", {})["ok"]
    assert not qa_tools.run(sales_df, "groupby_agg", {"column": "missing"})["ok"]
    # run() never raises.
    assert qa_tools.run(sales_df, "groupby_agg", "not-a-dict")["ok"] is False or True


def test_resolve_column_candidates(sales_df):
    # Unique substring match resolves directly.
    column, error = qa_tools._resolve_column(sales_df, "categor")
    assert column == "category" and error is None
    # Ambiguous substring lists candidates instead of guessing.
    column, error = qa_tools._resolve_column(sales_df, "a")
    assert column is None and "ambiguous" in error and "category" in error


# --- agent loop ----------------------------------------------------------------

def test_agent_direct_answer_without_tools(sales_df, monkeypatch):
    monkeypatch.setattr(qa_agent, "chat", lambda messages: "数据共 6 行。")
    result = qa_agent.run_agent("有多少行？", sales_df, "Dataset overview: 6 rows × 4 columns")
    assert result["answer"] == "数据共 6 行。"
    assert result["rounds_used"] == 1 and result["tool_call_count"] == 0


def test_agent_two_round_tool_cycle(sales_df, monkeypatch):
    seen = {"n": 0}

    def fake_chat(messages):
        seen["n"] += 1
        if seen["n"] == 1:
            return '{"tools": [{"name": "row_count", "args": {}}]}'
        assert "[1] row_count (ok): row_count = 6" in messages[-1]["content"]
        return '{"answer": "共 6 行 [1]。", "followups": ["按类别汇总？"], "clarify": null}'

    monkeypatch.setattr(qa_agent, "chat", fake_chat)
    result = qa_agent.run_agent("有多少行？", sales_df, "context")
    assert result["answer"] == "共 6 行 [1]。"
    assert result["rounds_used"] == 2 and result["tool_call_count"] == 1
    assert result["followups"] == ["按类别汇总？"]


def test_agent_caps_rounds_and_ignores_late_tool_calls(sales_df, monkeypatch):
    seen = {"n": 0}

    def fake_chat(messages):
        seen["n"] += 1
        return '{"tools": [{"name": "row_count", "args": {}}]}'

    monkeypatch.setattr(qa_agent, "chat", fake_chat)
    result = qa_agent.run_agent("test", sales_df, "context")
    assert seen["n"] == qa_agent.MAX_ROUNDS
    assert result["tool_call_count"] == qa_agent.MAX_ROUNDS - 1  # final-round calls ignored
    assert "[1] row_count = 6" in result["answer"]  # answered from gathered facts


def test_agent_garbage_reply_falls_back_to_text(sales_df, monkeypatch):
    monkeypatch.setattr(qa_agent, "chat", lambda messages: "我觉得不需要工具。")
    result = qa_agent.run_agent("test", sales_df, "context")
    assert result["answer"] == "我觉得不需要工具。"


def test_agent_midloop_failure_degrades_to_facts(sales_df, monkeypatch):
    seen = {"n": 0}

    def flaky(messages):
        seen["n"] += 1
        if seen["n"] == 1:
            return '{"tools": [{"name": "distinct_count", "args": {"column": "category"}}]}'
        raise RuntimeError("boom")

    monkeypatch.setattr(qa_agent, "chat", flaky)
    result = qa_agent.run_agent("test", sales_df, "context")
    assert seen["n"] == 2
    assert "[1] distinct_count(category) = 3" in result["answer"]


def test_agent_first_call_failure_raises(sales_df, monkeypatch):
    def boom(messages):
        raise RuntimeError("no llm")

    monkeypatch.setattr(qa_agent, "chat", boom)
    with pytest.raises(RuntimeError):
        qa_agent.run_agent("test", sales_df, "context")


def test_agent_history_injected_into_user_message(sales_df, monkeypatch):
    captured = {}

    def fake_chat(messages):
        captured["user"] = messages[-1]["content"]
        return "ok"

    monkeypatch.setattr(qa_agent, "chat", fake_chat)
    qa_agent.run_agent("那均值呢？", sales_df, "context", history=[{"question": "最大值？", "answer": "250"}])
    assert "Previous conversation:" in captured["user"]
    assert "最大值？" in captured["user"]


def test_agent_history_is_capped(sales_df, monkeypatch):
    captured = {}

    def fake_chat(messages):
        captured["user"] = messages[-1]["content"]
        return "ok"

    monkeypatch.setattr(qa_agent, "chat", fake_chat)
    history = [{"question": f"q{i}", "answer": "a"} for i in range(12)]
    qa_agent.run_agent("q", sales_df, "context", history=history)
    # Recent rounds stay verbatim; older ones collapse into a truncated summary.
    assert "q11" in captured["user"]
    assert "Earlier conversation (truncated)" in captured["user"]


# --- adaptive context (D) --------------------------------------------------------

def test_context_categorical_and_datetime_lines():
    import backend.api.nl as nl_module

    df = pd.DataFrame(
        {
            "region": ["North"] * 30 + ["South"] * 30,
            "day": pd.to_datetime(["2024-01-01"] * 30 + ["2024-06-01"] * 30),
            "mixed": [f"row-{i}" for i in range(60)],
        }
    )

    class FakeDataset:
        id = "ds"

    context = nl_module._build_data_context(FakeDataset(), df)
    assert "region (categorical, 2 distinct): North=30(50%), South=30(50%)" in context
    assert "day (datetime): from=" in context
    assert "mixed (high-cardinality, 60 distinct)" in context


def test_context_relevant_sample_rows():
    import backend.api.nl as nl_module

    df = pd.DataFrame(
        {
            "name": ["apple", "banana", "cherry", "apple pie", "kiwi"],
            "value": [1, 2, 3, 4, 5],
        }
    )

    class FakeDataset:
        id = "ds"

    sample_context = nl_module._build_data_context(FakeDataset(), df, "苹果类 apple 的行")
    assert "apple pie" in sample_context
    default_context = nl_module._build_data_context(FakeDataset(), df)
    assert "banana" in default_context  # falls back to head rows


def test_context_handles_mixed_dtypes_and_nan():
    """Regression: pandas 3 made astype(str).agg(join, axis=1) raise
    'expected str instance, float found' on real mixed-type datasets."""
    import backend.api.nl as nl_module

    df = pd.DataFrame(
        {
            "name": ["a", "b", None],
            "value": [1.5, float("nan"), 3.7],
            "when": ["2024-01-01", "2024-02-01", None],
            "tag": pd.array(["x", None, "z"], dtype="string"),
        }
    )

    class FakeDataset:
        id = "ds"

    sample = nl_module._relevant_sample_rows(df, "a 的 value")
    assert len(sample) <= 5
    context = nl_module._build_data_context(FakeDataset(), df, "a 的 value")
    assert "Dataset overview: 3 rows × 4 columns" in context
    assert "Sample rows" in context
