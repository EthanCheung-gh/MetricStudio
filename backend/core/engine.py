from __future__ import annotations

import json
from typing import Literal, Union
from pathlib import Path
import uuid

import pandas as pd


try:
    import polars as pl
    HAS_POLARS = True
except Exception:  # pragma: no cover
    HAS_POLARS = False

DataFrame = Union[pd.DataFrame, "pl.DataFrame"]


class DataEngine:
    """Pandas / Polars 双引擎抽象层。"""

    def __init__(self, engine: Literal["pandas", "polars", "auto"] = "auto"):
        if engine == "polars" and not HAS_POLARS:
            raise RuntimeError("Polars is not installed")
        self.engine = engine

    def select(self, df: DataFrame, rows: int | None = None) -> DataFrame:
        if rows is None:
            return df
        if isinstance(df, pd.DataFrame):
            return df.head(rows)
        return df.head(rows)

    def to_records(self, df: DataFrame) -> list[dict]:
        if isinstance(df, pd.DataFrame):
            return df.replace({pd.NA: None, float("nan"): None}).to_dict("records")
        # polars
        return df.to_dicts()

    def to_preview_rows(self, df: DataFrame, limit: int = 100) -> tuple[list[str], list[list]]:
        preview = self.select(df, limit)
        records = self.to_records(preview)
        columns = list(df.columns)
        rows = [[record.get(col) for col in columns] for record in records]
        return columns, rows

    def read_csv(self, path: str | Path) -> pd.DataFrame:
        path = Path(path)
        if self.engine == "polars":
            return pl.read_csv(path)
        return pd.read_csv(path, engine="pyarrow")

    def read_excel(self, path: str | Path, sheet_name: str | int = 0) -> pd.DataFrame:
        path = Path(path)
        if self.engine == "polars":
            return pl.read_excel(path, sheet_id=sheet_name if isinstance(sheet_name, int) else None)
        return pd.read_excel(path, sheet_name=sheet_name)

    def get_excel_sheet_names(self, path: str | Path) -> list[str]:
        """Return all sheet names from an Excel file."""
        import openpyxl
        wb = openpyxl.load_workbook(path, read_only=True)
        return wb.sheetnames

    def read_parquet(self, path: str | Path) -> pd.DataFrame:
        path = Path(path)
        if self.engine == "polars":
            return pl.read_parquet(path)
        return pd.read_parquet(path, engine="pyarrow")

    def read_json(self, path: str | Path) -> pd.DataFrame:
        """Read JSON: a records array, NDJSON (one object per line), or a single
        record / column-dict. Nested objects are flattened one level via json_normalize."""
        path = Path(path)
        text = path.read_text(encoding="utf-8").strip()
        if not text:
            raise ValueError("Empty JSON file")
        if text.startswith("["):
            return pd.json_normalize(json.loads(text))
        try:
            data = json.loads(text)
        except json.JSONDecodeError:
            # NDJSON: one JSON object per line (a single-object parse fails on the 2nd line)
            return pd.read_json(path, lines=True)
        if isinstance(data, dict):
            try:
                return pd.DataFrame(data)
            except ValueError:
                return pd.json_normalize([data])
        if isinstance(data, list):
            return pd.json_normalize(data)
        raise ValueError("Unsupported JSON structure")

    def infer_dtype_category(self, series: pd.Series) -> str:
        dtype = str(series.dtype)
        if "int" in dtype or "float" in dtype:
            return "quantitative"
        if "datetime" in dtype or "date" in dtype:
            return "temporal"
        # String columns may hold ISO dates like 2024-01-01
        if (
            pd.api.types.is_string_dtype(series)
            or pd.api.types.is_object_dtype(series)
        ) and not isinstance(series.dtype, pd.CategoricalDtype):
            sample = series.dropna().head(20)
            if len(sample):
                try:
                    parsed = pd.to_datetime(sample, errors="coerce")
                    if parsed.notna().mean() >= 0.9:
                        return "temporal"
                except (TypeError, ValueError):
                    pass
        return "nominal"

    def auto_engine(self, df: DataFrame) -> Literal["pandas", "polars"]:
        rows = len(df)
        if self.engine == "auto":
            if HAS_POLARS and rows >= 1_000_000:
                return "polars"
            return "pandas"
        return self.engine  # type: ignore[return-value]

    @staticmethod
    def new_id() -> str:
        return str(uuid.uuid4())
