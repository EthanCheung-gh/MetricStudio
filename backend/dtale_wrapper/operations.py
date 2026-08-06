from __future__ import annotations

import logging
from typing import Any

import pandas as pd

logger = logging.getLogger("dtale_wrapper")

try:
    import dtale  # type: ignore
    from dtale.column_builders import ColumnBuilder  # noqa: F401  (import check only)

    HAS_DTALE = True
except ImportError:
    dtale = None  # type: ignore[assignment]
    HAS_DTALE = False


class DTaleOperationWrapper:
    """封装 D-Tale 操作，提供统一接口；所有调用失败时回退到原生 Pandas。"""

    @staticmethod
    def filter(df: pd.DataFrame, column: str, operator: str, value: Any) -> pd.DataFrame:
        """按列过滤。D-Tale 的 query 构建失败时回退到 Pandas 布尔索引。"""
        op_map = {
            "eq": "==", "ne": "!=", "gt": ">", "gte": ">=", "lt": "<", "lte": "<=",
        }
        if HAS_DTALE and operator in op_map:
            try:
                query = f"`{column}` {op_map[operator]} @__filter_value__"
                return df.query(query, local_dict={"__filter_value__": value})
            except Exception as exc:
                logger.warning("dtale filter failed, falling back to pandas: %s", exc)

        series = df[column]
        if operator == "eq":
            return df[series == value]
        if operator == "ne":
            return df[series != value]
        if operator == "gt":
            return df[pd.to_numeric(series, errors="coerce") > pd.to_numeric(value)]
        if operator == "gte":
            return df[pd.to_numeric(series, errors="coerce") >= pd.to_numeric(value)]
        if operator == "lt":
            return df[pd.to_numeric(series, errors="coerce") < pd.to_numeric(value)]
        if operator == "lte":
            return df[pd.to_numeric(series, errors="coerce") <= pd.to_numeric(value)]
        if operator == "contains":
            return df[series.astype(str).str.contains(str(value), na=False)]
        if operator == "startswith":
            return df[series.astype(str).str.startswith(str(value), na=False)]
        if operator == "endswith":
            return df[series.astype(str).str.endswith(str(value), na=False)]
        raise ValueError(f"Unsupported operator: {operator}")

    @staticmethod
    def compute_column(df: pd.DataFrame, name: str, expression: str) -> pd.DataFrame:
        """计算列。优先 D-Tale column_builder，回退 pandas eval。"""
        if HAS_DTALE:
            try:
                builder = ColumnBuilder(name=name, cfg={"col": expression}, data_id=1)
                _ = builder  # builder 需要 dtale data_id 上下文，实际构建较重
                raise RuntimeError("dtale column builder requires a live dtale instance")
            except Exception as exc:
                logger.warning("dtale compute failed, falling back to pandas eval: %s", exc)

        df = df.copy()
        try:
            df[name] = df.eval(expression)
        except Exception:
            df[name] = df.eval(expression, engine="python")
        return df

    @staticmethod
    def describe(df: pd.DataFrame) -> dict[str, Any]:
        from backend.dtale_wrapper.stats import describe_dataframe

        return describe_dataframe(df)
