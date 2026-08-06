"""Rule-based data quality detection (no LLM required).

Produces a structured report of common cleanliness issues; each issue
carries a severity and a list of preset recipe ids that can fix it.
"""

from __future__ import annotations

from typing import Any

import pandas as pd


def detect_quality(df: pd.DataFrame) -> dict[str, Any]:
    issues: list[dict[str, Any]] = []

    # 1. Missing values per column
    miss_ratio = df.isna().mean()
    miss_cols = [c for c in df.columns if miss_ratio[c] > 0]
    if miss_cols:
        detail = ", ".join(f"{c}: {miss_ratio[c] * 100:.0f}%" for c in miss_cols)
        issues.append({
            "id": "missing",
            "severity": "warning",
            "title": "Missing values",
            "detail": detail,
            "columns": miss_cols,
            "suggestions": ["fillna-median-numeric", "dropna"],
        })

    # 2. Fully duplicate rows
    n_dup = int(df.duplicated().sum())
    if n_dup:
        issues.append({
            "id": "duplicates",
            "severity": "warning",
            "title": "Duplicate rows",
            "detail": f"{n_dup} fully duplicate row(s)",
            "columns": [],
            "suggestions": ["dedupe"],
        })

    # 3. Outliers on numeric columns (1.5 * IQR)
    for col in df.select_dtypes(include="number").columns:
        q1, q3 = df[col].quantile(0.25), df[col].quantile(0.75)
        iqr = q3 - q1
        if not iqr or iqr == 0:
            continue
        lo, hi = q1 - 1.5 * iqr, q3 + 1.5 * iqr
        n = int(((df[col] < lo) | (df[col] > hi)).sum())
        if n:
            issues.append({
                "id": "outliers",
                "severity": "info",
                "title": "Outliers",
                "detail": f"{col}: {n} value(s) beyond 1.5×IQR",
                "columns": [col],
                "suggestions": ["clip-outliers"],
            })

    # 4. Constant / near-constant columns
    for col in df.columns:
        if df[col].nunique(dropna=False) <= 1:
            issues.append({
                "id": "constant",
                "severity": "info",
                "title": "Constant column",
                "detail": f"{col} has a single unique value",
                "columns": [col],
                "suggestions": [],
            })

    # 5. Numeric-looking string columns (candidates for type coercion)
    from backend.core.dataframe import parse_numeric_series

    for col in df.columns:
        # pandas 2.x uses StringDtype; object catches legacy frames
        if (
            pd.api.types.is_string_dtype(df[col])
            or pd.api.types.is_object_dtype(df[col])
        ) and not isinstance(df[col].dtype, pd.CategoricalDtype):
            numeric = parse_numeric_series(df[col])
            if numeric.notna().sum() >= 1 and numeric.notna().mean() >= 0.8:
                issues.append({
                    "id": "type",
                    "severity": "info",
                    "title": "Numeric string column",
                    "detail": f"{col} can be coerced to numeric",
                    "columns": [col],
                    "suggestions": ["coerce-numeric"],
                })

    summary = {
        "missing_cells": int(df.isna().sum().sum()),
        "duplicate_rows": n_dup,
        "columns": int(df.shape[1]),
        "rows": int(df.shape[0]),
    }
    return {"issues": issues, "summary": summary}
