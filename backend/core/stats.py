"""Statistical toolbox: correlation matrix and simple linear regression.

Deterministic pandas/numpy computations with plain-language interpretations
generated locally (no LLM required).
"""

from __future__ import annotations

from typing import Any

import numpy as np
import pandas as pd


def _numeric_frame(df: pd.DataFrame) -> pd.DataFrame:
    return df.select_dtypes(include="number")


def correlation_matrix(df: pd.DataFrame, min_abs: float = 0.5) -> dict[str, Any]:
    """Pearson correlation matrix plus notable pairs above a threshold."""
    numeric = _numeric_frame(df)
    if numeric.shape[1] < 2:
        return {"ok": False, "reason": "数值列不足（少于两列）"}
    corr = numeric.corr(numeric_only=True)
    columns = [str(c) for c in corr.columns]
    matrix = [[round(float(v), 3) if v == v else None for v in row] for row in corr.values]

    pairs: list[dict[str, Any]] = []
    for i in range(len(columns)):
        for j in range(i + 1, len(columns)):
            value = corr.iloc[i, j]
            if value != value or abs(value) < min_abs:
                continue
            direction = "正相关" if value > 0 else "负相关"
            strength = "强" if abs(value) >= 0.8 else "中等"
            pairs.append({
                "x": columns[i],
                "y": columns[j],
                "r": round(float(value), 3),
                "text": f"{columns[i]} 与 {columns[j]} 呈{strength}{direction}（r={value:.2f}）",
            })
    pairs.sort(key=lambda item: abs(item["r"]), reverse=True)
    return {"ok": True, "columns": columns, "matrix": matrix, "pairs": pairs}


def linear_regression(df: pd.DataFrame, x: str, y: str) -> dict[str, Any]:
    """Ordinary least squares y ~ x with R², slope/intercept and an interpretation.

    A ValueError is raised for degenerate inputs (missing columns, too few
    points, zero variance) so the API layer can map it to 400.
    """
    numeric = _numeric_frame(df)
    if x not in numeric.columns:
        raise ValueError(f"非数值或缺失列: {x}")
    if y not in numeric.columns:
        raise ValueError(f"非数值或缺失列: {y}")
    sub = numeric[[x, y]].replace([np.inf, -np.inf], np.nan).dropna()
    if len(sub) < 3:
        raise ValueError("有效数据点不足（少于三行）")
    if sub[x].std() == 0:
        raise ValueError("自变量方差为零，无法拟合")

    xs = sub[x].to_numpy(dtype=float)
    ys = sub[y].to_numpy(dtype=float)
    slope, intercept = np.polyfit(xs, ys, 1)
    predicted = slope * xs + intercept
    ss_res = float(((ys - predicted) ** 2).sum())
    ss_tot = float(((ys - ys.mean()) ** 2).sum())
    r_squared = round(1 - ss_res / ss_tot, 4) if ss_tot > 0 else None
    pearson = round(float(np.corrcoef(xs, ys)[0, 1]), 3)

    n = len(sub)
    # Two-sided t-test p-value for the slope under H0: slope == 0.
    if n > 2 and ss_res > 0:
        se_slope = (ss_res / (n - 2) / ((xs - xs.mean()) ** 2).sum()) ** 0.5
        t_stat = slope / se_slope
        try:
            from scipy import stats as scipy_stats

            p_value = float(2 * scipy_stats.t.sf(abs(t_stat), df=n - 2))
        except ImportError:
            # Normal approximation fallback when scipy is unavailable.
            from math import erf, sqrt

            p_value = float(2 * (1 - 0.5 * (1 + erf(abs(t_stat) / sqrt(2)))))
        p_value = round(min(max(p_value, 0.0), 1.0), 6)
    else:
        se_slope = None
        p_value = None

    direction = "正" if slope > 0 else "负"
    fit = (
        f"{y} 与 {x} 呈显著{direction}相关" if (p_value is not None and p_value < 0.05)
        else f"未发现 {y} 与 {x} 的显著线性关系"
    )
    interpretation = f"{fit}：每增加 1 单位 {x}，{y} 约变化 {slope:.2f}；R²={r_squared}"
    if r_squared is not None:
        quality = "较强" if r_squared >= 0.7 else ("中等" if r_squared >= 0.4 else "较弱")
        interpretation += f"，解释力{quality}"

    return {
        "ok": True,
        "x": x,
        "y": y,
        "n": n,
        "slope": round(float(slope), 6),
        "intercept": round(float(intercept), 6),
        "r_squared": r_squared,
        "pearson_r": pearson,
        "p_value": p_value,
        "standard_error_slope": round(float(se_slope), 6) if se_slope is not None else None,
        "interpretation": interpretation,
    }
