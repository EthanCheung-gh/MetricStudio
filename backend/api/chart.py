from __future__ import annotations

import json
import logging
import uuid
from datetime import datetime
from pathlib import Path

import pandas as pd
from fastapi import APIRouter, HTTPException

logger = logging.getLogger("chart")
logging.basicConfig(level=logging.DEBUG)

from backend.core.session import session
from backend.models.chart import ChartPreviewRequest, AggregateRequest, TemplateSaveRequest, ChartTemplate, SelectionFilter, FilterSpec

router = APIRouter(prefix="/api/v1/chart", tags=["chart"])

# Chart templates persist to ~/.metricstudio/templates/{id}.json (spec §9.2)
TEMPLATES_DIR = Path.home() / ".metricstudio" / "templates"

DEFAULT_COLORS = [
    "#3b82f6",
    "#ef4444",
    "#10b981",
    "#f59e0b",
    "#8b5cf6",
    "#ec4899",
    "#06b6d4",
    "#84cc16",
    "#f97316",
    "#6366f1",
]


def _safe_sort(values):
    """Sort values with numeric-aware ordering (1,2,10 not 1,10,2)."""
    def sort_key(v):
        try:
            return (0, float(v))
        except (ValueError, TypeError):
            return (1, str(v))
    return sorted(values, key=sort_key)


def _to_records(df):
    records = df.to_dict("records")
    for record in records:
        for key, value in record.items():
            try:
                if hasattr(value, "isoformat"):
                    record[key] = value.isoformat()
                elif isinstance(value, float) and value != value:  # NaN
                    record[key] = None
            except Exception:
                pass
    return records


def _clean_numeric(values) -> list:
    """Coerce a sequence to JSON-safe floats (NaN/None become null)."""
    out = []
    for v in values:
        try:
            f = float(v)
            out.append(None if f != f else f)
        except (TypeError, ValueError):
            out.append(None)
    return out


def _trace_mode(chart_type: str):
    return {"line": "lines+markers", "area": "lines", "step": "lines", "dot": "markers"}.get(chart_type)


def _style_datum(datum: dict, chart_type: str, stack_mode: bool) -> dict:
    """Apply area/step/barh specifics to a trace built with the standard scatter/bar shape."""
    if chart_type in ("area", "step"):
        datum["fill"] = "tozeroy"
    if chart_type == "area" and stack_mode:
        datum["stackgroup"] = "one"
    if chart_type == "step":
        datum["line"] = {"shape": "hv"}
    if chart_type == "barh":
        # Horizontal bar: categories go to Y, values to X
        datum["type"] = "bar"
        datum["orientation"] = "h"
        datum["x"], datum["y"] = datum["y"], datum["x"]
        datum.pop("yaxis", None)
    if chart_type == "dot":
        datum["mode"] = "markers"
        datum.setdefault("marker", {})["size"] = 9
    return datum


