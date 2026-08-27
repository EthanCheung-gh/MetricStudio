"""Statistical toolbox: correlation, regression, difference tests, confidence intervals.

Deterministic pandas/numpy computations with plain-language interpretations
generated locally (no LLM required).
"""

from __future__ import annotations

from math import erf, sqrt
from typing import Any

import numpy as np
import pandas as pd


def _t_p_value(t_stat: float, dof: int) -> float:
    """Two-sided t p-value; exact via scipy when available, else normal approx."""
    try:
        from scipy import stats as scipy_stats

        return float(2 * scipy_stats.t.sf(abs(t_stat), df=dof))
    except ImportError:
        return float(2 * (1 - 0.5 * (1 + erf(abs(t_stat) / sqrt(2)))))


def _t_critical_975(dof: int) -> float:
    """Approximate two-sided 95% t critical value (normal fallback)."""
    try:
        from scipy import stats as scipy_stats

        return float(scipy_stats.t.ppf(0.975, df=dof))
    except ImportError:
        return 1.96


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
        p_value = _t_p_value(t_stat, n - 2)
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


def _clean_series(df: pd.DataFrame, column: str) -> np.ndarray:
    numeric = _numeric_frame(df)
    if column not in numeric.columns:
        raise ValueError(f"非数值或缺失列: {column}")
    series = numeric[column].replace([np.inf, -np.inf], np.nan).dropna()
    if len(series) < 2:
        raise ValueError(f"有效数据点不足（少于两行）: {column}")
    return series.to_numpy(dtype=float)


def welch_t_test(a: np.ndarray, b: np.ndarray) -> tuple[float, float]:
    """Welch's unequal-variance t statistic and two-sided p-value."""
    na, nb = len(a), len(b)
    va, vb = float(a.var(ddof=1)), float(b.var(ddof=1))
    se = sqrt(va / na + vb / nb)
    if se == 0:
        raise ValueError("两组方差均为零，无法检验")
    t_stat = float((a.mean() - b.mean()) / se)
    dof = int((va / na + vb / nb) ** 2 / ((va / na) ** 2 / (na - 1) + (vb / nb) ** 2 / (nb - 1)))
    return t_stat, _t_p_value(t_stat, max(dof, 1))


def difference_test(
    df: pd.DataFrame,
    column_a: str,
    column_b: str | None = None,
    group_column: str | None = None,
    group_a: str | None = None,
    group_b: str | None = None,
    paired: bool = False,
) -> dict[str, Any]:
    """Compare two samples with Welch t-test (default) or Mann-Whitney U.

    Modes:
    - ``paired=True`` + ``column_b``: paired t-test across two columns.
    - ``column_b`` given: compare two independent columns.
    - ``group_column`` + ``group_a``/``group_b``: compare the same measure
      across two groups of one categorical column.
    """
    if paired:
        if not column_b:
            raise ValueError("配对检验需要提供两个数值列")
        a = _clean_series(df, column_a)
        b = _clean_series(df, column_b)
        n = min(len(a), len(b))
        a, b = a[:n], b[:n]
        diff = a - b
        mean_diff = float(diff.mean())
        sd = float(diff.std(ddof=1))
        if sd == 0:
            raise ValueError("配对差值方差为零")
        se = sd / sqrt(n)
        t_stat = mean_diff / se
        p_value = _t_p_value(t_stat, n - 1)
        ci_lo, ci_hi = (
            round(mean_diff - _t_critical_975(n - 1) * se, 4),
            round(mean_diff + _t_critical_975(n - 1) * se, 4),
        )
        return _group_result(
            [column_a, column_b],
            "配对 t 检验",
            t_stat,
            p_value,
            [ci_lo, ci_hi],
            sizes=None,
        )

    if column_b:
        a = _clean_series(df, column_a)
        b = _clean_series(df, column_b)
        labels = [column_a, column_b]
        try:
            from scipy import stats as scipy_stats

            u_stat, p_mw = scipy_stats.mannwhitneyu(a, b, alternative="two-sided")
            u_stat, p_mw = float(u_stat), round(float(p_mw), 6)
        except ImportError:
            u_stat, p_mw = None, None
        t_stat, p_t = welch_t_test(a, b)
        return _compose_difference(labels, "Welch t 检验", t_stat, p_t, len(a), len(b),
                                   extras={"mann_whitney_u": u_stat, "mann_whitney_p": p_mw})

    # Group mode.
    if not group_column or not group_a or not group_b:
        raise ValueError("请提供两个数值列或组字段与两组取值")
    numeric_col = _numeric_frame(df)
    source = numeric_col if (group_column in numeric_col.columns and column_a in numeric_col.columns) else df
    if group_column not in source.columns or column_a not in source.columns:
        raise ValueError(f"缺失列: {group_column} 或 {column_a}")
    sub = source[[column_a, group_column]].replace([np.inf, -np.inf], np.nan).dropna()
    a = sub[sub[group_column].astype(str) == str(group_a)][column_a].to_numpy(dtype=float)
    b = sub[sub[group_column].astype(str) == str(group_b)][column_a].to_numpy(dtype=float)
    if len(a) < 2 or len(b) < 2:
        raise ValueError("至少一组的有效数据点不足（少于两行）")
    labels = [f"{group_column}={group_a}", f"{group_column}={group_b}"]
    t_stat, p_t = welch_t_test(a, b)
    return _compose_difference(labels, "Welch t 检验", t_stat, p_t, len(a), len(b))


