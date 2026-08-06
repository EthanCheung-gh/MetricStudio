"""Preset cleaning recipes ("skills") for the cleaning assistant.

Each recipe is a named, reusable cleaning capability. Static recipes map
1:1 to transform ops; dynamic recipes inspect the current DataFrame and
emit concrete operation steps (e.g. median-fill per numeric column).
"""

from __future__ import annotations

from typing import Any

import pandas as pd

RECIPE_META: list[dict[str, Any]] = [
    {
        "id": "dedupe",
        "name": "Remove duplicates",
        "description": "Drop fully duplicate rows.",
        "dynamic": False,
    },
    {
        "id": "dropna",
        "name": "Drop missing rows",
        "description": "Drop rows that contain missing values.",
        "dynamic": False,
    },
    {
        "id": "fillna-median-numeric",
        "name": "Fill numeric missing with median",
        "description": "Fill missing values in numeric columns with their median.",
        "dynamic": True,
    },
    {
        "id": "clip-outliers",
        "name": "Cap outliers (1.5×IQR)",
        "description": "Clip numeric columns outside the 1.5×IQR bounds to the bounds.",
        "dynamic": True,
    },
    {
        "id": "coerce-numeric",
        "name": "Coerce numeric strings",
        "description": "Cast object columns that look numeric (>80% parseable) to float.",
        "dynamic": True,
    },
]

RECIPE_IDS = {r["id"] for r in RECIPE_META}


def list_recipes() -> list[dict[str, Any]]:
    return RECIPE_META


def build_steps(recipe_id: str, df: pd.DataFrame) -> list[dict[str, Any]]:
    """Generate concrete transform operations for a recipe against a dataframe."""
    if recipe_id == "dedupe":
        return [{"type": "dedupe", "params": {}}]
    if recipe_id == "dropna":
        return [{"type": "dropna", "params": {}}]
    if recipe_id == "fillna-median-numeric":
        steps = []
        for col in df.select_dtypes(include="number").columns:
            if df[col].isna().any():
                median = float(df[col].median())
                steps.append({"type": "fillna", "params": {"column": col, "value": median}})
        return steps
    if recipe_id == "clip-outliers":
        steps = []
        for col in df.select_dtypes(include="number").columns:
            q1, q3 = df[col].quantile(0.25), df[col].quantile(0.75)
            iqr = q3 - q1
            if not iqr or iqr == 0:
                continue
            lo, hi = q1 - 1.5 * iqr, q3 + 1.5 * iqr
            if int(((df[col] < lo) | (df[col] > hi)).sum()):
                steps.append({"type": "clip", "params": {"column": col, "min": float(lo), "max": float(hi)}})
        return steps
    if recipe_id == "coerce-numeric":
        from backend.core.dataframe import parse_numeric_series

        steps = []
        for col in df.columns:
            if (
                pd.api.types.is_string_dtype(df[col])
                or pd.api.types.is_object_dtype(df[col])
            ) and not isinstance(df[col].dtype, pd.CategoricalDtype):
                numeric = parse_numeric_series(df[col])
                if numeric.notna().sum() >= 1 and numeric.notna().mean() >= 0.8:
                    steps.append({"type": "parse_numeric", "params": {"column": col}})
        return steps
    return []


def recipe_steps_for_issue(df: pd.DataFrame, recipe_id: str) -> list[dict[str, Any]]:
    """Build steps, guarding against unknown recipe ids."""
    if recipe_id not in RECIPE_IDS:
        raise ValueError(f"Unknown recipe: {recipe_id}")
    return build_steps(recipe_id, df)