def _aggregate(df, encoding):
    y_fields = encoding.y_fields or []
    color = encoding.color
    chart_type = encoding.chart_type
    opts = encoding.options

    import logging
    logging.debug(f"_aggregate: chart_type={chart_type} x={encoding.x.field if encoding.x else 'AUTO'} y_fields={[yf.field for yf in y_fields]} color={color.field if color else None} cols={list(df.columns)}")

    layout = {
        "autosize": True,
        "margin": {"t": 40, "r": 20, "b": 60, "l": 60},
        "paper_bgcolor": "rgba(0,0,0,0)",
        "plot_bgcolor": "rgba(0,0,0,0)",
        "font": {"color": "#f5f5f5"},
        "xaxis": {"title": encoding.x.field if encoding.x else None, "gridcolor": "#333333"},
        "yaxis": {"title": None, "gridcolor": "#333333"},
        "showlegend": bool(color) or len(y_fields) > 1,
    }

    # ---- Single-Y types: pie, histogram, box ----
    if chart_type == "pie":
        if not color or not y_fields:
            return {"data": [], "layout": layout}
        primary = y_fields[0]
        grouped = df.groupby(color.field, dropna=False)[primary.field].sum().reset_index()
        data = [{
            "type": "pie",
            "labels": grouped[color.field].astype(str).tolist(),
            "values": grouped[primary.field].tolist(),
            "marker": {"colors": DEFAULT_COLORS},
        }]
        return {"data": data, "layout": layout}

    if chart_type == "histogram":
        if not y_fields:
            return {"data": [], "layout": layout}
        primary = y_fields[0]
        trace = {
            "type": "histogram",
            "x": df[primary.field].tolist(),
            "marker": {"color": DEFAULT_COLORS[0]},
        }
        if opts and opts.histnorm:
            trace["histnorm"] = opts.histnorm
        if opts and opts.cumulative:
            trace["cumulative"] = {"enabled": True}
        layout["yaxis"]["title"] = primary.label or primary.field
        return {"data": [trace], "layout": layout}

    # box / violin share the same shape; violin adds a density outline
    if chart_type in ("box", "violin"):
        if not y_fields:
            return {"data": [], "layout": layout}
        primary = y_fields[0]
        horizontal = bool(opts and opts.orientation == "h")
        points = (opts.box_points if opts and opts.box_points else "outliers")
        if points == "none":
            points = False

        def _dist_trace(vals, name, idx):
            trace = {
                "type": chart_type,
                "x" if horizontal else "y": vals,
                "name": name,
                "boxpoints": points,
                "marker": {"color": DEFAULT_COLORS[idx % len(DEFAULT_COLORS)]},
            }
            if chart_type == "violin":
                trace["box_visible"] = True
                trace["meanline_visible"] = True
            return trace

        if not color:
            data = [_dist_trace(df[primary.field].dropna().tolist(), primary.label or primary.field, 0)]
            if not horizontal:
                layout["yaxis"]["title"] = primary.label or primary.field
            return {"data": data, "layout": layout}
        data = []
        for idx, (key, group) in enumerate(df.groupby(color.field, dropna=False)):
            data.append(_dist_trace(group[primary.field].dropna().tolist(), str(key), idx))
        return {"data": data, "layout": layout}

    if chart_type == "ecdf":
        if not y_fields:
            return {"data": [], "layout": layout}
        primary = y_fields[0]

        def _ecdf_xy(vals):
            xs = sorted(v for v in vals if isinstance(v, (int, float)) and v == v)
            n = len(xs)
            return xs, [(i + 1) / n for i in range(n)] if n else []

        data = []
        series = [("", df)] if not color else list(df.groupby(color.field, dropna=False))
        for idx, (key, group) in enumerate(series):
            xs, ys = _ecdf_xy(group[primary.field].tolist())
            data.append({
                "type": "scatter",
                "mode": "lines",
                "x": xs,
                "y": ys,
                "name": primary.label or primary.field if not color else str(key),
                "marker": {"color": DEFAULT_COLORS[idx % len(DEFAULT_COLORS)]},
            })
        layout["yaxis"]["title"] = "ECDF"
        layout["xaxis"]["title"] = primary.label or primary.field
        return {"data": data, "layout": layout}

    if chart_type in ("density_heatmap", "density_contour"):
        if not encoding.x or not y_fields:
            return {"data": [], "layout": layout}
        primary = y_fields[0]
        trace = {
            "type": "histogram2d" if chart_type == "density_heatmap" else "histogram2dcontour",
            "x": df[encoding.x.field].tolist(),
            "y": df[primary.field].tolist(),
            "colorscale": "Viridis",
        }
        if chart_type == "density_contour":
            trace["contours"] = {"coloring": "heatmap"}
        return {"data": [trace], "layout": layout}

    if chart_type == "heatmap":
        annotated = bool(opts and opts.annotated)

        def _clean_z(matrix):
            return [[None if (isinstance(v, float) and v != v) else float(v) for v in row] for row in matrix]

        def _annotate(trace, z):
            trace["text"] = [["" if v is None else f"{v:.2f}" for v in row] for row in z]
            trace["texttemplate"] = "%{text}"

        if opts and opts.corr:
            # One-click correlation matrix over all numeric columns
            numeric = df.select_dtypes(include="number")
            if numeric.shape[1] < 2:
                return {"data": [], "layout": layout}
            corr = numeric.corr()
            cols = [str(c) for c in corr.columns]
            z = _clean_z(corr.values.tolist())
            trace = {
                "type": "heatmap", "x": cols, "y": cols, "z": z,
                "colorscale": "RdBu", "zmin": -1, "zmax": 1, "reversescale": True,
            }
            if annotated:
                _annotate(trace, z)
            return {"data": [trace], "layout": layout}

        if not encoding.x or not y_fields or not encoding.z:
            return {"data": [], "layout": layout}
        primary = y_fields[0]
        pivot = df.pivot_table(index=primary.field, columns=encoding.x.field, values=encoding.z.field, aggfunc="mean")
        z = _clean_z(pivot.values.tolist())
        trace = {
            "type": "heatmap",
            "x": [str(c) for c in pivot.columns],
            "y": [str(i) for i in pivot.index],
            "z": z,
            "colorscale": "Viridis",
        }
        if annotated:
            _annotate(trace, z)
        return {"data": [trace], "layout": layout}

    if chart_type == "contour":
        if not encoding.x or not y_fields or not encoding.z:
            return {"data": [], "layout": layout}
        primary = y_fields[0]
        pivot = df.pivot_table(index=primary.field, columns=encoding.x.field, values=encoding.z.field, aggfunc="mean")
        z = [[None if (isinstance(v, float) and v != v) else float(v) for v in row] for row in pivot.values.tolist()]
        trace = {
            "type": "contour",
            "x": [str(c) for c in pivot.columns],
            "y": [str(i) for i in pivot.index],
            "z": z,
            "colorscale": "Viridis",
            "contours": {"coloring": "heatmap"},
        }
        return {"data": [trace], "layout": layout}

    if chart_type == "splom":
        dims = [d for d in (encoding.dimensions or []) if d in df.columns]
        if len(dims) < 2:
            return {"data": [], "layout": layout}
        trace = {
            "type": "splom",
            "dimensions": [
                {"label": d, "values": _clean_numeric(pd.to_numeric(df[d], errors="coerce"))} for d in dims
            ],
            "marker": {"color": DEFAULT_COLORS[0], "size": 5, "opacity": 0.7},
        }
        if color:
            cats = df[color.field].astype(str)
            uniq = list(cats.unique())
            trace["marker"]["color"] = [uniq.index(c) for c in cats]
        return {"data": [trace], "layout": layout}

    # ---- Hierarchical: treemap / sunburst / icicle (path levels + value) ----
    if chart_type in ("treemap", "sunburst", "icicle"):
        path = [p for p in (encoding.path or []) if p in df.columns]
        if not path or not y_fields:
            return {"data": [], "layout": layout}
        primary = y_fields[0]
        agg = primary.aggregate or "sum"
        ids, labels, parents, values = [], [], [], []
        for level in range(len(path)):
            cols = path[: level + 1]
            grouped = df.groupby(cols, dropna=False)[primary.field].agg(agg).reset_index()
            for _, row in grouped.iterrows():
                vals = [str(row[c]) for c in cols]
                ids.append("/".join(vals))
                labels.append(vals[-1])
                parents.append("/".join(vals[:-1]))
                values.append(float(row[primary.field]))
        trace = {
            "type": chart_type,
            "ids": ids,
            "labels": labels,
            "parents": parents,
            "values": values,
            "branchvalues": "total",
        }
        return {"data": [trace], "layout": layout}

    if chart_type == "sankey":
        if not encoding.source or not encoding.target or not y_fields:
            return {"data": [], "layout": layout}
        primary = y_fields[0]
        agg = primary.aggregate or "sum"
        grouped = (
            df.groupby([encoding.source.field, encoding.target.field], dropna=False)[primary.field]
            .agg(agg)
            .reset_index()
        )
        nodes: list[str] = []

        def _node_idx(name: str) -> int:
            if name not in nodes:
                nodes.append(name)
            return nodes.index(name)

        sources, targets, values = [], [], []
        for _, row in grouped.iterrows():
            sources.append(_node_idx(str(row[encoding.source.field])))
            targets.append(_node_idx(str(row[encoding.target.field])))
            values.append(float(row[primary.field]))
        trace = {
            "type": "sankey",
            "node": {"label": nodes, "pad": 12, "thickness": 16},
            "link": {"source": sources, "target": targets, "value": values},
        }
        return {"data": [trace], "layout": layout}

    if chart_type == "parcoords":
        dims = [d for d in (encoding.dimensions or []) if d in df.columns]
        if len(dims) < 2:
            return {"data": [], "layout": layout}
        trace = {
            "type": "parcoords",
            "dimensions": [
                {"label": d, "values": _clean_numeric(pd.to_numeric(df[d], errors="coerce"))} for d in dims
            ],
            "line": {},
        }
        if color:
            cats = df[color.field].astype(str)
            uniq = list(cats.unique())
            n = len(uniq)
            trace["line"]["color"] = [uniq.index(c) for c in cats]
            if n == 1:
                trace["line"]["colorscale"] = [[0, DEFAULT_COLORS[0]], [1, DEFAULT_COLORS[0]]]
            else:
                trace["line"]["colorscale"] = [
                    [i / (n - 1), DEFAULT_COLORS[i % len(DEFAULT_COLORS)]] for i in range(n)
                ]
        return {"data": [trace], "layout": layout}

    if chart_type == "parcats":
        dims = [d for d in (encoding.dimensions or []) if d in df.columns]
        if len(dims) < 2:
            return {"data": [], "layout": layout}
        trace = {
            "type": "parcats",
            "dimensions": [{"label": d, "values": df[d].astype(str).tolist()} for d in dims],
        }
        return {"data": [trace], "layout": layout}

    # ---- Coordinate variants & misc: radar / ternary / waterfall / funnel / table / gantt ----
    if chart_type == "radar":
        if not encoding.x or not y_fields:
            return {"data": [], "layout": layout}
        data = []
        for idx, yf in enumerate(y_fields):
            agg = yf.aggregate or "sum"
            grouped = df.groupby(encoding.x.field, dropna=False)[yf.field].agg(agg).reset_index()
            theta = [str(v) for v in grouped[encoding.x.field]]
            r = [float(v) for v in grouped[yf.field]]
            if theta:  # close the loop
                theta.append(theta[0])
                r.append(r[0])
            data.append({
                "type": "scatterpolar",
                "r": r,
                "theta": theta,
                "fill": "toself",
                "name": yf.label or yf.field,
                "marker": {"color": DEFAULT_COLORS[idx % len(DEFAULT_COLORS)]},
            })
        layout["polar"] = {"bgcolor": "rgba(0,0,0,0)"}
        return {"data": data, "layout": layout}

    if chart_type == "ternary":
        if not encoding.x or not y_fields or not encoding.z:
            return {"data": [], "layout": layout}
        primary = y_fields[0]

        def _ternary_trace(group, name, idx):
            return {
                "type": "scatterternary",
                "mode": "markers",
                "a": _clean_numeric(pd.to_numeric(group[encoding.x.field], errors="coerce")),
                "b": _clean_numeric(pd.to_numeric(group[primary.field], errors="coerce")),
                "c": _clean_numeric(pd.to_numeric(group[encoding.z.field], errors="coerce")),
                "name": name,
                "marker": {"color": DEFAULT_COLORS[idx % len(DEFAULT_COLORS)], "size": 6},
            }

        if not color:
            return {"data": [_ternary_trace(df, primary.label or primary.field, 0)], "layout": layout}
        data = [
            _ternary_trace(group, str(key), idx)
            for idx, (key, group) in enumerate(df.groupby(color.field, dropna=False))
        ]
        return {"data": data, "layout": layout}

    if chart_type == "waterfall":
        if not encoding.x or not y_fields:
            return {"data": [], "layout": layout}
        primary = y_fields[0]
        agg = primary.aggregate or "sum"
        grouped = df.groupby(encoding.x.field, dropna=False)[primary.field].agg(agg)
        sorted_x = _safe_sort(grouped.index)
        trace = {
            "type": "waterfall",
            "x": [str(v) for v in sorted_x],
            "y": [float(grouped.loc[v]) for v in sorted_x],
            "measure": ["relative"] * len(sorted_x),
        }
        return {"data": [trace], "layout": layout}

    if chart_type == "funnel":
        if not encoding.x or not y_fields:
            return {"data": [], "layout": layout}
        primary = y_fields[0]
        agg = primary.aggregate or "sum"
        # sort=False preserves stage order as it appears in the data
        grouped = df.groupby(encoding.x.field, dropna=False, sort=False)[primary.field].agg(agg).reset_index()
        trace = {
            "type": "funnel",
            "y": [str(v) for v in grouped[encoding.x.field]],
            "x": [float(v) for v in grouped[primary.field]],
            "marker": {"color": DEFAULT_COLORS},
        }
        return {"data": [trace], "layout": layout}

    if chart_type == "table":
        dims = [d for d in (encoding.dimensions or []) if d in df.columns]
        if not dims:
            return {"data": [], "layout": layout}
        trace = {
            "type": "table",
            "header": {"values": dims, "fill": {"color": "#1f2937"}, "font": {"color": "#f5f5f5"}},
            "cells": {
                "values": [df[d].astype(str).tolist() for d in dims],
                "fill": {"color": "#111827"},
                "font": {"color": "#d1d5db"},
            },
        }
        return {"data": [trace], "layout": layout}

    if chart_type == "gantt":
        start_f = opts.start_field if opts else None
        end_f = opts.end_field if opts else None
        if not start_f or not end_f or not y_fields or start_f not in df.columns or end_f not in df.columns:
            return {"data": [], "layout": layout}
        task_f = y_fields[0].field
        starts = pd.to_datetime(df[start_f], errors="coerce")
        ends = pd.to_datetime(df[end_f], errors="coerce")
        work = pd.DataFrame({
            "task": df[task_f].astype(str),
            "start": starts,
            # plotly date axis accepts durations in milliseconds when base is a date
            "dur_ms": (ends - starts).dt.total_seconds() * 1000,
            "grp": df[color.field].astype(str) if color else "",
        })
        data = []
        for idx, (key, group) in enumerate(work.groupby("grp")):
            data.append({
                "type": "bar",
                "orientation": "h",
                "base": group["start"].dt.strftime("%Y-%m-%d %H:%M:%S").tolist(),
                "x": group["dur_ms"].tolist(),
                "y": group["task"].tolist(),
                "name": str(key) if key else "Tasks",
                "marker": {"color": DEFAULT_COLORS[idx % len(DEFAULT_COLORS)]},
            })
        layout["xaxis"]["type"] = "date"
        layout["barmode"] = "stack"
        return {"data": data, "layout": layout}

    if chart_type == "scatter3d":
        if not encoding.x or not y_fields or not encoding.z:
            return {"data": [], "layout": layout}
        primary = y_fields[0]
        trace = {
            "type": "scatter3d",
            "mode": "markers",
            "x": _clean_numeric(pd.to_numeric(df[encoding.x.field], errors="coerce")),
            "y": _clean_numeric(pd.to_numeric(df[primary.field], errors="coerce")),
            "z": _clean_numeric(pd.to_numeric(df[encoding.z.field], errors="coerce")),
            "marker": {"size": 4, "color": DEFAULT_COLORS[0]},
        }
        if color:
            cats = df[color.field].astype(str)
            uniq = list(cats.unique())
            n = len(uniq)
            trace["marker"]["color"] = [uniq.index(c) for c in cats]
            if n == 1:
                trace["marker"]["colorscale"] = [[0, DEFAULT_COLORS[0]], [1, DEFAULT_COLORS[0]]]
            else:
                trace["marker"]["colorscale"] = [
                    [i / (n - 1), DEFAULT_COLORS[i % len(DEFAULT_COLORS)]] for i in range(n)
                ]
        layout["scene"] = {
            "bgcolor": "rgba(0,0,0,0)",
            "xaxis": {"title": encoding.x.field},
            "yaxis": {"title": primary.field},
            "zaxis": {"title": encoding.z.field},
        }
        return {"data": [trace], "layout": layout}

    if chart_type == "candlestick":
        open_f = opts.open_field if opts and opts.open_field else "open"
        high_f = opts.high_field if opts and opts.high_field else "high"
        low_f = opts.low_field if opts and opts.low_field else "low"
        close_f = opts.close_field if opts and opts.close_field else "close"
        if not encoding.x or not all(c in df.columns for c in (open_f, high_f, low_f, close_f)):
            return {"data": [], "layout": layout}
        trace = {
            "type": "candlestick",
            "x": [str(v) for v in df[encoding.x.field]],
            "open": df[open_f].tolist(),
            "high": df[high_f].tolist(),
            "low": df[low_f].tolist(),
            "close": df[close_f].tolist(),
        }
        return {"data": [trace], "layout": layout}

    if chart_type == "surface":
        if not encoding.x or not y_fields or not encoding.z:
            return {"data": [], "layout": layout}
        primary = y_fields[0]
        pivot = df.pivot_table(index=primary.field, columns=encoding.x.field, values=encoding.z.field, aggfunc="mean")
        z = [[None if (isinstance(v, float) and v != v) else float(v) for v in row] for row in pivot.values.tolist()]
        trace = {
            "type": "surface",
            "x": [str(c) for c in pivot.columns],
            "y": [str(i) for i in pivot.index],
            "z": z,
            "colorscale": "Viridis",
        }
        return {"data": [trace], "layout": layout}

    if chart_type == "timeline":
        if not encoding.x or not y_fields:
            return {"data": [], "layout": layout}
        primary = y_fields[0]
        trace = {
            "type": "scatter",
            "mode": "markers",
            "x": [str(v) for v in df[encoding.x.field]],
            "y": df[primary.field].tolist(),
            "marker": {"size": 8, "color": DEFAULT_COLORS[0]},
        }
        layout["xaxis"]["type"] = "date"
        return {"data": [trace], "layout": layout}

    # ---- Facet mode: split the multi-Y family into a subplot grid ----
    if (
        chart_type in ("line", "bar", "area", "step", "scatter", "dot")
        and encoding.facet
        and encoding.facet.field in df.columns
    ):
        facet_col = encoding.facet.field
        fx_field = encoding.x.field if encoding.x else None
        groups = list(df.groupby(facet_col, dropna=False))
        n = len(groups)
        ncols = min(n, 3)
        nrows = (n + ncols - 1) // ncols
        layout["grid"] = {"rows": nrows, "columns": ncols, "pattern": "independent", "xgap": 0.08, "ygap": 0.12}
        data = []
        for gi, (gname, gdf) in enumerate(groups):
            suffix = "" if gi == 0 else str(gi + 1)
            xa, ya = f"x{suffix}", f"y{suffix}"
            x_key, y_key = f"xaxis{suffix}", f"yaxis{suffix}"
            layout.setdefault(x_key, {})["title"] = str(gname)
            layout.setdefault(y_key, {})
            for fi, yf in enumerate(y_fields):
                agg = yf.aggregate or "sum"
                if fx_field and yf.aggregate:
                    g2 = gdf.groupby(fx_field, dropna=False)[yf.field].agg(agg).reset_index()
                    g2 = g2.sort_values(by=fx_field)
                    gx = [str(v) for v in g2[fx_field]]
                    gy = g2[yf.field].tolist()
                else:
                    gx = [str(v) for v in gdf[fx_field].tolist()] if fx_field else list(range(len(gdf)))
                    gy = gdf[yf.field].tolist()
                datum = _style_datum({
                    "type": "scatter" if chart_type in ("line", "area", "step", "dot") else chart_type,
                    "mode": _trace_mode(chart_type),
                    "x": gx,
                    "y": gy,
                    "name": yf.label or yf.field,
                    "xaxis": xa,
                    "yaxis": ya,
                    "legendgroup": yf.label or yf.field,
                    "showlegend": gi == 0,
                    "marker": {"color": DEFAULT_COLORS[fi % len(DEFAULT_COLORS)]},
                }, chart_type, False)
                data.append(datum)
        return {"data": data, "layout": layout}

    # ---- Multi-Y types: line, bar, scatter ----
    if not y_fields:
        return {"data": [], "layout": layout}

    # Auto-index X when no x field is set (applies to all types including scatter)
    if not encoding.x:
        # Copy to avoid mutating the caller's dataframe (used for other requests)
        df = df.copy()
        x_col = "__auto_index__"
        df[x_col] = df.index.astype(int)
        x_field = x_col
    else:
        x_field = encoding.x.field

    has_right_axis = any(yf.axis == "right" for yf in y_fields)

    # Build axis titles from field labels
    left_labels = [yf.label or yf.field for yf in y_fields if yf.axis == "left"]
    right_labels = [yf.label or yf.field for yf in y_fields if yf.axis == "right"]
    if left_labels:
        layout["yaxis"]["title"] = " / ".join(left_labels)
    if has_right_axis:
        layout["yaxis2"] = {
            "title": " / ".join(right_labels),
            "side": "right",
            "overlaying": "y",
            "anchor": "x",
            "gridcolor": "#333333",
        }

    stack_mode = bool(opts and opts.barmode == "stack")
    if stack_mode and chart_type in ("bar", "barh"):
        layout["barmode"] = "stack"

    data = []
    trace_norms = []  # parallel to data: normalize mode of the y-field that produced each trace
    global_color_idx = 0

    for yf in y_fields:
        agg = yf.aggregate or "sum"
        yaxis = "y2" if yf.axis == "right" else "y"
        trace_name = yf.label or yf.field

        if not color:
            # --- Single trace per Y field ---
            if yf.aggregate:
                grouped = df.groupby(x_field, dropna=False)[yf.field].agg(agg).reset_index()
                grouped = grouped.sort_values(by=x_field)
                trace_x = grouped[x_field].astype(str).tolist()
                trace_y = grouped[yf.field].tolist()
            else:
                trace_x = df[x_field].tolist()
                trace_y = df[yf.field].tolist()
                if encoding.x:
                    trace_x = [str(v) for v in trace_x]

            datum = {
                "type": "scatter" if chart_type in ("line", "area", "step", "dot") else chart_type,
                "mode": _trace_mode(chart_type),
                "x": trace_x,
                "y": trace_y,
                "name": trace_name,
                "yaxis": yaxis,
                "marker": {"color": DEFAULT_COLORS[global_color_idx % len(DEFAULT_COLORS)]},
            }
            datum = _style_datum(datum, chart_type, stack_mode)
            # Bubble scatter: size channel (raw-row paths only, lengths must match)
            if chart_type == "scatter" and encoding.size and not yf.aggregate:
                size_vals = pd.to_numeric(df[encoding.size.field], errors="coerce").tolist()
                nums = [abs(v) for v in size_vals if isinstance(v, (int, float)) and v == v]
                if nums:
                    datum["marker"]["size"] = size_vals
                    datum["marker"]["sizemode"] = "diameter"
                    datum["marker"]["sizeref"] = 2.0 * max(nums) / (40 ** 2)
            # Error bars (raw-row path only)
            if encoding.error and not yf.aggregate and chart_type in ("line", "bar", "scatter", "area", "step"):
                err_vals = pd.to_numeric(df[encoding.error.field], errors="coerce").tolist()
                datum["error_y"] = {"type": "data", "array": err_vals, "visible": True}
            data.append(datum)
            trace_norms.append(yf.normalize)
            global_color_idx += 1

        else:
            # --- Multi-series per Y field: one trace per color value ---
            # If x and color are the same column, fall back to no-color path
            if color.field == x_field:
                trace_name = yf.label or yf.field
                grouped = df.groupby(x_field, dropna=False)[yf.field].agg(agg).reset_index()
                sorted_x = _safe_sort(grouped[x_field])
                y_vals = grouped[yf.field].tolist()
                datum = _style_datum({
                    "type": "scatter" if chart_type in ("line", "area", "step", "dot") else chart_type,
                    "mode": _trace_mode(chart_type),
                    "x": [str(v) for v in sorted_x],
                    "y": y_vals,
                    "name": trace_name,
                    "yaxis": yaxis,
                    "marker": {"color": DEFAULT_COLORS[global_color_idx % len(DEFAULT_COLORS)]},
                }, chart_type, stack_mode)
                data.append(datum)
                trace_norms.append(yf.normalize)
                global_color_idx += 1
            else:
                grouped = df.groupby([color.field, x_field], dropna=False)[yf.field].agg(agg).reset_index()
                try:
                    pivot = grouped.pivot(index=x_field, columns=color.field, values=yf.field).fillna(0)
                except Exception:
                    pivot = grouped.pivot_table(index=x_field, columns=color.field, values=yf.field, aggfunc=agg, fill_value=0)

                sorted_x = _safe_sort(pivot.index)
                for series_name in pivot.columns:
                    y_vals = [float(pivot.loc[idx, series_name]) if idx in pivot.index else 0 for idx in sorted_x]
                    datum = _style_datum({
                        "type": "scatter" if chart_type in ("line", "area", "step", "dot") else chart_type,
                        "mode": _trace_mode(chart_type),
                        "x": [str(v) for v in sorted_x],
                        "y": y_vals,
                        "name": f"{trace_name} - {series_name}",
                        "yaxis": yaxis,
                        "marker": {"color": DEFAULT_COLORS[global_color_idx % len(DEFAULT_COLORS)]},
                    }, chart_type, stack_mode)
                    data.append(datum)
                    trace_norms.append(yf.normalize)
                    global_color_idx += 1

    # ---- Normalization: perSeries (÷ own max) / global (÷ max across all y-fields) ----
    if any(m != "none" for m in trace_norms):
        def _nums(vals):
            return [abs(v) for v in vals if isinstance(v, (int, float)) and v == v]

        global_max = 0.0
        for mode, datum in zip(trace_norms, data):
            if mode == "global":
                vals = _nums(datum["y"])
                if vals:
                    global_max = max(global_max, max(vals))

        for mode, datum in zip(trace_norms, data):
            if mode == "none":
                continue
            denom = global_max if mode == "global" else max(_nums(datum["y"]), default=0.0)
            if not denom:
                continue
            datum["y"] = [
                (v / denom if isinstance(v, (int, float)) and v == v else v)
                for v in datum["y"]
            ]
            datum["name"] = f"{datum['name']} (normalized)"

        # Annotate axis titles that carry normalized series
        if any(m != "none" for m in trace_norms):
            if layout["yaxis"].get("title") and any(
                m != "none" and d.get("yaxis") == "y" for m, d in zip(trace_norms, data)
            ):
                layout["yaxis"]["title"] += " (normalized)"
            if "yaxis2" in layout and any(
                m != "none" and d.get("yaxis") == "y2" for m, d in zip(trace_norms, data)
            ):
                layout["yaxis2"]["title"] += " (normalized)"

    # ---- Marginal distributions for scatter (px-style marginal_x/marginal_y) ----
    if chart_type == "scatter" and opts and (opts.marginal_x or opts.marginal_y):
        def _marginal_trace(kind: str, vals, axis: str):
            if kind == "histogram":
                t = {"type": "histogram", "showlegend": False, "marker": {"color": "#888888"}}
            elif kind == "box":
                t = {"type": "box", "showlegend": False, "boxpoints": False, "marker": {"color": "#888888"}}
            elif kind == "violin":
                t = {"type": "violin", "showlegend": False, "box_visible": False, "points": False, "marker": {"color": "#888888"}}
            else:  # rug → emulate with a box showing only points
                t = {
                    "type": "box", "showlegend": False, "boxpoints": "all",
                    "fillcolor": "rgba(0,0,0,0)", "line": {"width": 0},
                    "marker": {"color": "#888888", "size": 4},
                }
            if axis == "x":
                t["x"] = vals
                t["yaxis"] = "y2"
            else:
                t["y"] = vals
                t["xaxis"] = "x2"
            return t

        # Shrink the main plot into the lower-left quadrant
        layout["xaxis"]["domain"] = [0, 0.8]
        layout["yaxis"]["domain"] = [0, 0.8]
        if opts.marginal_x:
            x_vals = pd.to_numeric(df[x_field], errors="coerce").dropna().tolist()
            data.append(_marginal_trace(opts.marginal_x, x_vals, "x"))
            layout["yaxis2"] = {"domain": [0.82, 1], "showticklabels": False}
        if opts.marginal_y:
            y_vals = pd.to_numeric(df[y_fields[0].field], errors="coerce").dropna().tolist()
            data.append(_marginal_trace(opts.marginal_y, y_vals, "y"))
            layout["xaxis2"] = {"domain": [0.82, 1], "showticklabels": False}

    return {"data": data, "layout": layout}


