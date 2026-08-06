"""Unit tests for the cleaning-related transform operators."""

import pandas as pd

from backend.core.dataframe import apply_dedupe, apply_clip, apply_parse_numeric, parse_numeric_series


def test_apply_dedupe_removes_fully_duplicate_rows():
    df = pd.DataFrame({"a": [1, 1, 2], "b": ["x", "x", "y"]})
    out = apply_dedupe(df, {})
    assert len(out) == 2

    # subset dedupe keeps rows unique on those columns only
    df2 = pd.DataFrame({"a": [1, 1, 2], "b": ["x", "y", "z"]})
    out2 = apply_dedupe(df2, {"columns": ["a"]})
    assert len(out2) == 2


def test_apply_clip_caps_outliers():
    df = pd.DataFrame({"v": [1.0, 500.0, 3.0]})
    out = apply_clip(df, {"column": "v", "min": 0.0, "max": 100.0})
    assert out["v"].tolist() == [1.0, 100.0, 3.0]


def test_apply_clip_requires_bound():
    df = pd.DataFrame({"v": [1.0, 2.0]})
    try:
        apply_clip(df, {"column": "v"})
        raise AssertionError("expected ValueError")
    except ValueError:
        pass


def test_parse_numeric_series_tolerates_formats():
    s = pd.Series([" 10 ", "1,000", "25%", "$3.5", "n/a"])
    out = parse_numeric_series(s)
    assert out.tolist()[:4] == [10.0, 1000.0, 25.0, 3.5]
    assert pd.isna(out.iloc[4])


def test_apply_parse_numeric_rewrites_column(dirty_df):
    out = apply_parse_numeric(dirty_df, {"column": "num_str"})
    assert out["num_str"].dtype.kind in "fi"
    assert out["num_str"].iloc[0] == 1000.0
