from backend.models.data import CBaseModel
from typing import Optional, Literal


class FilterRequest(CBaseModel):
    column: str
    operator: Literal["eq", "ne", "gt", "gte", "lt", "lte", "contains", "startswith", "endswith"]
    value: str | float | int


class SortRequest(CBaseModel):
    column: str
    ascending: bool = True


class DropNaRequest(CBaseModel):
    columns: Optional[list[str]] = None


class FillNaRequest(CBaseModel):
    column: str
    value: str | float | int


class RenameRequest(CBaseModel):
    mappings: dict[str, str]


class DTypeRequest(CBaseModel):
    mappings: dict[str, str]


class UndoRequest(CBaseModel):
    to_index: Optional[int] = None


class ComputeRequest(CBaseModel):
    name: str
    expression: str  # pandas eval expression, e.g. "sales - profit"


class PivotRequest(CBaseModel):
    index: str
    columns: str
    values: str
    aggfunc: Literal["sum", "mean", "count", "min", "max"] = "sum"


class MeltRequest(CBaseModel):
    id_vars: list[str]
    value_vars: Optional[list[str]] = None  # None → all non-id columns
    var_name: str = "variable"
    value_name: str = "value"


class JoinRequest(CBaseModel):
    right_dataset_id: str
    on: Optional[str] = None  # same key name on both sides
    left_on: Optional[str] = None
    right_on: Optional[str] = None
    how: Literal["inner", "left", "right", "outer"] = "inner"


class DropRequest(CBaseModel):
    columns: list[str]


class StrCleanRequest(CBaseModel):
    column: str
    action: Literal["trim", "lower", "upper"] = "trim"
    new_column: Optional[str] = None


class GroupbyRequest(CBaseModel):
    by: list[str]
    value_column: str
    aggfunc: Literal["sum", "mean", "count", "min", "max"] = "sum"


class SampleRequest(CBaseModel):
    n: Optional[int] = None
    frac: Optional[float] = None


class BatchRequest(CBaseModel):
    """Apply a sequence of operations in one request (each appended to history)."""

    operations: list[dict] = []
