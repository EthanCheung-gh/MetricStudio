"""Time-series analysis: monthly aggregation + period-over-period change."""

from __future__ import annotations

from typing import Any

import pandas as pd


def _temporal_col(df: pd.DataFrame) -> str | None:
    for c in df.columns:
        if pd.api.types.is_datetime64_any_dtype(df[c]):
            return c
        if (
            pd.api.types.is_string_dtype(df[c]) or pd.api.types.is_object_dtype(df[c])
        ) and not isinstance(df[c].dtype, pd.CategoricalDtype):
            parsed = pd.to_datetime(df[c], errors="coerce")
            if parsed.notna().mean() >= 0.9:
                return c
    return None


def analyze_timeseries(df: pd.DataFrame, column: str) -> dict[str, Any]:
    """Monthly mean + period-over-period change for a numeric column."""
    temporal = _temporal_col(df)
    if temporal is None:
        return {"ok": False, "reason": "未找到时间列"}
    ts = pd.to_datetime(df[temporal], errors="coerce")
    monthly = df.groupby(ts.dt.to_period("M"))[column].mean().dropna()
    if len(monthly) < 2:
        return {"ok": False, "reason": "时间序列数据不足（少于两个月）"}

    periods = [str(p) for p in monthly.index]
    values = [round(float(v), 2) for v in monthly.values]
    pct_change = [None]
    for i in range(1, len(values)):
        prev = values[i - 1]
        pct_change.append(round((values[i] - prev) / abs(prev) * 100, 1) if prev else None)

    return {
        "ok": True,
        "temporal_column": temporal,
        "column": column,
        "periods": periods,
        "values": values,
        "pct_change": pct_change,
    }
