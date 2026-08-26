from __future__ import annotations

from typing import Any
from datetime import datetime
from pathlib import Path
import json

import pandas as pd
import numpy as np

from backend.core.engine import DataEngine
from backend.models.data import ColumnMeta, DataFrameMeta


class Dataset:
    """已加载 DataFrame 的包装器，维护元数据。"""

    def __init__(
        self,
        df: pd.DataFrame,
        name: str,
        engine: str = "pandas",
        dataset_id: str | None = None,
    ):
        self.id = dataset_id or DataEngine.new_id()
        self.name = name
        self.engine = engine
        self.raw_df = df.copy()
        self._df = df.copy()
        self.created_at = datetime.utcnow().isoformat()
        self.history: list[dict[str, Any]] = []
        self._build_meta()

    def _build_meta(self) -> None:
        engine = DataEngine(self.engine)  # type: ignore[arg-type]
        self.meta = DataFrameMeta(
            id=self.id,
            name=self.name,
            engine=self.engine,  # type: ignore[arg-type]
            rows=len(self._df),
            cols=len(self._df.columns),
            columns=[
                ColumnMeta(
                    name=str(col),
                    dtype=str(self._df[col].dtype),
                    inferred_type=engine.infer_dtype_category(self._df[col]),  # type: ignore[arg-type]
                    nullable=bool(self._df[col].isna().any()),
                    unique_count=int(self._df[col].nunique()),
                )
                for col in self._df.columns
            ],
            created_at=self.created_at,
        )

    @property
    def df(self) -> pd.DataFrame:
        return self._df

    def apply(self, operation: dict[str, Any]) -> "Dataset":
        op_type = operation.get("type")
        params = operation.get("params", {})

        if op_type == "filter":
            self._df = apply_filter(self._df, params)
        elif op_type == "sort":
            self._df = apply_sort(self._df, params)
        elif op_type == "dropna":
            cols = params.get("columns")
            self._df = self._df.dropna(subset=cols) if cols else self._df.dropna()
        elif op_type == "fillna":
            self._df = self._df.copy()
            self._df[params["column"]] = self._df[params["column"]].fillna(params["value"])
        elif op_type == "rename":
            self._df = self._df.rename(columns=params["mappings"])
        elif op_type == "dtype":
            for col, target in params["mappings"].items():
                self._df = cast_column(self._df, col, target)
        elif op_type == "compute":
            self._df = apply_compute(self._df, params)
        elif op_type == "pivot":
            self._df = apply_pivot(self._df, params)
        elif op_type == "melt":
            self._df = apply_melt(self._df, params)
        elif op_type == "dedupe":
            self._df = apply_dedupe(self._df, params)
        elif op_type == "clip":
            self._df = apply_clip(self._df, params)
        elif op_type == "parse_numeric":
            self._df = apply_parse_numeric(self._df, params)
        elif op_type == "drop":
            self._df = apply_drop(self._df, params)
        elif op_type == "str_clean":
            self._df = apply_str_clean(self._df, params)
        elif op_type == "groupby":
            self._df = apply_groupby(self._df, params)
        elif op_type == "sample":
            self._df = apply_sample(self._df, params)
        elif op_type == "join":
            raise ValueError("join requires session context; use Dataset.apply_join via SessionManager")
        else:
            raise ValueError(f"Unknown operation: {op_type}")

        self.history.append(operation)
        self._build_meta()
        return self

    def apply_join(self, operation: dict[str, Any], right_df: pd.DataFrame) -> "Dataset":
        """Join with another dataset's current df. Only callable with session context."""
        self._df = apply_join_op(self._df, right_df, operation.get("params", {}))
        self.history.append(operation)
        self._build_meta()
        return self

    def reset(self) -> "Dataset":
        self._df = self.raw_df.copy()
        self.history.clear()
        self._build_meta()
        return self

    def preview(
        self,
        limit: int = 100,
        offset: int = 0,
        sort_by: str | None = None,
        sort_asc: bool = True,
        column_filters: dict[str, str] | None = None,
        search: str | None = None,
    ) -> dict[str, Any]:
        df = self._df
        for column, value in (column_filters or {}).items():
            if column not in df.columns:
                raise ValueError(f"Column not found: {column}")
            if value:
                df = df[df[column].astype(str).str.contains(value, case=False, na=False, regex=False)]
        if search:
            mask = pd.Series(False, index=df.index)
            for column in df.columns:
                mask |= df[column].astype(str).str.contains(search, case=False, na=False, regex=False)
            df = df[mask]
        if sort_by:
            if sort_by not in df.columns:
                raise ValueError(f"Column not found: {sort_by}")
            df = df.sort_values(by=sort_by, ascending=sort_asc, kind="stable")

        total_filtered_rows = len(df)
        offset = min(max(0, offset), total_filtered_rows)
        limit = min(max(1, limit), 1000)
        engine = DataEngine(self.engine)  # type: ignore[arg-type]
        columns, rows = engine.to_preview_rows(df, limit, offset)
        return {
            "columns": columns,
            "rows": sanitize_rows(rows),
            "total_rows": len(self._df),
            "total_cols": len(self._df.columns),
            "offset": offset,
            "limit": limit,
            "total_filtered_rows": total_filtered_rows,
        }

    def describe(self) -> dict[str, Any]:
        from backend.dtale_wrapper import describe_dataframe

        return describe_dataframe(self._df)

    def to_meta(self) -> DataFrameMeta:
        return self.meta