def _filter_by_selection(df: pd.DataFrame, selection: "SelectionFilter") -> pd.DataFrame:
    """Filter dataset rows to the brush ranges (data coordinates from Plotly)."""
    if not selection:
        return df
    out = df
    for field, rng in (
        (selection.x_field, selection.x_range),
        (selection.y_field, selection.y_range),
    ):
        if not field or not rng or field not in out.columns:
            continue
        lo, hi = rng[0], rng[1]
        series = out[field]
        mask = pd.Series(True, index=out.index)
        # Prefer numeric comparison; fall back to datetime for date axes.
        try:
            numeric = pd.to_numeric(series, errors="coerce")
            if numeric.notna().any():
                mask = (numeric >= float(lo)) & (numeric <= float(hi))
            else:
                raise TypeError("not numeric")
        except (TypeError, ValueError):
            dt = pd.to_datetime(series, errors="coerce")
            if dt.notna().any():
                try:
                    mask = (dt >= pd.to_datetime(lo)) & (dt <= pd.to_datetime(hi))
                except (TypeError, ValueError):
                    mask = pd.Series(True, index=out.index)
        out = out[mask]
    return out


def _filter_by_filters(df: pd.DataFrame, filters: list[FilterSpec]) -> pd.DataFrame:
    """Apply dashboard filters (range / in) to dataset rows before aggregation."""
    out = df
    for f in filters or []:
        if f.field not in out.columns:
            continue
        series = out[f.field]
        if f.op == "in":
            vals = {str(v) for v in (f.values or [])}
            out = out[series.astype(str).isin(vals)]
        else:
            rng = f.range
            if not rng or len(rng) != 2:
                continue
            lo, hi = rng[0], rng[1]
            try:
                numeric = pd.to_numeric(series, errors="coerce")
                if numeric.notna().any():
                    out = out[(numeric >= float(lo)) & (numeric <= float(hi))]
                else:
                    raise TypeError("not numeric")
            except (TypeError, ValueError):
                dt = pd.to_datetime(series, errors="coerce")
                if dt.notna().any():
                    try:
                        out = out[(dt >= pd.to_datetime(lo)) & (dt <= pd.to_datetime(hi))]
                    except (TypeError, ValueError):
                        pass
    return out


