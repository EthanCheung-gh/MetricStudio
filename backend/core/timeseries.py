"""Time-series analysis: monthly aggregation, PoP/YoY change, moving average,
outlier detection (residual vs. moving average), and a naive next-period forecast.

All statistics are deterministic pandas computations; no LLM involved.
"""

from __future__ import annotations

from typing import Any

import pandas as pd

_MOVING_WINDOW = 3
_FORECAST_HORIZON = 3
_OUTLIER_SIGMA = 2.0


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


def _monthly_series(df: pd.DataFrame, column: str, temporal: str) -> pd.Series:
    ts = pd.to_datetime(df[temporal], errors="coerce")
    return df.groupby(ts.dt.to_period("M"))[column].mean().dropna()


def analyze_timeseries(df: pd.DataFrame, column: str) -> dict[str, Any]:
    """Monthly mean + PoP/YoY + moving average + anomalies + naive forecast."""
    temporal = _temporal_col(df)
    if temporal is None:
        return {"ok": False, "reason": "未找到时间列"}
    monthly = _monthly_series(df, column, temporal)
    if len(monthly) < 2:
        return {"ok": False, "reason": "时间序列数据不足（少于两个月）"}

    values = [round(float(v), 2) for v in monthly.values]
    periods = [str(p) for p in monthly.index]

    # Period-over-period (MoM) and year-over-year changes.
    pct_change: list[float | None] = [None]
    for i in range(1, len(values)):
        prev = values[i - 1]
        pct_change.append(round((values[i] - prev) / abs(prev) * 100, 1) if prev else None)
    yoy_change: list[float | None] = []
    by_period = {periods[i]: values[i] for i in range(len(periods))}
    for i, period in enumerate(periods):
        year, month = period.split("-")
        same_month_last_year = f"{int(year) - 1}-{month}"
        last = by_period.get(same_month_last_year)
        current = values[i]
        yoy_change.append(
            round((current - last) / abs(last) * 100, 1) if last and last != 0 else None
        )

    # Centered-free trailing moving average over the configured window.
    moving_average: list[float | None] = []
    for i in range(len(values)):
        window = values[max(0, i - _MOVING_WINDOW + 1) : i + 1]
        moving_average.append(round(sum(window) / len(window), 2))

    # Anomalies: deviation from the moving average beyond N sigma of residuals.
    residuals = [
        values[i] - moving_average[i]
        for i in range(len(values))
        if moving_average[i] is not None
    ]
    anomalies: list[int] = []
    if len(residuals) >= 3:
        sigma = pd.Series(residuals).std()
        mean = sum(residuals) / len(residuals)
        if sigma and sigma > 0:
            for i in range(len(values)):
                if moving_average[i] is None:
                    continue
                z = (values[i] - mean) / sigma
                if abs(z) >= _OUTLIER_SIGMA:
                    anomalies.append(i)

    # Naive drift forecast: extend the recent linear trend.
    forecast_periods: list[str] = []
    forecast_values: list[float] = []
    if len(values) >= 3:
        recent = values[-min(6, len(values)) :]
        step = (recent[-1] - recent[0]) / (len(recent) - 1)
        last_period = monthly.index[-1]
        for offset in range(1, _FORECAST_HORIZON + 1):
            nxt = last_period + offset
            forecast_periods.append(str(nxt))
            forecast_values.append(round(max(0.0, values[-1] + step * offset), 2))

    return {
        "ok": True,
        "temporal_column": temporal,
        "column": column,
        "periods": periods,
        "values": values,
        "pct_change": pct_change,
        "yoy_change": yoy_change,
        "moving_average": moving_average,
        "moving_window": _MOVING_WINDOW,
        "anomaly_indexes": anomalies,
        "forecast_periods": forecast_periods,
        "forecast_values": forecast_values,
    }