def apply_filter(df: pd.DataFrame, params: dict[str, Any]) -> pd.DataFrame:
    col = params["column"]
    op = params["operator"]
    value = params["value"]
    series = df[col]

    # Try numeric coercion for comparison operators
    try:
        numeric_value = pd.to_numeric(value)
        numeric_series = pd.to_numeric(series, errors="ignore")
    except Exception:
        numeric_value = value
        numeric_series = series

    if op == "eq":
        return df[series == value]
    if op == "ne":
        return df[series != value]
    if op == "gt":
        return df[numeric_series > numeric_value]
    if op == "gte":
        return df[numeric_series >= numeric_value]
    if op == "lt":
        return df[numeric_series < numeric_value]
    if op == "lte":
        return df[numeric_series <= numeric_value]
    if op == "contains":
        return df[series.astype(str).str.contains(str(value), na=False)]
    if op == "startswith":
        return df[series.astype(str).str.startswith(str(value), na=False)]
    if op == "endswith":
        return df[series.astype(str).str.endswith(str(value), na=False)]
    raise ValueError(f"Unsupported operator: {op}")


def apply_sort(df: pd.DataFrame, params: dict[str, Any]) -> pd.DataFrame:
    col = params["column"]
    ascending = bool(params.get("ascending", True))
    return df.sort_values(by=col, ascending=ascending)


def apply_compute(df: pd.DataFrame, params: dict[str, Any]) -> pd.DataFrame:
    name = params["name"]
    expression = params["expression"]
    df = df.copy()
    try:
        df[name] = df.eval(expression)
    except Exception:
        # numexpr supports a limited syntax; retry with the pure-python engine
        df[name] = df.eval(expression, engine="python")
    return df


def apply_pivot(df: pd.DataFrame, params: dict[str, Any]) -> pd.DataFrame:
    pivoted = df.pivot_table(
        index=params["index"],
        columns=params["columns"],
        values=params["values"],
        aggfunc=params.get("aggfunc", "sum"),
        fill_value=0,
    )
    # Flatten the column hierarchy produced by pivot_table
    pivoted.columns = [str(c) for c in pivoted.columns]
    return pivoted.reset_index()


def apply_melt(df: pd.DataFrame, params: dict[str, Any]) -> pd.DataFrame:
    var_name = params.get("var_name", "variable")
    value_name = params.get("value_name", "value")
    # pandas rejects var/value names that collide with existing columns — auto-dedupe
    existing = set(df.columns)
    while var_name in existing:
        var_name = f"{var_name}_melted"
    while value_name in existing:
        value_name = f"{value_name}_melted"
    return df.melt(
        id_vars=params["id_vars"],
        value_vars=params.get("value_vars"),
        var_name=var_name,
        value_name=value_name,
    )


def apply_dedupe(df: pd.DataFrame, params: dict[str, Any]) -> pd.DataFrame:
    """Remove fully duplicate rows (optionally on a subset of columns)."""
    columns = params.get("columns")
    return df.drop_duplicates(subset=columns)


def parse_numeric_series(series: pd.Series) -> pd.Series:
    """Loose numeric parsing: strip whitespace, drop thousands separators / % / $."""
    cleaned = (
        series.astype(str)
        .str.strip()
        .str.replace(",", "", regex=False)
        .str.replace("%", "", regex=False)
        .str.replace("$", "", regex=False)
    )
    return pd.to_numeric(cleaned, errors="coerce")


