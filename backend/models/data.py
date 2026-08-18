from pydantic import BaseModel, Field
from typing import Literal, Optional
from datetime import datetime
import re


def to_camel(snake_str: str) -> str:
    """Convert snake_case to camelCase for API serialization."""
    components = snake_str.split("_")
    return components[0] + "".join(x.title() for x in components[1:])


class CBaseModel(BaseModel):
    """Pydantic base model that serializes with camelCase aliases."""

    model_config = {
        "alias_generator": to_camel,
        "populate_by_name": True,
        "validate_by_name": True,
    }


class ColumnMeta(CBaseModel):
    name: str
    dtype: str
    inferred_type: Literal["quantitative", "nominal", "temporal", "unknown"] = "unknown"
    nullable: bool = True
    unique_count: Optional[int] = None


class DataFrameMeta(CBaseModel):
    id: str
    name: str
    engine: Literal["pandas", "polars", "auto"]
    rows: int
    cols: int
    columns: list[ColumnMeta]
    created_at: str


class DataPreview(CBaseModel):
    columns: list[str]
    rows: list[list]
    total_rows: int
    total_cols: int
    offset: int = 0
    limit: int = 100
    total_filtered_rows: int | None = None


class DescribeResponse(CBaseModel):
    columns: list[str]
    stats: dict[str, dict[str, Optional[float]]]