@router.post("/preview")
async def preview_chart(request: ChartPreviewRequest):
    try:
        dataset = session.get(request.dataset_id)
        df = dataset.df
        if request.filters:
            df = _filter_by_filters(df, request.filters)
        for sel in (request.selections or []):
            df = _filter_by_selection(df, sel)
        if request.selection:
            df = _filter_by_selection(df, request.selection)
        figure = _aggregate(df, request.encoding)
        return figure
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/aggregate")
async def aggregate_chart(request: AggregateRequest):
    try:
        dataset = session.get(request.dataset_id)
        figure = _aggregate(dataset.df, request.encoding)
        return figure
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.get("/templates", response_model=list[ChartTemplate], response_model_by_alias=True)
async def list_templates():
    templates: list[ChartTemplate] = []
    if TEMPLATES_DIR.exists():
        for path in sorted(TEMPLATES_DIR.glob("*.json")):
            try:
                templates.append(ChartTemplate(**json.loads(path.read_text(encoding="utf-8"))))
            except Exception as exc:
                logger.warning("skipping corrupted template %s: %s", path, exc)
    return templates


@router.post("/templates", response_model=ChartTemplate, response_model_by_alias=True)
async def save_template(request: TemplateSaveRequest):
    template = ChartTemplate(
        id=uuid.uuid4().hex[:12],
        name=request.name,
        encoding=request.encoding,
        layout=request.layout,
        created_at=datetime.utcnow().isoformat(),
    )
    try:
        TEMPLATES_DIR.mkdir(parents=True, exist_ok=True)
        (TEMPLATES_DIR / f"{template.id}.json").write_text(
            template.model_dump_json(by_alias=True), encoding="utf-8"
        )
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"failed to save template: {exc}") from exc
    return template


@router.delete("/templates/{template_id}")
async def delete_template(template_id: str):
    path = TEMPLATES_DIR / f"{template_id}.json"
    if not path.exists():
        raise HTTPException(status_code=404, detail=f"template not found: {template_id}")
    path.unlink()
    return {"deleted": True}
