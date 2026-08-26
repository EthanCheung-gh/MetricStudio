"""Rule-based data quality detection (no LLM required).

Produces a structured report of common cleanliness issues; each issue
carries a severity, a list of preset recipe ids that can fix it, and up to
three sample rows for the quality center UI.
"""

from __future__ import annotations

import re
from collections import Counter
from typing import Any

import pandas as pd

_SAMPLE_LIMIT = 3


def _samples(df: pd.DataFrame, mask: pd.Series) -> list[dict[str, Any]]:
    """Return the first few offending rows keyed by label for the UI."""
    rows: list[dict[str, Any]] = []
    for index, row in df[mask].head(_SAMPLE_LIMIT).iterrows():
        rows.append({
            "row": str(index),
            "values": {str(column): row[column] for column in df.columns},
        })
    return rows


def _dominant_format(values: pd.Series) -> str:
    """Classify the dominant string shape of a non-null sample."""
    shapes: Counter[str] = Counter()
    for value in values.dropna().astype(str).head(200):
        shapes[re.sub(r"[A-Za-z]", "A", re.sub(r"\d", "9", value))] += 1
    return shapes.most_common(1)[0][0] if shapes else ""


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
            "title": "缺失值",
            "detail": detail,
            "columns": miss_cols,
            "suggestions": ["fillna-median-numeric", "dropna"],
            "samples": [],
        })

    # 2. Fully duplicate rows
    dup_mask = df.duplicated(keep=False)
    n_dup = int(df.duplicated().sum())
    if n_dup:
        issues.append({
            "id": "duplicates",
            "severity": "warning",
            "title": "重复行",
            "detail": f"{n_dup} 行完全重复",
            "columns": [],
            "suggestions": ["dedupe"],
            "samples": _samples(df, dup_mask),
        })

    # 3. Outliers on numeric columns (1.5 * IQR)
    for col in df.select_dtypes(include="number").columns:
        q1, q3 = df[col].quantile(0.25), df[col].quantile(0.75)
        iqr = q3 - q1
        if not iqr or iqr == 0:
            continue
        lo, hi = q1 - 1.5 * iqr, q3 + 1.5 * iqr
        outlier_mask = (df[col] < lo) | (df[col] > hi)
        n = int(outlier_mask.sum())
        if n:
            issues.append({
                "id": "outliers",
                "severity": "info",
                "title": "异常值",
                "detail": f"{col}: {n} 个值超出 1.5×IQR",
                "columns": [col],
                "suggestions": ["clip-outliers"],
                "samples": _samples(df, outlier_mask),
            })

    # 4. Constant / near-constant columns
    for col in df.columns:
        if df[col].nunique(dropna=False) <= 1:
            issues.append({
                "id": "constant",
                "severity": "info",
                "title": "常量列",
                "detail": f"{col} 只有 1 个唯一值",
                "columns": [col],
                "suggestions": [],
                "samples": [],
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
                    "title": "数字字符串列",
                    "detail": f"{col} 可转换为数值",
                    "columns": [col],
                    "suggestions": ["coerce-numeric"],
                    "samples": [],
                })

    # 6. Format / whitespace anomalies in text columns
    for col in df.columns:
        series = df[col]
        if not (
            pd.api.types.is_string_dtype(series) or pd.api.types.is_object_dtype(series)
        ) or isinstance(series.dtype, pd.CategoricalDtype):
            continue
        text = series.dropna().astype(str)
        if text.empty:
            continue
        dirty_mask = series.notna() & series.astype(str).str.match(r"^\s|\s$")
        extra = series.notna() & series.astype(str).str.contains(r"\s{2,}", na=False, regex=True)
        combined = dirty_mask | extra
        n = int(combined.sum())
        if n:
            issues.append({
                "id": "format",
                "severity": "warning",
                "title": "格式问题",
                "detail": f"{col}: {n} 个值存在首尾空格或连续空格（主流格式 {_dominant_format(text)}）",
                "columns": [str(col)],
                "suggestions": ["trim-whitespace"],
                "samples": _samples(df, combined),
            })

    return {"issues": issues, "summary": _summary(df), "column_stats": column_stats(df)}


def column_stats(df: pd.DataFrame) -> list[dict[str, Any]]:
    """Per-column quality summary rendered as the quality-center table."""
    stats: list[dict[str, Any]] = []
    for col in df.columns:
        series = df[col]
        missing = int(series.isna().sum())
        entry: dict[str, Any] = {
            "column": str(col),
            "dtype": str(series.dtype),
            "missing": missing,
            "missing_ratio": round(float(series.isna().mean()) * 100, 1),
            "unique": int(series.nunique(dropna=True)),
        }
        if pd.api.types.is_numeric_dtype(series):
            numeric = series.dropna()
            if len(numeric):
                q1, q3 = numeric.quantile(0.25), numeric.quantile(0.75)
                iqr = q3 - q1
                outliers = int(((numeric < q1 - 1.5 * iqr) | (numeric > q3 + 1.5 * iqr)).sum()) if iqr else 0
                entry.update({
                    "min": _round_or_none(numeric.min()),
                    "max": _round_or_none(numeric.max()),
                    "mean": _round_or_none(numeric.mean()),
                    "outliers": outliers,
                })
        else:
            top = series.mode(dropna=True)
            entry["top"] = str(top.iloc[0])[:60] if len(top) else None
        stats.append(entry)
    return stats


def _round_or_none(value: Any) -> float | None:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return round(number, 2) if number == number else None  # drop NaN


def _summary(df: pd.DataFrame) -> dict[str, Any]:
    dup_mask = df.duplicated()
    return {
        "missing_cells": int(df.isna().sum().sum()),
        "duplicate_rows": int(dup_mask.sum()),
        "columns": int(df.shape[1]),
        "rows": int(df.shape[0]),
    }
