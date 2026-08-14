from backend.models.data import CBaseModel
from typing import Optional, Literal


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


ChartTypeLiteral = Literal[
    # Core relational
    "line", "bar", "barh", "area", "step", "scatter", "dot", "scatter3d", "pie",
    # Statistical distributions
    "histogram", "box", "violin", "ecdf", "density_heatmap", "density_contour",
    # Matrix & correlation
    "heatmap", "contour", "splom",
    # Hierarchical / network / high-dim
    "treemap", "sunburst", "icicle", "sankey", "parcoords", "parcats",
    # Coordinate variants & misc
    "radar", "ternary", "waterfall", "funnel", "table", "gantt",
]


class ChartOptions(CBaseModel):
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
    chart_type: ChartTypeLiteral = "scatter"


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
