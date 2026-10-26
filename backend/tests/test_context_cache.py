"""Cost: the QA prompt context and its evidence must be computed once.

Regression guard for the memoized frame facts (v1.16.0). Both readers used to
recompute ``describe`` + ``generate_insights`` per turn, which cost ~270ms on a
20-column frame and landed on the critical path before the first LLM token.
"""

from __future__ import annotations

import pandas as pd
import pytest

import backend.api.nl as nl
from backend.core.dataframe import Dataset


@pytest.fixture(autouse=True)
def _clean_cache():
    nl._clear_context_cache()
    yield
    nl._clear_context_cache()


@pytest.fixture
def frame() -> pd.DataFrame:
    return pd.DataFrame(
        {
            "region": ["North", "South", "North", "East"],
            "amount": [10.0, 20.0, 30.0, 40.0],
            "day": ["2024-01-01", "2024-01-02", "2024-01-03", "2024-01-04"],
        }
    )


def _counting_insights(monkeypatch) -> dict[str, int]:
    calls = {"n": 0}
    import backend.core.insights as insights_module

    real = insights_module.generate_insights

    def counted(df):
        calls["n"] += 1
        return real(df)

    monkeypatch.setattr(insights_module, "generate_insights", counted)
    return calls


def test_context_is_memoized(frame, monkeypatch):
    calls = _counting_insights(monkeypatch)
    dataset = Dataset(frame, name="ds")

    first = nl._build_data_context(dataset, dataset.df, "哪个地区总和最高")
    second = nl._build_data_context(dataset, dataset.df, "哪个地区总和最高")

    assert first == second
    assert calls["n"] == 1


def test_evidence_reuses_context_frame_facts(frame, monkeypatch):
    calls = _counting_insights(monkeypatch)
    dataset = Dataset(frame, name="ds")

    nl._build_data_context(dataset, dataset.df, "q")
    evidence = nl._build_data_evidence(dataset, dataset.df, None)

    assert calls["n"] == 1
    assert any(item["kind"] == "statistics" and "amount" in item["detail"] for item in evidence)
    assert any(item["kind"] == "schema" for item in evidence)


def test_cache_invalidates_after_value_change(frame, monkeypatch):
    calls = _counting_insights(monkeypatch)
    dataset = Dataset(frame, name="ds")
    nl._build_data_context(dataset, dataset.df, "q")

    # fillna keeps every index label: only Dataset.revision can catch this.
    dataset.apply({"type": "fillna", "params": {"column": "amount", "value": 0}})
    nl._build_data_context(dataset, dataset.df, "q")

    assert calls["n"] == 2


def test_cache_invalidates_after_row_subset(frame, monkeypatch):
    calls = _counting_insights(monkeypatch)
    dataset = Dataset(frame, name="ds")
    nl._build_data_context(dataset, dataset.df, "q")

    filtered = dataset.df[dataset.df["region"] == "North"]
    context = nl._build_data_context(dataset, filtered, "q")

    assert calls["n"] == 2
    assert "2 rows" in context


def test_cache_isolated_by_data_scope(frame, monkeypatch):
    calls = _counting_insights(monkeypatch)
    dataset = Dataset(frame, name="ds")

    monkeypatch.setattr(nl, "load_config", lambda: {"data_scope": "all"})
    nl._build_data_context(dataset, dataset.df, "q")
    monkeypatch.setattr(nl, "load_config", lambda: {"data_scope": "exclude_sensitive"})
    nl._build_data_context(dataset, dataset.df, "q")

    assert calls["n"] == 2


def test_cache_invalidates_after_out_of_band_df_replacement(frame, monkeypatch):
    """Session source auto-refresh replaces ``_df`` directly (same row labels)."""
    calls = _counting_insights(monkeypatch)
    dataset = Dataset(frame, name="ds")
    nl._build_data_context(dataset, dataset.df, "q")

    replacement = frame.copy()
    replacement.loc[:, "amount"] = [100.0, 200.0, 300.0, 400.0]
    dataset._df = replacement
    context = nl._build_data_context(dataset, dataset.df, "q")

    assert calls["n"] == 2
    assert "max=400" in context


def test_revision_tracks_every_frame_write(frame):
    dataset = Dataset(frame, name="ds")
    start = dataset.revision
    dataset.apply({"type": "dedupe", "params": {}})
    dataset.reset()
    dataset._df = frame.iloc[:2]
    assert dataset.revision >= start + 3


def test_frame_signature_ignores_unrelated_datasets(frame):
    a = Dataset(frame, name="a")
    b = Dataset(frame.copy(), name="b")

    assert nl._frame_signature(a, a.df) != nl._frame_signature(b, b.df)
