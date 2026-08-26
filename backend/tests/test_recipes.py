"""Unit tests for preset cleaning recipes (the "skills")."""

import pytest

from backend.core.recipes import build_steps, recipe_steps_for_issue, list_recipes


def test_list_recipes_has_all_presets():
    ids = {r["id"] for r in list_recipes()}
    assert ids == {
        "dedupe",
        "dropna",
        "fillna-median-numeric",
        "clip-outliers",
        "coerce-numeric",
        "trim-whitespace",
    }


def test_static_recipes(dirty_df):
    assert build_steps("dedupe", dirty_df) == [{"type": "dedupe", "params": {}}]
    assert build_steps("dropna", dirty_df) == [{"type": "dropna", "params": {}}]


def test_fillna_median_generates_one_step_per_numeric_column(dirty_df):
    steps = build_steps("fillna-median-numeric", dirty_df)
    # Only `score` has missing values among numeric columns
    assert steps == [
        {"type": "fillna", "params": {"column": "score", "value": float(dirty_df["score"].median())}}
    ]


def test_fillna_median_noop_when_nothing_missing(clean_df):
    assert build_steps("fillna-median-numeric", clean_df) == []


def test_clip_outliers_generates_bounds_from_iqr(dirty_df):
    steps = build_steps("clip-outliers", dirty_df)
    by_col = {s["params"]["column"]: s["params"] for s in steps}
    assert "value" in by_col and "score" in by_col
    # value=500 is beyond the IQR upper bound
    assert by_col["value"]["max"] < 500
    # score=999 is beyond the IQR upper bound
    assert by_col["score"]["max"] < 999


def test_coerce_numeric_uses_parse_numeric_operator(dirty_df):
    steps = build_steps("coerce-numeric", dirty_df)
    assert steps == [{"type": "parse_numeric", "params": {"column": "num_str"}}]


def test_trim_whitespace_targets_dirty_text_columns_only():
    import pandas as pd

    df = pd.DataFrame({"dirty": ["  a", "b  ", "c  d"], "clean_text": ["x", "y", "z"], "value": [1, 2, 3]})
    steps = build_steps("trim-whitespace", df)
    assert steps == [{"type": "str_clean", "params": {"column": "dirty", "action": "trim"}}]


def test_trim_whitespace_noop_on_clean_frames(clean_df):
    assert build_steps("trim-whitespace", clean_df) == []


def test_unknown_recipe_raises(dirty_df):
    with pytest.raises(ValueError):
        recipe_steps_for_issue(dirty_df, "does-not-exist")