def apply_parse_numeric(df: pd.DataFrame, params: dict[str, Any]) -> pd.DataFrame:
    """Parse a string column into numeric, tolerating separators/suffixes."""
    col = params["column"]
    df = df.copy()
    df[col] = parse_numeric_series(df[col])
    return df


def apply_clip(df: pd.DataFrame, params: dict[str, Any]) -> pd.DataFrame:
    """Clip a numeric column to [min, max] bounds (outlier capping)."""
    col = params["column"]
    lo = params.get("min")
    hi = params.get("max")
    if lo is None and hi is None:
        raise ValueError("clip requires at least one of min/max")
    df = df.copy()
    df[col] = df[col].clip(lower=lo, upper=hi)
    return df


def apply_drop(df: pd.DataFrame, params: dict[str, Any]) -> pd.DataFrame:
    """Drop one or more columns (missing columns are ignored)."""
    columns = [c for c in params.get("columns", []) if c in df.columns]
    return df.drop(columns=columns)


def apply_str_clean(df: pd.DataFrame, params: dict[str, Any]) -> pd.DataFrame:
    """String cleanup: trim / lower / upper, optionally into a new column."""
    col = params["column"]
    action = params.get("action", "trim")
    new_col = params.get("new_column") or col
    df = df.copy()
    series = df[col].astype(str)
    if action == "trim":
        result = series.str.strip()
        # Collapse internal runs of whitespace too; strip() only trims edges.
        result = result.str.replace(r"\s{2,}", " ", regex=True)
    elif action == "lower":
        result = series.str.lower()
    elif action == "upper":
        result = series.str.upper()
    else:
        raise ValueError(f"Unsupported string action: {action}")
    df[new_col] = result
    return df


def apply_groupby(df: pd.DataFrame, params: dict[str, Any]) -> pd.DataFrame:
    """Group by columns and aggregate a value column into a new table."""
    by = params["by"]
    value_column = params["value_column"]
    aggfunc = params.get("aggfunc", "sum")
    grouped = df.groupby(by, dropna=False)[value_column].agg(aggfunc).reset_index()
    return grouped


def apply_sample(df: pd.DataFrame, params: dict[str, Any]) -> pd.DataFrame:
    """Random sample by fraction or row count."""
    frac = params.get("frac")
    n = params.get("n")
    if frac is not None:
        return df.sample(frac=min(1.0, max(0.0, float(frac))))
    if n is not None:
        return df.sample(n=min(len(df), max(0, int(n))))
    return df


def apply_join_op(df: pd.DataFrame, right_df: pd.DataFrame, params: dict[str, Any]) -> pd.DataFrame:
    on = params.get("on")
    left_on = params.get("left_on") or on
    right_on = params.get("right_on") or on
    if not left_on or not right_on:
        raise ValueError("join requires 'on' or both 'left_on' and 'right_on'")
    return df.merge(
        right_df,
        how=params.get("how", "inner"),
        left_on=left_on,
        right_on=right_on,
        suffixes=("", "_right"),
    )


def cast_column(df: pd.DataFrame, col: str, target: str) -> pd.DataFrame:
    df = df.copy()
    if target == "int":
        df[col] = pd.to_numeric(df[col], errors="coerce").astype("Int64")
    elif target == "float":
        df[col] = pd.to_numeric(df[col], errors="coerce")
    elif target == "str":
        df[col] = df[col].astype(str)
    elif target == "bool":
        df[col] = df[col].astype(bool)
    elif target in ("datetime", "date"):
        df[col] = pd.to_datetime(df[col], errors="coerce")
    else:
        df[col] = df[col].astype(target)
    return df


def safe_float(value: Any) -> float | None:
    try:
        if pd.isna(value):
            return None
        return float(value)
    except Exception:
        return None


def sanitize_rows(rows: list[list]) -> list[list]:
    def sanitize(value: Any) -> Any:
        if pd.isna(value):
            return None
        if isinstance(value, (np.integer, np.floating)):
            return value.item()
        if isinstance(value, np.bool_):
            return bool(value)
        if isinstance(value, pd.Timestamp):
            return value.isoformat()
        return value

    return [[sanitize(v) for v in row] for row in rows]
