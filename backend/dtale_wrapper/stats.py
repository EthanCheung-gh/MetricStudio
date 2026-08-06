from __future__ import annotations

import logging
from typing import Any

import numpy as np
import pandas as pd

logger = logging.getLogger("dtale_wrapper")

try:
    import dtale  # type: ignore

    HAS_DTALE = True
except ImportError:
    dtale = None  # type: ignore[assignment]
    HAS_DTALE = False


def _safe_float(value: Any) -> float | None:
    try:
        if pd.isna(value):
            return None
        return float(value)
    except Exception:
        return None


def _pandas_describe(df: pd.DataFrame) -> dict[str, Any]:
    numeric = df.select_dtypes(include=[np.number])
    if numeric.empty:
        return {"columns": [], "stats": {}}
    desc = numeric.describe().T
    return {
        "columns": [str(c) for c in desc.index],
        "stats": {
            str(idx): {str(k): _safe_float(v) for k, v in row.items()}
            for idx, row in desc.iterrows()
        },
    }


def describe_dataframe(df: pd.DataFrame) -> dict[str, Any]:
    """统计摘要：优先复用 D-Tale 的 describe，失败/未安装时回退到 Pandas。"""
    if HAS_DTALE:
        try:
            desc = dtale.describe(df)
            result: dict[str, Any] = {"columns": [], "stats": {}}
            for col in df.select_dtypes(include=[np.number]).columns:
                col_desc = desc[str(col)]
                stats_df = col_desc.describe[["count", "mean", "std", "min", "25%", "50%", "75%", "max"]]
                stats = stats_df.iloc[:, 0] if stats_df.ndim == 2 else stats_df
                result["columns"].append(str(col))
                result["stats"][str(col)] = {
                    str(k): _safe_float(v) for k, v in stats.items()
                }
            return result
        except Exception as exc:
            logger.warning("dtale.describe failed, falling back to pandas: %s", exc)
    return _pandas_describe(df)


def column_stats(series: pd.Series) -> dict[str, Any]:
    """单列统计：D-Tale 优先，回退 Pandas。"""
    if HAS_DTALE:
        try:
            desc = dtale.describe(series.to_frame())
            col_desc = desc[str(series.name)]
            stats_df = col_desc.describe
            stats = stats_df.iloc[:, 0] if stats_df.ndim == 2 else stats_df
            return {str(k): _safe_float(v) for k, v in stats.items()}
        except Exception as exc:
            logger.warning("dtale column stats failed, falling back to pandas: %s", exc)

    desc = series.describe()
    return {str(k): _safe_float(v) for k, v in desc.items()}
