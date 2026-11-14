"""Single source of truth for chart types.

This registry is the single source of truth for chart type ids, UI channel
metadata, AI validation, named-type keyword detection and sampling
eligibility. Adding a chart type means one entry here, one builder in
backend/api/chart.py, and i18n keys ``chart.type.<id>`` / ``chart.desc.<id>``
in src/i18n/locales/{zh,en}.ts.

``samplable`` means exactly one thing: the type is eligible for the multi-Y
main-path deterministic downsampling guard in backend/api/chart.py — i.e. it is
a y-driven relational chart whose y values are individual observations
(scatter, line, area, step, dot). Two nearby groups are deliberately excluded.
bar/barh do plot raw rows, but their values are totals a reader compares, so
silently sampling them would change what the chart claims.
splom/parcoords/parcats do downsample, but they do it inside their own builder
branch — an implementation detail, not registry metadata.


``relational`` marks types that share y-driven channel semantics and may
therefore be retargeted within the relational family by the AI named-type
contract.

This module holds data only; the frontend never reads it directly. The
TypeScript mirror in src/utils/chartTypeRegistry.generated.ts is produced by
scripts/gen-chart-registry.py and must not be edited by hand.
"""

from dataclasses import dataclass
from typing import Literal


@dataclass(frozen=True)
class ChartTypeDef:
    id: str
    label: str
    group: str
    y_fields: Literal["multi", "first", "none"]
    channels: tuple[str, ...]
    options: tuple[str, ...]
    dimensions: str | None
    path: bool
    samplable: bool
    relational: bool
    keywords: tuple[str, ...]


CHART_TYPES: tuple[ChartTypeDef, ...] = (
    ChartTypeDef("line", "Line", "relational", "multi",
                 ("x", "color", "error"), (),
                 None, False, True, True,
                 ("折线图", "折线", "line chart", "line plot")),
    ChartTypeDef("bar", "Bar", "relational", "multi",
                 ("x", "color", "error"), ("barmode",),
                 None, False, False, True,
                 ("柱状图", "柱形图", "bar chart", "column chart")),
    ChartTypeDef("barh", "Bar (Horizontal)", "relational", "multi",
                 ("x", "color"), (),
                 None, False, False, True,
                 ("条形图", "横向柱状图", "horizontal bar chart")),
    ChartTypeDef("area", "Area", "relational", "multi",
                 ("x", "color", "error"), ("barmode",),
                 None, False, True, True,
                 ("面积图", "area chart")),
    ChartTypeDef("step", "Step", "relational", "multi",
                 ("x", "color"), (),
                 None, False, True, True,
                 ("阶梯图", "step chart")),
    ChartTypeDef("scatter", "Scatter", "relational", "multi",
                 ("x", "color", "size", "error", "facet"), ("marginal",),
                 None, False, True, True,
                 ("散点图", "scatter plot", "scatter chart")),
    ChartTypeDef("dot", "Dot", "relational", "multi",
                 ("x", "color"), (),
                 None, False, True, True,
                 ("点图", "圆点图", "dot plot")),
    ChartTypeDef("scatter3d", "3D Scatter", "relational", "first",
                 ("x", "z", "color"), (),
                 None, False, False, False,
                 ("3d散点图", "3d scatter")),
    ChartTypeDef("pie", "Pie", "relational", "first",
                 ("color",), (),
                 None, False, False, True,
                 ("饼图", "饼状图", "pie chart")),
    ChartTypeDef("histogram", "Histogram", "distribution", "first",
                 ("x", "color"), ("histnorm", "cumulative"),
                 None, False, False, False,
                 ("直方图", "histogram")),
    ChartTypeDef("box", "Box", "distribution", "first",
                 ("color",), ("orientation", "boxPoints"),
                 None, False, False, False,
                 ("箱线图", "箱形图", "box plot", "boxplot")),
    ChartTypeDef("violin", "Violin", "distribution", "first",
                 ("color",), ("orientation", "boxPoints"),
                 None, False, False, False,
                 ("小提琴图", "violin plot")),
    ChartTypeDef("ecdf", "ECDF", "distribution", "first",
                 ("color",), (),
                 None, False, False, False,
                 ("累积分布图", "ecdf")),
    ChartTypeDef("density_heatmap", "2D Density (Heatmap)", "distribution", "first",
                 ("x",), (),
                 None, False, False, False,
                 ("二维密度图", "2d density heatmap")),
    ChartTypeDef("density_contour", "2D Density (Contour)", "distribution", "first",
                 ("x",), (),
                 None, False, False, False,
                 ("二维密度等高线", "2d density contour")),
    ChartTypeDef("heatmap", "Heatmap", "matrix", "first",
                 ("x", "z"), ("annotated", "corr"),
                 None, False, False, False,
                 ("热力图", "heatmap", "相关矩阵热力图")),
    ChartTypeDef("contour", "Contour", "matrix", "first",
                 ("x", "z"), (),
                 None, False, False, False,
                 ("等高线图", "contour plot")),
    ChartTypeDef("splom", "Scatter Matrix", "matrix", "none",
                 ("color",), (),
                 "dimensions", False, False, False,
                 ("散点矩阵", "scatter matrix", "splom")),
    ChartTypeDef("treemap", "Treemap", "hierarchical", "first",
                 (), (),
                 None, True, False, False,
                 ("矩形树图", "树图", "treemap")),
    ChartTypeDef("sunburst", "Sunburst", "hierarchical", "first",
                 (), (),
                 None, True, False, False,
                 ("旭日图", "sunburst")),
    ChartTypeDef("icicle", "Icicle", "hierarchical", "first",
                 (), (),
                 None, True, False, False,
                 ("冰柱图", "icicle")),
    ChartTypeDef("sankey", "Sankey", "hierarchical", "first",
                 ("source", "target"), (),
                 None, False, False, False,
                 ("桑基图", "sankey")),
    ChartTypeDef("parcoords", "Parallel Coords", "hierarchical", "none",
                 ("color",), (),
                 "dimensions", False, False, False,
                 ("平行坐标", "parallel coordinates")),
    ChartTypeDef("parcats", "Parallel Categories", "hierarchical", "none",
                 (), (),
                 "dimensions", False, False, False,
                 ("平行类别", "parallel categories")),
    ChartTypeDef("radar", "Radar", "misc", "multi",
                 ("x",), (),
                 None, False, False, False,
                 ("雷达图", "radar chart", "spider chart")),
    ChartTypeDef("ternary", "Ternary", "misc", "first",
                 ("x", "z", "color"), (),
                 None, False, False, False,
                 ("三元图", "ternary plot")),
    ChartTypeDef("waterfall", "Waterfall", "misc", "first",
                 ("x",), (),
                 None, False, False, False,
                 ("瀑布图", "waterfall")),
    ChartTypeDef("funnel", "Funnel", "misc", "first",
                 ("x",), (),
                 None, False, False, False,
                 ("漏斗图", "funnel chart")),
    ChartTypeDef("table", "Table", "misc", "none",
                 (), (),
                 "columns", False, False, False,
                 ()),
    ChartTypeDef("gantt", "Gantt", "misc", "first",
                 ("color",), ("ganttFields",),
                 None, False, False, False,
                 ("甘特图", "gantt")),
    ChartTypeDef("candlestick", "Candlestick", "misc", "none",
                 ("x",), ("candlestickFields",),
                 None, False, False, False,
                 ("k线", "k线图", "蜡烛图", "candlestick")),
    ChartTypeDef("surface", "3D Surface", "misc", "first",
                 ("x", "z"), (),
                 None, False, False, False,
                 ("曲面图", "3d曲面", "surface plot")),
    ChartTypeDef("timeline", "Timeline", "misc", "first",
                 ("x",), (),
                 None, False, False, False,
                 ()),
    ChartTypeDef("gauge", "Gauge", "misc", "first",
                 (), ("gaugeRange",),
                 None, False, False, False,
                 # No bare 仪表盘/仪表: 仪表盘 is this app's own word for the
                 # Dashboard page (nav.dashboard), so it must not pin a gauge.
                 ("仪表图", "gauge", "gauge chart")),
)