def confidence_interval_mean(df: pd.DataFrame, column: str, level: float = 0.95) -> dict[str, Any]:
    """Two-sided t confidence interval for a column mean."""
    values = _clean_series(df, column)
    n = len(values)
    mean = float(values.mean())
    se = float(values.std(ddof=1)) / sqrt(n)
    if level <= 0 or level >= 1:
        raise ValueError("置信水平需在 0 与 1 之间")
    tail = (1 + level) / 2
    try:
        from scipy import stats as scipy_stats

        critical = float(scipy_stats.t.ppf(tail, df=n - 1))
    except ImportError:
        critical = 1.96 if abs(level - 0.95) < 1e-9 else 1.645 * sqrt(level / 0.90)
    margin = critical * se
    significant = margin > 0
    return {
        "ok": True,
        "column": column,
        "n": n,
        "mean": round(mean, 4),
        "level": level,
        "ci_low": round(mean - margin, 4),
        "ci_high": round(mean + margin, 4),
        "interpretation": f"{column} 的均值 {mean:.2f} 有 {level * 100:.0f}% 置信落于 [{round(mean - margin, 2)}, {round(mean + margin, 2)}]" if significant else "",
    }


def _compose_difference(
    labels: list[str],
    method: str,
    t_stat: float,
    p_value: float,
    na: int,
    nb: int,
    extras: dict[str, Any] | None = None,
) -> dict[str, Any]:
    body = _group_result(labels, method, t_stat, p_value, None, sizes=[na, nb])
    if extras:
        body.update(extras)
    return body


def _group_result(
    labels: list[str],
    method: str,
    stat: float,
    p_value: float,
    ci: list[float] | None,
    sizes: list[int] | None,
) -> dict[str, Any]:
    significant = p_value is not None and p_value < 0.05
    text = (
        f"{labels[0]} 与 {labels[1]} 存在显著差异（{method}，p={p_value:.4f}）"
        if significant
        else f"未发现 {labels[0]} 与 {labels[1]} 的显著差异（{method}，p={p_value if p_value is not None else '—'}）"
    )
    result: dict[str, Any] = {
        "ok": True,
        "method": method,
        "groups": labels,
        "statistic": round(float(stat), 4),
        "p_value": round(min(max(float(p_value), 0.0), 1.0), 6) if p_value is not None else None,
        "significant": significant,
        "interpretation": text,
    }
    if ci is not None:
        result["ci"] = {"low": ci[0], "high": ci[1]}
    if sizes is not None:
        result["sizes"] = sizes
    return result
