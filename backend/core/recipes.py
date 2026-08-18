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
        "name": "删除重复",
        "description": "删除完全重复的行。",
        "dynamic": False,
    },
    {
        "id": "dropna",
        "name": "删除缺失行",
        "description": "删除包含缺失值的行。",
        "dynamic": False,
    },
    {
        "id": "fillna-median-numeric",
        "name": "数值列中位数填充",
        "description": "用中位数填充数值列的缺失值。",
        "dynamic": True,
    },
    {
        "id": "clip-outliers",
        "name": "裁剪异常值（1.5×IQR）",
        "description": "将超出 1.5×IQR 边界的数值裁剪到边界。",
        "dynamic": True,
    },
    {
        "id": "coerce-numeric",
        "name": "数字字符串转数值",
        "description": "将看起来是数值的字符串列（>80% 可解析）转为 float。",
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
                median = df[col].median()
                if pd.notna(median):
                    steps.append({"type": "fillna", "params": {"column": col, "value": float(median)}})
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


SAFE_QUALITY_RECIPES = {
    "duplicates": "dedupe",
    "missing": "fillna-median-numeric",
    "outliers": "clip-outliers",
    "type": "coerce-numeric",
}


def build_quality_fix_plan(
    df: pd.DataFrame,
    issue_ids: list[str] | None = None,
) -> dict[str, Any]:
    """Build a deterministic, non-destructive-by-default quality repair plan."""
    from backend.core.dataframe import Dataset, parse_numeric_series
    from backend.core.quality import detect_quality

    report = detect_quality(df)
    selected = set(issue_ids) if issue_ids is not None else set(SAFE_QUALITY_RECIPES)
    available = {issue["id"] for issue in report["issues"]}
    selected &= available

    affected: dict[str, int] = {}
    if "duplicates" in selected:
        affected["duplicates"] = int(df.duplicated().sum())
    if "missing" in selected:
        affected["missing"] = int(df.select_dtypes(include="number").isna().sum().sum())
    if "outliers" in selected:
        count = 0
        for col in df.select_dtypes(include="number").columns:
            q1, q3 = df[col].quantile(0.25), df[col].quantile(0.75)
            iqr = q3 - q1
            if iqr and iqr != 0:
                count += int(((df[col] < q1 - 1.5 * iqr) | (df[col] > q3 + 1.5 * iqr)).sum())
        affected["outliers"] = count
    if "type" in selected:
        count = 0
        for col in df.columns:
            if pd.api.types.is_string_dtype(df[col]) or pd.api.types.is_object_dtype(df[col]):
                parsed = parse_numeric_series(df[col])
                if parsed.notna().sum() >= 1 and parsed.notna().mean() >= 0.8:
                    count += int(df[col].notna().sum())
        affected["type"] = count

    scratch = Dataset(df.copy(), name="quality-preview")
    operations: list[dict[str, Any]] = []
    for issue_id in ("duplicates", "missing", "outliers", "type"):
        if issue_id not in selected:
            continue
        steps = build_steps(SAFE_QUALITY_RECIPES[issue_id], scratch.df)
        for step in steps:
            scratch.apply(step)
        operations.extend(steps)

    issues = [issue for issue in report["issues"] if issue["id"] in selected]
    return {"operations": operations, "issues": issues, "affected": affected}


def recipe_steps_for_issue(df: pd.DataFrame, recipe_id: str) -> list[dict[str, Any]]:
    """Resolve a recipe id to concrete steps (user recipe first, then preset)."""
    from backend.core.user_recipes import get_user_recipe

    user_recipe = get_user_recipe(recipe_id)
    if user_recipe is not None:
        return user_recipe.get("steps", [])
    if recipe_id not in RECIPE_IDS:
        raise ValueError(f"Unknown recipe: {recipe_id}")
    return build_steps(recipe_id, df)