CHART_TYPE_IDS: tuple[str, ...] = tuple(t.id for t in CHART_TYPES)
CHART_TYPE_MAP: dict[str, ChartTypeDef] = {t.id: t for t in CHART_TYPES}


def get_chart_type(chart_id: str) -> ChartTypeDef | None:
    return CHART_TYPE_MAP.get(chart_id)


def is_known_chart_type(chart_id: str) -> bool:
    return chart_id in CHART_TYPE_MAP


def samplable(chart_id: str) -> bool:
    spec = CHART_TYPE_MAP.get(chart_id)
    return bool(spec.samplable) if spec else False


def no_yfield_types() -> set[str]:
    return {t.id for t in CHART_TYPES if t.y_fields == "none"}


def relational_types() -> set[str]:
    return {t.id for t in CHART_TYPES if t.relational}


def type_keywords() -> tuple[tuple[str, str], ...]:
    pairs = [
        (keyword.lower(), t.id)
        for t in CHART_TYPES
        for keyword in t.keywords
    ]
    return tuple(sorted(pairs, key=lambda pair: -len(pair[0])))


def detect_chart_type(request: str) -> str | None:
    """Return the chart type named FIRST in ``request``, or ``None``.

    Resolution is position-based, never registry-order-based: every keyword is
    located in the lowercased request and the winner is the match with the
    EARLIEST start offset; two keywords matching at the same offset are broken
    by the LONGER one. So "用饼图替代现在的条形图" names pie (offset 1) rather
    than barh (offset 8) even though barh comes first in the registry, while
    "horizontal bar chart please" still resolves to barh because that longer
    phrase starts at offset 0 and merely *contains* "bar chart" at offset 11.

    Returns ``None`` when no keyword occurs at all.
    """
    lowered = request.lower()
    best: tuple[int, int] | None = None  # (start offset, negative length)
    winner: str | None = None
    for keyword, chart_id in type_keywords():
        start = lowered.find(keyword)
        if start == -1:
            continue
        rank = (start, -len(keyword))
        if best is None or rank < best:
            best, winner = rank, chart_id
    return winner
