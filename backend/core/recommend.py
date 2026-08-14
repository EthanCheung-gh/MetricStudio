"""Rule-based chart recommendations.

Deterministic by construction: given a dataframe, the same recommendations
are always produced, and every recommended encoding is executable against
the chart preview API (verified by tests).
"""

from __future__ import annotations

from typing import Any

import pandas as pd

from backend.core.engine import DataEngine

_engine = DataEngine("auto")


def _col_types(df: pd.DataFrame) -> dict[str, str]:
    """Return column -> type category using the same inference as the rest of the app."""
    out: dict[str, str] = {}
    for col in df.columns:
        out[col] = _engine.infer_dtype_category(df[col])
    return out


def recommend_charts(df: pd.DataFrame, limit: int = 5) -> list[dict[str, Any]]:
    types = _col_types(df)
    quantitative = [c for c, t in types.items() if t == "quantitative"]
    temporal = [c for c, t in types.items() if t == "temporal"]
    nominal = [c for c, t in types.items() if t == "nominal"]
    recommendations: list[dict[str, Any]] = []

    def y_field(field: str) -> list[dict]:
        return [{"field": field, "type": "quantitative", "axis": "left", "normalize": "none"}]

    def x(field: str, type_: str) -> dict:
        return {"field": field, "type": type_}

    # 1. Time trend
    if temporal and quantitative:
        tcol, qcol = temporal[0], quantitative[0]
        recommendations.append({
            "chart_type": "line",
            "reason": f"按时间（{tcol}）追踪 {qcol}",
            "encoding": {"chartType": "line", "x": x(tcol, "temporal"), "yFields": y_field(qcol)},
        })

    # 2. Category comparison (bar)
    if nominal and quantitative:
        ncol, qcol = nominal[0], quantitative[0]
        recommendations.append({
            "chart_type": "bar",
            "reason": f"按 {ncol} 比较 {qcol}",
            "encoding": {"chartType": "bar", "x": x(ncol, "nominal"), "yFields": y_field(qcol)},
        })

    # 3. Distribution of a single numeric column
    if quantitative:
        qcol = quantitative[0]
        recommendations.append({
            "chart_type": "histogram",
            "reason": f"{qcol} 的分布",
            "encoding": {"chartType": "histogram", "x": x(qcol, "quantitative"), "yFields": y_field(qcol)},
        })

    # 4. Numeric correlation (scatter) when 2+ numerics exist
    if len(quantitative) >= 2:
        a, b = quantitative[0], quantitative[1]
        enc: dict[str, Any] = {"chartType": "scatter", "x": x(a, "quantitative"), "yFields": y_field(b)}
        if nominal:
            enc["color"] = x(nominal[0], "nominal")
            enc["reason_extra"] = f"colored by {nominal[0]}"
        recommendations.append({
            "chart_type": "scatter",
            "reason": f"探索 {a} 与 {b}" + (f"，按 {nominal[0]} 着色" if nominal else ""),
            "encoding": enc,
        })

    # 5. Correlation heatmap when 3+ numerics exist
    if len(quantitative) >= 3:
        recommendations.append({
            "chart_type": "heatmap",
            "reason": f"{len(quantitative)} 个数值列的相关矩阵",
            "encoding": {
                "chartType": "heatmap",
                "x": x(quantitative[1], "quantitative"),
                "yFields": y_field(quantitative[0]),
                "z": x(quantitative[2], "quantitative"),
                "options": {"corr": True},
            },
        })

    # 6. Share breakdown when a low-cardinality nominal column exists
    if nominal and quantitative:
        ncol = nominal[0]
        unique = df[ncol].nunique(dropna=False)
        if 2 <= unique <= 6:
            recommendations.append({
                "chart_type": "pie",
                "reason": f"按 {ncol} 查看 {quantitative[0]} 占比",
                "encoding": {
                    "chartType": "pie",
                    "color": x(ncol, "nominal"),
                    "yFields": y_field(quantitative[0]),
                },
            })

    # Deduplicate chart types (keep the first/strongest reason)
    seen: set[str] = set()
    unique_recs = []
    for rec in recommendations:
        if rec["chart_type"] in seen:
            continue
        seen.add(rec["chart_type"])
        rec["encoding"].pop("reason_extra", None)
        unique_recs.append(rec)
    return unique_recs[:limit]
