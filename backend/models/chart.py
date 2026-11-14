from typing import Optional, Literal

from pydantic import field_validator

from backend.core import chart_registry
from backend.models.data import CBaseModel


class EncodingChannel(CBaseModel):
    field: str
    type: Literal["quantitative", "nominal", "temporal"]
    aggregate: Optional[Literal["sum", "mean", "count", "min", "max"]] = None
    bin: bool = False


class YFieldConfig(CBaseModel):
    field: str
    type: Literal["quantitative", "nominal", "temporal"]
    aggregate: Optional[Literal["sum", "mean", "count", "min", "max"]] = None
    axis: Literal["left", "right"] = "left"
    normalize: Literal["none", "perSeries", "global"] = "none"
    label: Optional[str] = None


class ChartOptions(CBaseModel):
    """Per-type knobs.

    Declarative custom charts expose scalar options (``connector``, ``width``,
    ...) declared by the manifest, so the option keys cannot be enumerated
    here. ``extra="allow"`` keeps them as ``model_extra`` and round-trips them
    through ``model_dump``; the custom renderer resolves ``$opt.<key>`` from
    exactly that dictionary.
    """

    model_config = {**CBaseModel.model_config, "extra": "allow"}

    orientation: Optional[Literal["v", "h"]] = None
    barmode: Optional[Literal["group", "stack"]] = None
    histnorm: Optional[Literal["percent", "probability", "density"]] = None
    cumulative: bool = False
    box_points: Optional[Literal["all", "outliers", "none"]] = None
    marginal_x: Optional[Literal["histogram", "box", "violin", "rug"]] = None
    marginal_y: Optional[Literal["histogram", "box", "violin", "rug"]] = None
    annotated: bool = False
    corr: bool = False
    start_field: Optional[str] = None
    end_field: Optional[str] = None
    open_field: Optional[str] = None
    high_field: Optional[str] = None
    low_field: Optional[str] = None
    close_field: Optional[str] = None
    gauge_min: Optional[float] = None
    gauge_max: Optional[float] = None


class ChartEncoding(CBaseModel):
    x: Optional[EncodingChannel] = None
    y_fields: list[YFieldConfig] = []
    color: Optional[EncodingChannel] = None
    size: Optional[EncodingChannel] = None
    facet: Optional[EncodingChannel] = None
    z: Optional[EncodingChannel] = None
    error: Optional[EncodingChannel] = None
    dimensions: Optional[list[str]] = None
    path: Optional[list[str]] = None
    source: Optional[EncodingChannel] = None
    target: Optional[EncodingChannel] = None
    options: Optional[ChartOptions] = None
    chart_type: str = "scatter"

    @field_validator("chart_type")
    @classmethod
    def _validate_chart_type(cls, value: str) -> str:
        """Open enum: built-in registry ids or valid declarative custom ids."""
        if chart_registry.is_known_chart_type(value):
            return value
        # Lazy import: custom_charts imports chart_registry and models.data;
        # keeping the edge local avoids any future import cycle.
        from backend.core import custom_charts

        if custom_charts.is_custom_id(value):
            return value
        raise ValueError(
            f"unknown chart type {value!r}; it is neither a built-in id from "
            f"backend/core/chart_registry.py nor a valid custom chart id "
            f"(see backend/core/custom_charts.py)"
        )


class SelectionFilter(CBaseModel):
    """Crossfilter brush from a source chart, in data coordinates.

    Ranges are [lo, hi]; values may be floats (numeric axes) or strings (date axes).
    """

    x_field: Optional[str] = None
    y_field: Optional[str] = None
    x_range: Optional[list] = None
    y_range: Optional[list] = None


class FilterSpec(CBaseModel):
    """One dashboard filter applied to a dataset before aggregation."""

    field: str
    op: Literal["range", "in"] = "range"
    range: Optional[list] = None      # op=range: [lo, hi]
    values: Optional[list] = None     # op=in: category values


class ChartPreviewRequest(CBaseModel):
    dataset_id: str
    encoding: ChartEncoding
    selection: Optional[SelectionFilter] = None   # single brush (backward compat)
    selections: Optional[list[SelectionFilter]] = None  # multi-brush (dashboard)
    filters: Optional[list[FilterSpec]] = None


class AggregateRequest(CBaseModel):
    dataset_id: str
    encoding: ChartEncoding


class TemplateSaveRequest(CBaseModel):
    name: str
    encoding: ChartEncoding
    layout: dict = {}


class ChartTemplate(CBaseModel):
    id: str
    name: str
    encoding: ChartEncoding
    layout: dict = {}
    created_at: str
