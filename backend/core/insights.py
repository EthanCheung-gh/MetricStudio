"""Rule-based data insights (AI summary, no LLM required).

Every insight is emitted as {"text": ..., "evidence": {...}} where the
numbers embedded in `text` are exactly the values in `evidence` — this
makes the summary verifiable (anti-hallucination by construction).
"""

from __future__ import annotations

from typing import Any

import pandas as pd

from backend.core.engine import DataEngine

_engine = DataEngine("auto")


def _numeric_cols(df: pd.DataFrame) -> list[str]:
    return [c for c in df.columns if pd.api.types.is_numeric_dtype(df[c])]


def _temporal_cols(df: pd.DataFrame) -> list[str]:
    cols = []
    for c in df.columns:
        if pd.api.types.is_datetime64_any_dtype(df[c]):
            cols.append(c)
            continue
        # Only string/object columns can hold date text like 2024-01-01;
        # numeric columns would be misread as epoch timestamps.
        if not (
            pd.api.types.is_string_dtype(df[c])
            or pd.api.types.is_object_dtype(df[c])
        ) or isinstance(df[c].dtype, pd.CategoricalDtype):
            continue
        try:
            parsed = pd.to_datetime(df[c], errors="coerce")
            if parsed.notna().mean() >= 0.9:
                cols.append(c)
        except (TypeError, ValueError):
            continue
    return cols


def _nominal_cols(df: pd.DataFrame) -> list[str]:
    numeric = set(_numeric_cols(df))
    return [c for c in df.columns if c not in numeric and c not in _temporal_cols(df)]


def generate_insights(
    df: pd.DataFrame, max_insights: int = 8, locale: str = "zh"
) -> list[dict[str, Any]]:
    english = locale == "en"
    insights: list[dict[str, Any]] = []
    numeric = _numeric_cols(df)
    temporal = _temporal_cols(df)
    nominal = _nominal_cols(df)

    # ---- 1. Temporal trend on the first numeric column ----
    if temporal and numeric:
        tcol, ncol = temporal[0], numeric[0]
        ts = pd.to_datetime(df[tcol], errors="coerce")
        monthly = df.groupby(ts.dt.to_period("M"))[ncol].mean().dropna()
        if len(monthly) >= 2:
            start, end = float(monthly.iloc[0]), float(monthly.iloc[-1])
            if abs(start) > 1e-12:
                pct = (end - start) / abs(start) * 100
                direction = "rose" if end > start else "fell"
                text = (
                    f"{ncol} mean {direction} {abs(pct):.0f}% from {monthly.index[0]} ({start:.1f}) "
                    f"to {monthly.index[-1]} ({end:.1f})"
                    if english
                    else f"{ncol} 均值从 {monthly.index[0]}（{start:.1f}）到 {monthly.index[-1]}（{end:.1f}）"
                    f"{'上升' if end > start else '下降'} {abs(pct):.0f}%"
                )
                insights.append({
                    "type": "trend",
                    "text": text,
                    "evidence": {
                        "metric": "monthly_mean",
                        "field": ncol,
                        "start_period": str(monthly.index[0]),
                        "end_period": str(monthly.index[-1]),
                        "start": round(start, 1),
                        "end": round(end, 1),
                        "pct": round(pct),
                    },
                })

    # ---- 2. Category concentration (single class dominates) ----
    for col in nominal:
        counts = df[col].value_counts(normalize=True, dropna=False)
        if counts.empty:
            continue
        top, share = counts.index[0], float(counts.iloc[0])
        if share >= 0.4:
            insights.append({
                "type": "concentration",
                "text": (
                    f'{share * 100:.0f}% of rows in {col} are "{top}"'
                    if english else f"{col} 中 {share * 100:.0f}% 的行属于“{top}”"
                ),
                "evidence": {"field": col, "top_value": str(top), "share": round(share, 3)},
            })

    # ---- 3. Distribution skew (mean vs median divergence) ----
    for col in numeric:
        mean, med = float(df[col].mean()), float(df[col].median())
        if abs(med) <= 1e-12:
            continue
        ratio = abs(mean - med) / abs(med)
        if ratio >= 0.3:
            insights.append({
                "type": "skew",
                "text": (
                    f"{col} mean ({mean:.1f}) is {'above' if mean > med else 'below'} the median ({med:.1f})"
                    if english else f"{col} 均值（{mean:.1f}）{'高于' if mean > med else '低于'}中位数（{med:.1f}）"
                ),
                "evidence": {"field": col, "mean": round(mean, 1), "median": round(med, 1)},
            })

    # ---- 4. Strongest correlation between numeric columns ----
    if len(numeric) >= 2:
        corr = df[numeric].corr().abs()
        pairs = []
        for i, a in enumerate(numeric):
            for b in numeric[i + 1:]:
                v = corr.loc[a, b]
                if v == v and v >= 0.6:
                    pairs.append((v, a, b))
        if pairs:
            v, a, b = max(pairs)
            insights.append({
                "type": "correlation",
                "text": (
                    f"{a} and {b} are strongly correlated (|r| = {v:.2f})"
                    if english else f"{a} 与 {b} 强相关（|r| = {v:.2f}）"
                ),
                "evidence": {"a": a, "b": b, "r": round(v, 2)},
            })

    # ---- 5. Missing-value flag (reuse quality detector) ----
    missing_ratio = df.isna().mean()
    worst = missing_ratio.idxmax() if missing_ratio.any() else None
    if worst is not None and missing_ratio[worst] > 0:
        pct = round(float(missing_ratio[worst]) * 100)
        insights.append({
            "type": "missing",
            "text": (
                f"{worst} has {pct}% missing values"
                if english else f"{worst} 有 {pct}% 缺失值"
            ),
            "evidence": {"field": worst, "missing_pct": pct},
        })

    return insights[:max_insights]
