"""Declarative custom chart manifests — no code execution, ever.

Users drop a JSON manifest into ``~/.metricstudio/charts/`` and the app gains a
new chart type. A manifest is *data only*: it declares channels, a tiny
allowlisted transform pipeline, Plotly traces built from ``$`` slots, a layout
patch and a handful of scalar options. Nothing in a manifest is evaluated as
Python, JavaScript or Plotly expressions.

Schema v1 (camelCase on the wire and in the stored file)
------------------------------------------------
``schemaVersion`` must be ``1``. ``id`` doubles as the file stem and must match
``^[a-z][a-z0-9_-]{1,39}$``; built-in chart ids are reserved. ``label`` and
(optional) ``description`` carry both ``zh`` and ``en``. ``channels`` describes
what the encoding panel may bind; ``yFields`` is special and only carries a
``mode``. ``transforms`` are a 0-8 item allowlisted pipeline. ``traces`` are
1-8 Plotly-style trace templates. ``layout`` may only override a small set of
layout keys. ``options`` expose scalar UI controls. ``keywords`` feed the
natural-language chart-type detector.

Slots
-----
Trace values may reference data slots:

``$x``
    The ``x`` channel field.
``$y0`` .. ``$y4``
    ``encoding.y_fields[i]`` — how many exist depends on ``yFields.mode``
    (``one`` -> y0, ``range`` -> y0/y1, ``multi`` -> y0..y4 as configured).
``$color``, ``$size``, ``$z``, ``$error``
    The matching channel field.
``$count``
    An array of ``1`` values, one per rendered row. Useful as a constant
    baseline (for example ``x: "$count"`` with ``width`` scaling).
``$index``
    0-based row positions after the transform pipeline (``0..n-1``), useful for
    ordinal axes or hovertemplates.
``$<as>``
    A column produced by a prior ``group_agg`` or ``cumulate`` transform.

Data slots are only allowed on the trace keys ``x``, ``y``, ``z``, ``labels``
and ``values``.

``segments``
------------
A ``scatter`` trace whose ``mode`` contains ``lines`` may replace ``x``/``y``
with a ``segments`` object::

    {"segments": {"x": "$x", "from": "$y0", "to": "$y1"}}

The renderer emits Plotly's nested-array form, one two-point line per row:
``x = [[xi, xi], ...]`` and ``y = [[from_i, to_i], ...]``. ``horizontal: true``
swaps the axes (``y = [[xi, xi], ...]``, ``x = [[from_i, to_i], ...]``). Rows
whose ``x``, ``from`` or ``to`` value is missing/NaN are dropped as a whole
segment. ``segments`` and top-level ``x``/``y`` are mutually exclusive.

Label slots are ``$x.label``, ``$y0`` .. ``$y4`` ``.label`` and
``$color.label``; they resolve to ``yFields[i].label`` or the field name and
are only allowed in a trace's ``name`` / ``text``.

Scalar option slots are ``$opt.<key>``; they resolve from
``encoding.options`` (extra keys) falling back to the manifest default and are
only allowed in style or layout positions.

``splitBy``
-----------
A trace may declare ``"splitBy": "$color"`` to emit one trace per distinct
colour value. Series are ordered by first appearance (``pd.unique``, never
sorted). Each series gets:

* ``name`` = the template's resolved ``name`` plus ``" · "`` plus the value
  label (or just the value label when the template has no usable name);
* ``legendgroup`` = the value label (``"None"`` for ``None``/NaN, ISO-8601 for
  temporal values);
* ``showlegend: true`` unless the template sets ``showlegend`` explicitly;
* ``marker.color`` = ``palette[series_index % len(palette)]``. For a ``scatter``
  trace whose resolved ``mode`` contains ``lines`` the same palette colour is
  also written to ``line.color``. The palette deliberately wins over a *scalar*
  ``marker.color`` / ``line.color`` in the template; array colours from
  ``$slot.values`` or a literal list are preserved.

``splitBy`` also requires the declared ``color`` slot to survive the transform
chain: a ``group_agg`` that does not group by ``color`` drops it, so the chart
could never draw and the manifest is rejected at import time.

``render(..., palette=[...])`` overrides the default palette, which is the same
ten colours as the built-in builder's ``DEFAULT_COLORS``. ``splitBy`` works
together with ``segments``; it never appears in the emitted trace.

``facet`` / ``facetBy``
-----------------------
A manifest may facet in either of two ways:

* declare a ``facet`` channel and bind a column to it;
* set the manifest-level ``"facetBy": "$color"`` (the only allowed value) and
  declare a ``color`` channel. ``null``/absent means no ``facetBy``.

Both produce the same grid. Cells are the distinct facet values in first
appearance order (``pd.unique``, never sorted); ``None``/NaN renders as
``"None"`` and temporal values use ISO-8601. ``columns = min(n, 3)`` and
``rows = ceil(n / columns)``, with the cell cap described below. The renderer
sets ``layout["grid"]`` and gives cell *i* the axes suffix ``""`` for the first
cell and ``str(i + 1)`` afterwards. Each trace is rebuilt against only that
cell's rows, so data slots, ``$slot.values`` arrays, ``segments`` and
``splitBy`` all see the cell subset.
``splitBy`` is allowed inside a channel facet (series per colour per cell);
``showlegend`` then defaults to true only in the first cell unless the template
sets it explicitly. ``splitBy`` is rejected when ``facetBy`` is ``"$color"``.

At most ``MAX_FACET_CELLS`` (24) values are rendered, in first-appearance
order. If more exist, only the first 24 become grid cells and one
renderer-owned annotation (``"Showing 24 of N facet values"``) is appended to
the merged layout; the annotation is not emitted at or below the cap.

Cell axes start from the merged base + manifest ``xaxis``/``yaxis`` styling and
then get the cell label as their ``xaxis`` title, so manifest styling applies to
every cell. Grid-owned axis keys (``domain``, ``anchor``, ``overlaying``,
``matches``, ``position``, ``scaleanchor``, ``constrain``) are stripped so a
manifest cannot collapse the grid; styling keys such as ``gridcolor``,
``showgrid`` and ``title.font`` survive. A manifest cannot drop
``layout["grid"]``. A ``group_agg`` is rejected when a facet is declared,
because it drops the faceted column. A declared ``facet`` channel with no usable
binding keeps the normal empty "configure me" figure. ``facetBy``/``facet``
never appear in emitted traces. Sampling happens on the whole frame before
rendering, so per-cell row counts scale down with the cap.

Array style slots
-----------------
``$<slot>.values`` exposes a whole data slot as a Plotly array. It is allowed
only at ``marker.color``, ``marker.size``, ``marker.opacity``,
``error_x.array``, ``error_x.arrayminus``, ``error_y.array`` and
``error_y.arrayminus``. ``<slot>`` may be ``x``, ``y0``..``y4``, ``color``,
``size``, ``z``, ``error`` or a transform ``as`` output. Numeric positions
(``marker.size``, ``marker.opacity`` and the error arrays) run through
``pd.to_numeric(errors="coerce")``; numeric-looking strings such as ``"1.5"``
work, while NaN becomes ``None``. Datetime64/timedelta64 columns (and
non-numeric columns whose coercion yields no finite numbers) produce all
``None`` instead of epoch integers. ``marker.color`` keeps strings and numbers
as-is. Array style slots follow the same post-transform row subset as data
slots, so sampling eligibility (``is_samplable``) is unchanged.

Data shaping
------------
``reduce`` collapses the whole frame to one row containing only its ``as``
column. Afterwards only ``$<as>``, ``$index`` and ``$count`` resolve. It is
treated as row-changing for sampling, like ``group_agg``/``cumulate``/``limit``.

``group_agg.groupBy`` accepts one slot or an array of 1-2 slots. With an array,
every grouped column survives in the rebuilt frame alongside ``as`` and remains
resolvable (this is what makes aggregated Sankey links expressible).

``indicator``
-------------
The indicator trace may use the indicator-only data key ``value``; it must
resolve to exactly one row after transforms (normally via ``reduce``) and is
emitted as a scalar. Indicator-only style objects are ``title``, ``number``,
``delta`` and ``gauge``; they accept literals and ``$opt.<key>`` scalars only
(no data/label slots). ``gauge.axis.range`` and ``gauge.steps[].range`` support
``$opt`` pairs. Indicator traces never emit ``x``/``y`` and never participate in
sampling. A value with the wrong arity raises ``ValueError`` so the API can show
the actionable message instead of a silent empty figure.

``sankey``
----------
The Sankey trace requires ``source``, ``target`` and ``values`` (data slots or
literal arrays) of equal length. Node labels are the union of source and target
values in first-appearance order (all sources first, then unseen targets). The
renderer emits ``link.source``/``link.target`` as node indices and
``link.value`` as the resolved values. Duplicate ``(source, target)`` rows are
**not** aggregated — use multi-key ``group_agg`` for that. Style objects are
``node`` (``pad``, ``thickness``, ``line``, ``color``) and ``link``
(``color``, ``line``). ``link.color`` accepts literals and ``$opt`` scalars;
``$color.values`` inside ``link.color`` is not supported. A length mismatch
raises ``ValueError`` with the actionable message.

Security
--------
The module never imports user code, never calls ``eval``/``exec`` and never
passes an un-allowlisted trace type or style key through to the renderer. File
reads are capped at 256 KB, ids cannot escape ``CHART_DIR`` and malformed files
become entries in ``list_manifests()[1]`` instead of exceptions.
"""

from __future__ import annotations

import copy
import json
import logging
import math
import os
import re
import stat
import uuid
from datetime import date, datetime, timedelta
from decimal import Decimal
from pathlib import Path
from typing import Any, Literal

import pandas as pd
from pydantic import Field

from backend.core import chart_registry
from backend.models.data import CBaseModel

# ---------------------------------------------------------------------------
# Public constants
# ---------------------------------------------------------------------------

CHART_DIR: Path = Path.home() / ".metricstudio" / "charts"

MAX_MANIFEST_BYTES = 256 * 1024
MAX_TRANSFORMS = 8
MAX_TRACES = 8
MAX_OPTIONS = 8
MAX_KEYWORDS = 5
MAX_FACET_CELLS = 24

CHANNEL_KEYS: tuple[str, ...] = (
    "x", "color", "size", "facet", "z", "error", "source", "target",
)
CHANNEL_TYPES: tuple[str, ...] = ("quantitative", "nominal", "temporal")
Y_FIELD_MODES: tuple[str, ...] = ("none", "one", "range", "multi")
TRACE_TYPES: tuple[str, ...] = (
    "scatter", "bar", "box", "violin", "waterfall", "funnel", "indicator",
    "histogram", "sankey",
)
STYLE_KEYS: tuple[str, ...] = (
    "mode", "name", "text", "textposition", "orientation", "opacity", "fill",
    "line", "marker", "width", "offsetgroup", "showlegend", "hovertemplate",
    "hole", "boxpoints", "cumulative", "histnorm", "error_x", "error_y",
    "title", "number", "gauge", "delta", "node", "link", "arrangement",
)
DATA_KEYS: tuple[str, ...] = ("x", "y", "z", "labels", "values")
INDICATOR_STYLE_KEYS: frozenset[str] = frozenset({
    "title", "number", "gauge", "delta",
})
INDICATOR_DATA_KEYS: frozenset[str] = frozenset({"value"})
SANKEY_DATA_KEYS: frozenset[str] = frozenset({"source", "target"})
SANKEY_STYLE_KEYS: frozenset[str] = frozenset({
    "node", "link", "arrangement",
})
_SEGMENT_KEYS: frozenset[str] = frozenset({"x", "from", "to", "horizontal"})

#: Axis keys owned by the grid. A manifest may style axes, but it must not be
#: able to reposition/link them in a way that collapses ``layout.grid``.
_FACET_AXIS_STRIP_KEYS: frozenset[str] = frozenset({
    "domain", "anchor", "overlaying", "matches", "position",
    "scaleanchor", "constrain",
})
SPLIT_TRACE_TYPES: frozenset[str] = frozenset({
    "scatter", "bar", "box", "violin", "histogram", "funnel",
})

#: Array style slots (``$slot.values``) are allowed only at these exact paths.
_ARRAY_SLOT_PATHS: frozenset[str] = frozenset({
    "marker.color", "marker.size", "marker.opacity",
    "error_x.array", "error_x.arrayminus",
    "error_y.array", "error_y.arrayminus",
})
_NUMERIC_ARRAY_SLOT_PATHS: frozenset[str] = frozenset({
    "marker.size", "marker.opacity",
    "error_x.array", "error_x.arrayminus",
    "error_y.array", "error_y.arrayminus",
})
_ARRAY_SLOT_ALLOWED = (
    "marker.color, marker.size, marker.opacity, error_x.array, "
    "error_x.arrayminus, error_y.array, error_y.arrayminus"
)

#: Identical to backend/api/chart.py's DEFAULT_COLORS; duplicated deliberately
#: so the core renderer never imports from the API layer.
_DEFAULT_PALETTE: tuple[str, ...] = (
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
)
LAYOUT_KEYS: tuple[str, ...] = (
    "showlegend", "barmode", "margin", "xaxis", "yaxis", "legend", "hovermode",
    "polar", "title",
)
TOP_LEVEL_KEYS: frozenset[str] = frozenset({
    "schemaVersion", "id", "label", "description", "channels", "transforms",
    "traces", "layout", "options", "keywords", "facetBy",
})
OPTION_TYPES: tuple[str, ...] = ("number", "text", "boolean", "select")

#: Transform op -> keys allowed besides ``op``.
TRANSFORM_KEYS: dict[str, frozenset[str]] = {
    "dropna": frozenset({"slots"}),
    "sort": frozenset({"by", "descending"}),
    "limit": frozenset({"count", "from"}),
    "group_agg": frozenset({"groupBy", "field", "agg", "as"}),
    "cumulate": frozenset({"field", "as"}),
    "reduce": frozenset({"field", "agg", "as"}),
}
GROUP_AGGS: tuple[str, ...] = ("sum", "mean", "count", "min", "max")

#: Slots a transform may name. These are *bare* names (``x``, ``y0``), not
#: ``$x`` — the ``$`` prefix belongs to trace/layout slots only.
_RESERVED_SLOT_NAMES: frozenset[str] = frozenset({
    "x", "y0", "y1", "y2", "y3", "y4", "color", "size", "z", "error",
    "facet", "source", "target", "count", "index",
})
_BASE_DATA_SLOTS: frozenset[str] = frozenset({
    "x", "y0", "y1", "y2", "y3", "y4", "color", "size", "z", "error",
    "source", "target", "count", "index",
})
_SLOT_CHANNEL_KEYS: frozenset[str] = frozenset({
    "x", "color", "size", "z", "error", "source", "target",
})
_Y_SLOT_RE = re.compile(r"^y([0-4])$")

#: Nested style objects. The top-level style allowlist above is the security
#: boundary; nested objects are kept to the keys Plotly actually understands.
_NESTED_STYLE_KEYS: dict[str, frozenset[str]] = {
    "line": frozenset({
        "color", "width", "dash", "shape", "smoothing", "simplify",
    }),
    "marker": frozenset({
        "color", "size", "symbol", "opacity", "angle", "line", "colorscale",
        "showscale", "cmin", "cmax", "sizemode", "sizeref", "standoff",
    }),
    "cumulative": frozenset({"enabled", "direction", "currentbin", "values"}),
    "error_x": frozenset({
        "type", "array", "arrayminus", "visible", "color", "thickness", "width",
    }),
    "error_y": frozenset({
        "type", "array", "arrayminus", "visible", "color", "thickness", "width",
    }),
    "node": frozenset({"pad", "thickness", "line", "color"}),
    "link": frozenset({"color", "line"}),
}

_FONT_KEYS: frozenset[str] = frozenset({"family", "size", "color"})
_DELTA_MARKER_KEYS: frozenset[str] = frozenset({"color", "symbol"})
_GAUGE_AXIS_KEYS: frozenset[str] = frozenset({
    "range", "tickvals", "ticktext", "tickformat", "visible",
})
_GAUGE_BAR_KEYS: frozenset[str] = frozenset({"color", "thickness"})
_GAUGE_STEP_KEYS: frozenset[str] = frozenset({"range", "color"})
_INDICATOR_TITLE_KEYS: frozenset[str] = frozenset({"text", "font"})
_INDICATOR_NUMBER_KEYS: frozenset[str] = frozenset({
    "valueformat", "suffix", "prefix", "font",
})
_INDICATOR_DELTA_KEYS: frozenset[str] = frozenset({
    "reference", "relative", "valueformat", "increasing", "decreasing",
    "position",
})
_INDICATOR_GAUGE_KEYS: frozenset[str] = frozenset({
    "axis", "bar", "bgcolor", "steps", "shape", "thickness",
})

#: Render-side schema mirror; kinds map to the resolver for that leaf/object.
_INDICATOR_SCHEMA: dict[str, dict[str, str]] = {
    "title": {
        "text": "scalar",
        "font": "font",
    },
    "number": {
        "valueformat": "scalar",
        "suffix": "scalar",
        "prefix": "scalar",
        "font": "font",
    },
    "delta": {
        "reference": "scalar",
        "relative": "scalar",
        "valueformat": "scalar",
        "position": "scalar",
        "increasing": "delta_marker",
        "decreasing": "delta_marker",
    },
    "gauge": {
        "axis": "axis",
        "bar": "bar",
        "bgcolor": "scalar",
        "steps": "steps",
        "shape": "scalar",
        "thickness": "scalar",
    },
}

_ID_RE = re.compile(r"^[a-z][a-z0-9_-]{1,39}$")
_ID_PATTERN = "^[a-z][a-z0-9_-]{1,39}$"
_AS_RE = re.compile(r"^[a-z][a-z0-9_]{0,23}$")
_OPTION_KEY_RE = re.compile(r"^[a-z][a-zA-Z0-9_]{0,23}$")

_MISSING = object()
_OPTION_INVALID = object()


class _SlotSet(set[str]):
    """Available slot names plus how the current frame was reshaped."""

    def __init__(self, values=(), *, declared_channels=()):
        super().__init__(values)
        self.declared_channels = set(declared_channels)
        self.cleared_by: str | None = None
_CACHE: dict[str, "CustomChartManifest"] | None = None
_CACHE_SIG: tuple | None = None
_LOG = logging.getLogger(__name__)

#: Defence-in-depth: every recursive manifest walker stops here instead of
#: relying on Python's recursion limit. 32 is far more than a legitimate
#: layout/style object needs.
_MAX_WALK_DEPTH = 32

#: Stems Windows refuses as file names, even with an extension.
_WINDOWS_RESERVED_STEMS: frozenset[str] = frozenset({
    "con", "prn", "aux", "nul",
    *(f"com{i}" for i in range(1, 10)),
    *(f"lpt{i}" for i in range(1, 10)),
})

#: Mirrors ``backend.models.chart.ChartOptions`` fields (snake_case + camelCase).
#: A custom option with one of these keys would be stored as a model extra but
#: then collide with a typed built-in field on the next ChartOptions round-trip.
_RESERVED_OPTION_KEYS: frozenset[str] = frozenset({
    "orientation", "barmode", "histnorm", "cumulative",
    "boxPoints", "box_points",
    "marginalX", "marginal_x",
    "marginalY", "marginal_y",
    "annotated", "corr",
    "startField", "start_field",
    "endField", "end_field",
    "openField", "open_field",
    "highField", "high_field",
    "lowField", "low_field",
    "closeField", "close_field",
    "gaugeMin", "gauge_min",
    "gaugeMax", "gauge_max",
})


# ---------------------------------------------------------------------------
# Public models
# ---------------------------------------------------------------------------

class LocalizedText(CBaseModel):
    """A string shown in both UI languages."""

    zh: str
    en: str


class ChannelSpec(CBaseModel):
    """One encoding channel declared by a manifest."""

    required: bool = True
    types: list[Literal["quantitative", "nominal", "temporal"]] = Field(
        default_factory=list
    )


class YFieldsSpec(CBaseModel):
    """The special ``yFields`` pseudo-channel."""

    mode: Literal["none", "one", "range", "multi"] = "none"


class CustomChannels(CBaseModel):
    """All channels declared by a manifest."""

    x: ChannelSpec | None = None
    color: ChannelSpec | None = None
    size: ChannelSpec | None = None
    facet: ChannelSpec | None = None
    z: ChannelSpec | None = None
    error: ChannelSpec | None = None
    source: ChannelSpec | None = None
    target: ChannelSpec | None = None
    y_fields: YFieldsSpec | None = None


class CustomChartOption(CBaseModel):
    """One scalar UI option, addressable from traces as ``$opt.<key>``."""

    key: str
    type: Literal["number", "text", "boolean", "select"]
    default: bool | int | float | str | None = None
    choices: list[str] | None = None
    label: LocalizedText


class CustomChartManifest(CBaseModel):
    """A validated declarative custom chart definition."""

    schema_version: int = 1
    id: str
    label: LocalizedText
    description: LocalizedText | None = None
    facet_by: str | None = None
    channels: CustomChannels = Field(default_factory=CustomChannels)
    transforms: list[dict[str, Any]] = Field(default_factory=list)
    traces: list[dict[str, Any]] = Field(default_factory=list)
    layout: dict[str, Any] = Field(default_factory=dict)
    options: list[CustomChartOption] = Field(default_factory=list)
    keywords: list[str] = Field(default_factory=list)


# ---------------------------------------------------------------------------
# Validation
# ---------------------------------------------------------------------------

def _localized(
    value: Any,
    path: str,
    errors: list[str],
    max_len: int,
    *,
    required: bool = True,
) -> LocalizedText | None:
    """Validate a ``{zh, en}`` object and collect every problem."""
    if value is None:
        if required:
            errors.append(f"{path}: must be an object with 'zh' and 'en'")
        return None
    if not isinstance(value, dict):
        errors.append(f"{path}: must be an object with 'zh' and 'en'")
        return None
    for extra in sorted(set(value) - {"zh", "en"}, key=str):
        errors.append(f"{path}.{extra}: unsupported language; only 'zh' and 'en' are allowed")
    result: dict[str, str] = {}
    for lang in ("zh", "en"):
        text = value.get(lang)
        if not isinstance(text, str) or not text.strip():
            errors.append(f"{path}.{lang}: must be 1-{max_len} characters")
            continue
        if len(text) > max_len:
            errors.append(f"{path}.{lang}: must be 1-{max_len} characters")
            continue
        result[lang] = text
    if len(result) != 2:
        return None
    return LocalizedText(zh=result["zh"], en=result["en"])


def _validate_keywords(
    value: Any,
    errors: list[str],
    claimed: list[tuple[str, str]],
) -> list[str]:
    """Validate keywords, normalising to lowercase and rejecting collisions."""
    if value is None:
        return []
    if not isinstance(value, list):
        errors.append("keywords: must be a list of strings")
        return []
    if len(value) > MAX_KEYWORDS:
        errors.append(f"keywords: at most {MAX_KEYWORDS} allowed (got {len(value)})")

    claimed_map: dict[str, str] = {}
    for keyword, owner in claimed:
        claimed_map.setdefault(keyword.lower(), owner)

    normalised: list[str] = []
    seen: set[str] = set()
    for index, item in enumerate(value):
        path = f"keywords[{index}]"
        if not isinstance(item, str):
            errors.append(f"{path}: must be a string")
            continue
        keyword = item.strip().lower()
        if not 2 <= len(keyword) <= 24:
            errors.append(f"{path}: must be 2-24 characters")
            continue
        if keyword in seen:
            errors.append(f"{path}: duplicate keyword {keyword!r} in this manifest")
            continue
        seen.add(keyword)
        owner = claimed_map.get(keyword)
        if owner is not None:
            if chart_registry.is_known_chart_type(owner):
                errors.append(
                    f"{path}: {keyword!r} is already used by built-in chart type {owner!r}"
                )
            else:
                errors.append(
                    f"{path}: {keyword!r} is already used by custom chart {owner!r}"
                )
        normalised.append(keyword)
    return normalised


def _validate_options(value: Any, errors: list[str]) -> set[str]:
    """Validate options and return every syntactically valid option key."""
    keys: set[str] = set()
    if value is None:
        return keys
    if not isinstance(value, list):
        errors.append("options: must be a list")
        return keys
    if len(value) > MAX_OPTIONS:
        errors.append(f"options: at most {MAX_OPTIONS} allowed (got {len(value)})")

    seen: set[str] = set()
    for index, item in enumerate(value):
        path = f"options[{index}]"
        if not isinstance(item, dict):
            errors.append(f"{path}: must be an object")
            continue
        for extra in sorted(set(item) - {"key", "type", "default", "choices", "label"}, key=str):
            errors.append(f"{path}.{extra}: not allowed on an option")

        key = item.get("key")
        if not isinstance(key, str) or not _OPTION_KEY_RE.fullmatch(key):
            errors.append(f"{path}.key: must match ^[a-z][a-zA-Z0-9_]{{0,23}}$")
        else:
            keys.add(key)
            if key in seen:
                errors.append(f"{path}.key: duplicate option key {key!r}")
            seen.add(key)
            if key in _RESERVED_OPTION_KEYS:
                errors.append(
                    f"{path}.key: {key!r} is reserved by the built-in option set"
                )

        option_type = item.get("type")
        if option_type not in OPTION_TYPES:
            errors.append(
                f"{path}.type: must be one of {', '.join(OPTION_TYPES)}"
            )

        _localized(item.get("label"), f"{path}.label", errors, 60)

        choices = item.get("choices")
        choice_list: list[str] | None = None
        if option_type == "select":
            if not isinstance(choices, list) or not 1 <= len(choices) <= 20:
                errors.append(f"{path}.choices: select options need 1-20 choices")
            else:
                choice_list = []
                seen_choices: set[str] = set()
                for choice_index, choice in enumerate(choices):
                    if not isinstance(choice, str):
                        errors.append(
                            f"{path}.choices[{choice_index}]: must be a string"
                        )
                        continue
                    if choice in seen_choices:
                        errors.append(
                            f"{path}.choices[{choice_index}]: duplicate choice {choice!r}"
                        )
                        continue
                    seen_choices.add(choice)
                    choice_list.append(choice)
        elif choices is not None:
            errors.append(f"{path}.choices: only allowed for select options")

        if "default" not in item:
            errors.append(f"{path}.default: is required")
            continue
        default = item["default"]
        if option_type == "number":
            finite = False
            if isinstance(default, (int, float)) and not isinstance(default, bool):
                try:
                    finite = math.isfinite(float(default))
                except (OverflowError, ValueError):
                    finite = False
            if not finite:
                errors.append(f"{path}.default: must be a finite number")
        elif option_type == "text":
            if not isinstance(default, str):
                errors.append(f"{path}.default: must be a string")
        elif option_type == "boolean":
            if not isinstance(default, bool):
                errors.append(f"{path}.default: must be true or false")
        elif option_type == "select":
            if not isinstance(default, str):
                errors.append(f"{path}.default: must be one of the choices")
            elif choice_list is not None and default not in choice_list:
                errors.append(f"{path}.default: must be one of the choices")
    return keys


def _validate_channels(value: Any, errors: list[str]) -> tuple[set[str], str | None]:
    """Validate channels and return (available base slots, yFields mode)."""
    available: set[str] = set()
    if value is None:
        value = {}
    if not isinstance(value, dict):
        errors.append("channels: must be an object")
        value = {}

    usable = False
    for key in value:
        if key not in CHANNEL_KEYS and key != "yFields":
            errors.append(
                f"channels.{key}: unknown channel (allowed: "
                f"{', '.join(CHANNEL_KEYS)}, yFields)"
            )

    for key in CHANNEL_KEYS:
        if key not in value:
            continue
        usable = True
        if key in _SLOT_CHANNEL_KEYS:
            available.add(key)
        spec = value[key]
        if not isinstance(spec, dict):
            errors.append(f"channels.{key}: must be an object")
            continue
        for extra in sorted(set(spec) - {"required", "types"}, key=str):
            errors.append(f"channels.{key}.{extra}: not allowed on a channel")
        required = spec.get("required", True)
        if not isinstance(required, bool):
            errors.append(f"channels.{key}.required: must be true or false")
        types = spec.get("types", [])
        if not isinstance(types, list):
            errors.append(
                f"channels.{key}.types: must be a list of "
                f"{', '.join(CHANNEL_TYPES)}"
            )
        else:
            seen_types: set[str] = set()
            for type_index, channel_type in enumerate(types):
                if not isinstance(channel_type, str) or channel_type not in CHANNEL_TYPES:
                    errors.append(
                        f"channels.{key}.types[{type_index}]: must be one of "
                        f"{', '.join(CHANNEL_TYPES)}"
                    )
                elif channel_type in seen_types:
                    errors.append(
                        f"channels.{key}.types[{type_index}]: duplicate type "
                        f"{channel_type!r}"
                    )
                else:
                    seen_types.add(channel_type)

    y_mode: str | None = None
    if "yFields" in value:
        y_fields = value["yFields"]
        if not isinstance(y_fields, dict):
            errors.append("channels.yFields: must be an object")
        else:
            for extra in sorted(set(y_fields) - {"mode"}, key=str):
                errors.append(f"channels.yFields.{extra}: not allowed on yFields")
            mode = y_fields.get("mode")
            if mode not in Y_FIELD_MODES:
                errors.append(
                    "channels.yFields.mode: must be one of "
                    f"{', '.join(Y_FIELD_MODES)}"
                )
            else:
                y_mode = mode
                if mode != "none":
                    usable = True
                if mode == "one":
                    available.add("y0")
                elif mode == "range":
                    available.update({"y0", "y1"})
                elif mode == "multi":
                    available.update({f"y{i}" for i in range(5)})

    if not usable:
        errors.append(
            'channels: declare at least one channel or a yFields mode other '
            'than "none"'
        )
    return available, y_mode


def _transform_slot(
    slot: Any,
    path: str,
    errors: list[str],
    available: set[str],
) -> str | None:
    """Validate a bare transform slot name."""
    if not isinstance(slot, str) or not slot:
        errors.append(f"{path}: must be a slot name")
        return None
    if slot.startswith("$"):
        errors.append(
            f"{path}: use bare slot names in transforms (for example 'x' or "
            f"'y0'), not {slot!r}"
        )
        return None
    if slot not in available:
        errors.append(
            f"{path}: unknown slot {slot!r} (available: "
            f"{', '.join(sorted(available)) or 'none'})"
        )
        return None
    return slot


def _transform_group_slots(
    value: Any,
    path: str,
    errors: list[str],
    available: set[str],
) -> list[str]:
    """Validate group_agg's groupBy: one slot or an array of 1-2 slots."""
    if isinstance(value, str):
        slot = _transform_slot(value, path, errors, available)
        return [slot] if slot is not None else []
    if isinstance(value, list) and 1 <= len(value) <= 2:
        slots: list[str] = []
        seen: set[str] = set()
        for index, item in enumerate(value):
            slot = _transform_slot(
                item, f"{path}[{index}]", errors, available
            )
            if slot is None:
                continue
            if slot in seen:
                errors.append(f"{path}: duplicate slot {slot!r}")
                continue
            seen.add(slot)
            slots.append(slot)
        return slots
    errors.append(f"{path}: accepts a slot or an array of 1-2 slots")
    return []


def _transform_as(
    value: Any,
    path: str,
    errors: list[str],
    available: set[str],
) -> str | None:
    """Validate a transform output column name."""
    if not isinstance(value, str) or not _AS_RE.fullmatch(value):
        errors.append(f"{path}: must match ^[a-z][a-z0-9_]{{0,23}}$")
        return None
    if value in _RESERVED_SLOT_NAMES or value in available:
        errors.append(f"{path}: {value!r} shadows an existing slot")
        return None
    return value


def _validate_transforms(
    value: Any,
    errors: list[str],
    available: set[str],
    has_facet: bool,
) -> None:
    """Validate the transform pipeline, mutating ``available`` as it goes."""
    if value is None:
        return
    if not isinstance(value, list):
        errors.append("transforms: must be a list")
        return
    if len(value) > MAX_TRANSFORMS:
        errors.append(
            f"transforms: at most {MAX_TRANSFORMS} allowed (got {len(value)})"
        )

    for index, item in enumerate(value):
        path = f"transforms[{index}]"
        if not isinstance(item, dict):
            errors.append(f"{path}: must be an object")
            continue
        op = item.get("op")
        if not isinstance(op, str) or op not in TRANSFORM_KEYS:
            errors.append(
                f"{path}.op: unsupported transform op {op!r} (allowed: "
                f"{', '.join(TRANSFORM_KEYS)})"
            )
            continue
        for extra in sorted(set(item) - {"op"} - TRANSFORM_KEYS[op], key=str):
            errors.append(f"{path}.{extra}: not allowed for op {op!r}")

        if op == "dropna":
            slots = item.get("slots")
            if not isinstance(slots, list) or not 1 <= len(slots) <= 6:
                errors.append(f"{path}.slots: must list 1-6 slots")
                continue
            seen: set[str] = set()
            for slot_index, slot in enumerate(slots):
                slot_path = f"{path}.slots[{slot_index}]"
                checked = _transform_slot(slot, slot_path, errors, available)
                if checked is None:
                    continue
                if checked in seen:
                    errors.append(f"{slot_path}: duplicate slot {checked!r}")
                seen.add(checked)

        elif op == "sort":
            if "by" not in item:
                errors.append(f"{path}.by: is required")
            else:
                _transform_slot(item.get("by"), f"{path}.by", errors, available)
            if "descending" in item and not isinstance(item["descending"], bool):
                errors.append(f"{path}.descending: must be true or false")

        elif op == "limit":
            count = item.get("count")
            if (
                not isinstance(count, int)
                or isinstance(count, bool)
                or not 1 <= count <= 5000
            ):
                errors.append(f"{path}.count: must be an integer between 1 and 5000")
            origin = item.get("from", "top")
            if origin not in ("top", "bottom"):
                errors.append(f"{path}.from: must be 'top' or 'bottom'")

        elif op == "group_agg":
            if has_facet:
                errors.append(
                    f"{path}: group_agg cannot be combined with a facet "
                    f"('facet'/'facetBy' drop the faceted column)"
                )
            group_slots: list[str] = []
            if "groupBy" not in item:
                errors.append(f"{path}.groupBy: is required")
            else:
                group_slots = _transform_group_slots(
                    item.get("groupBy"), f"{path}.groupBy", errors, available
                )
            if "field" not in item:
                errors.append(f"{path}.field: is required")
            else:
                _transform_slot(item.get("field"), f"{path}.field", errors, available)
            agg = item.get("agg")
            if agg not in GROUP_AGGS:
                errors.append(
                    f"{path}.agg: must be one of {', '.join(GROUP_AGGS)}"
                )
            as_name = None
            if "as" not in item:
                errors.append(f"{path}.as: is required")
            else:
                as_name = _transform_as(item.get("as"), f"{path}.as", errors, available)
            # group_agg collapses the frame to the grouped column(s) plus the
            # aggregate, so later transforms see only those slots.
            next_available: set[str] = set(group_slots)
            if as_name is not None:
                next_available.add(as_name)
            available.clear()
            available.update(next_available)
            if isinstance(available, _SlotSet):
                available.cleared_by = "group_agg"

        elif op == "reduce":
            if has_facet:
                errors.append(
                    f"{path}: reduce cannot be combined with a facet "
                    f"('facet'/'facetBy' drop the faceted column)"
                )
            if not all(key in item for key in ("field", "agg", "as")):
                errors.append(
                    f"{path}: 'reduce' requires 'field', 'agg' and 'as'"
                )
            if "field" in item:
                _transform_slot(
                    item.get("field"), f"{path}.field", errors, available
                )
            if "agg" in item and item.get("agg") not in GROUP_AGGS:
                errors.append(
                    f"{path}.agg: must be one of {', '.join(GROUP_AGGS)}"
                )
            as_name = None
            if "as" in item:
                as_name = _transform_as(
                    item.get("as"), f"{path}.as", errors, available
                )
            # reduce collapses the whole frame to one row with only the alias.
            available.clear()
            if as_name is not None:
                available.add(as_name)
            if isinstance(available, _SlotSet):
                available.cleared_by = "reduce"

        elif op == "cumulate":
            if "field" not in item:
                errors.append(f"{path}.field: is required")
            else:
                _transform_slot(item.get("field"), f"{path}.field", errors, available)
            if "as" not in item:
                errors.append(f"{path}.as: is required")
            else:
                as_name = _transform_as(item.get("as"), f"{path}.as", errors, available)
                if as_name is not None:
                    available.add(as_name)


def _y_slot_supplied(name: str, y_mode: str | None) -> bool:
    if name == "y0":
        return y_mode in ("one", "range", "multi")
    if name == "y1":
        return y_mode in ("range", "multi")
    if name in ("y2", "y3", "y4"):
        return y_mode == "multi"
    return False


def _slot_is_declared(
    name: str,
    available: set[str],
    y_mode: str | None,
) -> bool:
    declared = getattr(available, "declared_channels", set())
    if name in ("x", "color", "size", "z", "error", "source", "target"):
        return name in declared
    if _Y_SLOT_RE.fullmatch(name):
        return _y_slot_supplied(name, y_mode)
    return False


def _reduce_unavailable_message(
    path: str,
    slot: str,
    *,
    kind: str = "data slot",
) -> str:
    return (
        f"{path}: {kind} '${slot}' is not available after the preceding "
        f"'reduce' transform (only its 'as' output, $index and $count remain)"
    )


def _y_slot_error(
    name: str,
    path: str,
    errors: list[str],
    y_mode: str | None,
    *,
    kind: str = "data slot",
) -> None:
    if y_mode is None or y_mode == "none":
        errors.append(
            f"{path}: {kind} '${name}' requires channels.yFields.mode other "
            f"than 'none'"
        )
    elif y_mode == "one":
        errors.append(
            f"{path}: {kind} '${name}' is not supplied by yFields.mode 'one' "
            f"(only y0)"
        )
    elif y_mode == "range":
        errors.append(
            f"{path}: {kind} '${name}' is not supplied by yFields.mode 'range' "
            f"(only y0 and y1)"
        )
    else:
        errors.append(
            f"{path}: {kind} '${name}' is not supplied by yFields.mode 'multi'"
        )


def _validate_label_slot(
    value: str,
    path: str,
    errors: list[str],
    available: set[str],
    y_mode: str | None,
) -> None:
    name = value[1:-len(".label")]
    if name == "x":
        if "x" not in available:
            if (
                getattr(available, "cleared_by", None) == "reduce"
                and _slot_is_declared("x", available, y_mode)
            ):
                errors.append(
                    _reduce_unavailable_message(
                        path, "x.label", kind="label slot"
                    )
                )
            else:
                errors.append(
                    f"{path}: label slot '$x.label' requires an 'x' channel"
                )
        return
    if name == "color":
        if "color" not in available:
            if (
                getattr(available, "cleared_by", None) == "reduce"
                and _slot_is_declared("color", available, y_mode)
            ):
                errors.append(
                    _reduce_unavailable_message(
                        path, "color.label", kind="label slot"
                    )
                )
            else:
                errors.append(
                    f"{path}: label slot '$color.label' requires a 'color' channel"
                )
        return
    if _Y_SLOT_RE.fullmatch(name):
        if name not in available:
            if (
                getattr(available, "cleared_by", None) == "reduce"
                and _slot_is_declared(name, available, y_mode)
            ):
                errors.append(
                    _reduce_unavailable_message(
                        path, f"{name}.label", kind="label slot"
                    )
                )
            else:
                _y_slot_error(name, path, errors, y_mode, kind="label slot")
        return
    errors.append(
        f"{path}: unsupported label slot {value!r}; use $x.label, "
        f"$y0-$y4.label or $color.label"
    )


def _validate_data_slot(
    value: str,
    path: str,
    errors: list[str],
    available: set[str],
    y_mode: str | None,
    option_keys: set[str],
) -> None:
    if value.startswith("$opt."):
        key = value[len("$opt."):]
        if key not in option_keys:
            errors.append(
                f"{path}: option slot {value!r} refers to unknown option {key!r}"
            )
        errors.append(
            f"{path}: option slots like {value!r} are only allowed in style or "
            f"layout positions"
        )
        return
    if ".label" in value:
        errors.append(
            f"{path}: label slots like {value!r} are only allowed in name or text"
        )
        return

    name = value[1:]
    if not name:
        errors.append(f"{path}: empty slot")
        return
    if name in ("count", "index"):
        return
    if name in _BASE_DATA_SLOTS:
        if name in available:
            return
        if (
            getattr(available, "cleared_by", None) == "reduce"
            and _slot_is_declared(name, available, y_mode)
        ):
            errors.append(_reduce_unavailable_message(path, name))
            return
        if name == "x":
            errors.append(f"{path}: data slot '$x' requires an 'x' channel")
        elif _Y_SLOT_RE.fullmatch(name):
            _y_slot_error(name, path, errors, y_mode)
        else:
            errors.append(
                f"{path}: data slot '${name}' requires a '{name}' channel"
            )
        return
    if name in available:
        return  # transform output
    errors.append(
        f"{path}: unknown data slot {value!r}; use x, y0-y4, color, size, z, "
        f"error, source, target, count, index or a transform output"
    )


def _validate_segment_slot(
    value: Any,
    path: str,
    errors: list[str],
    available: set[str],
    y_mode: str | None,
    option_keys: set[str],
) -> None:
    if not isinstance(value, str) or not value.startswith("$"):
        errors.append(f"{path}: must be a data slot such as '$x'")
        return
    if value.startswith("$opt."):
        errors.append(f"{path}: must be a data slot, not an option slot")
        return
    if ".label" in value:
        errors.append(f"{path}: must be a data slot, not a label slot")
        return
    _validate_data_slot(value, path, errors, available, y_mode, option_keys)


def _validate_segments(
    value: Any,
    path: str,
    errors: list[str],
    available: set[str],
    y_mode: str | None,
    option_keys: set[str],
    trace_type: Any,
    trace_mode: Any,
) -> None:
    """Validate the ``segments`` object on one trace (``path`` is traces[i])."""
    segment_path = f"{path}.segments"
    if trace_type != "scatter":
        errors.append(f"{segment_path}: only allowed on type 'scatter'")
    if not isinstance(trace_mode, str) or "lines" not in trace_mode.split("+"):
        errors.append(
            f"{path}.mode: segments requires a mode that includes 'lines' "
            f"(for example 'lines' or 'lines+markers')"
        )
    if not isinstance(value, dict):
        errors.append(
            f"{segment_path}: must be an object with 'x', 'from' and 'to'"
        )
        return

    for extra in sorted(set(value) - _SEGMENT_KEYS, key=str):
        errors.append(f"{segment_path}.{extra}: not allowed on segments")
    for key in ("x", "from", "to"):
        if key not in value:
            errors.append(f"{segment_path}.{key}: is required")
            continue
        _validate_segment_slot(
            value[key],
            f"{segment_path}.{key}",
            errors,
            available,
            y_mode,
            option_keys,
        )
    if "horizontal" in value and not isinstance(value["horizontal"], bool):
        errors.append(
            f"{segment_path}.horizontal: must be true or false"
        )


def _scan_literal_for_slots(
    value: Any,
    path: str,
    errors: list[str],
    depth: int = 0,
) -> None:
    """Reject slot-looking strings inside literal arrays/objects."""
    if depth > _MAX_WALK_DEPTH:
        errors.append("manifest is nested too deeply")
        return
    if isinstance(value, str):
        if value.startswith("$"):
            errors.append(
                f"{path}: slots inside literal arrays are not supported; use a "
                f"single slot string"
            )
        return
    if isinstance(value, list):
        for index, item in enumerate(value):
            _scan_literal_for_slots(item, f"{path}[{index}]", errors, depth + 1)
        return
    if isinstance(value, dict):
        for key, item in value.items():
            _scan_literal_for_slots(item, f"{path}.{key}", errors, depth + 1)


def _contains_slot(value: Any, slot: str) -> bool:
    """Iteratively search a JSON-shaped value for an exact slot string."""
    stack = [value]
    seen = 0
    while stack:
        item = stack.pop()
        if isinstance(item, str):
            if item == slot:
                return True
        elif isinstance(item, list):
            stack.extend(item)
        elif isinstance(item, dict):
            stack.extend(item.values())
        seen += 1
        if seen > 10_000:
            return False
    return False


def _split_uses_color_slot(item: dict) -> bool:
    """True when a split trace also plots the colour slot (data or array)."""
    if any(_contains_slot(item.get(key), "$color") for key in DATA_KEYS):
        return True
    if _contains_slot(item.get("segments"), "$color"):
        return True
    return any(
        _contains_slot(value, "$color.values")
        for key, value in item.items()
        if key != "splitBy"
    )


def _validate_style_slot(
    value: str,
    path: str,
    errors: list[str],
    available: set[str],
    y_mode: str | None,
    option_keys: set[str],
    *,
    allow_label: bool,
    allow_values: bool = False,
) -> None:
    if value.startswith("$opt."):
        key = value[len("$opt."):]
        if key not in option_keys:
            errors.append(
                f"{path}: option slot {value!r} refers to unknown option {key!r}"
            )
        return
    if ".label" in value:
        if not allow_label:
            errors.append(
                f"{path}: label slots like {value!r} are only allowed in name "
                f"or text"
            )
            return
        _validate_label_slot(value, path, errors, available, y_mode)
        return
    if value.endswith(".values"):
        if not allow_values:
            errors.append(
                f"{path}: {value!r} is only allowed at {_ARRAY_SLOT_ALLOWED}"
            )
            return
        name = value[1:-len(".values")]
        if not name:
            errors.append(f"{path}: {value!r} does not name a data slot")
            return
        _validate_data_slot(
            f"${name}", path, errors, available, y_mode, option_keys
        )
        return
    errors.append(
        f"{path}: data slots like {value!r} are only allowed on x, y, z, "
        f"labels, values; style positions accept $opt.<key> or literals"
    )


def _validate_style_leaf(
    value: Any,
    path: str,
    errors: list[str],
    available: set[str],
    y_mode: str | None,
    option_keys: set[str],
    *,
    allow_values: bool = False,
) -> None:
    if isinstance(value, str):
        if value.startswith("$"):
            _validate_style_slot(
                value, path, errors, available, y_mode, option_keys,
                allow_label=False, allow_values=allow_values,
            )
        return
    if isinstance(value, list):
        _scan_style_list(value, path, errors, available, y_mode, option_keys)
        return
    if isinstance(value, dict):
        errors.append(f"{path}: must be a scalar or list")
        return
    # numbers, booleans, null are literal style values


def _scan_style_list(
    value: list,
    path: str,
    errors: list[str],
    available: set[str],
    y_mode: str | None,
    option_keys: set[str],
    depth: int = 0,
) -> None:
    if depth > _MAX_WALK_DEPTH:
        errors.append("manifest is nested too deeply")
        return
    for index, item in enumerate(value):
        item_path = f"{path}[{index}]"
        if isinstance(item, str):
            if item.startswith("$"):
                _validate_style_slot(
                    item, item_path, errors, available, y_mode, option_keys,
                    allow_label=False,
                )
        elif isinstance(item, list):
            _scan_style_list(
                item, item_path, errors, available, y_mode, option_keys,
                depth + 1,
            )
        elif isinstance(item, dict):
            _scan_literal_for_slots(item, item_path, errors, depth + 1)


def _validate_nested_style(
    kind: str,
    value: dict,
    path: str,
    errors: list[str],
    available: set[str],
    y_mode: str | None,
    option_keys: set[str],
) -> None:
    allowed = _NESTED_STYLE_KEYS[kind]
    for key, item in value.items():
        item_path = f"{path}.{key}"
        if key not in allowed:
            errors.append(
                f"{item_path}: unsupported style key for {kind}"
            )
            continue
        if kind in ("marker", "node", "link") and key == "line":
            if not isinstance(item, dict):
                errors.append(f"{item_path}: must be an object")
            else:
                _validate_nested_style(
                    "line", item, item_path, errors, available, y_mode, option_keys
                )
            continue
        _validate_style_leaf(
            item,
            item_path,
            errors,
            available,
            y_mode,
            option_keys,
            allow_values=f"{kind}.{key}" in _ARRAY_SLOT_PATHS,
        )


def _validate_style_value(
    key: str,
    value: Any,
    path: str,
    errors: list[str],
    available: set[str],
    y_mode: str | None,
    option_keys: set[str],
) -> None:
    if key in _NESTED_STYLE_KEYS:
        if not isinstance(value, dict):
            errors.append(f"{path}: must be an object")
            return
        _validate_nested_style(
            key, value, path, errors, available, y_mode, option_keys
        )
        return
    allow_label = key in ("name", "text")
    if isinstance(value, str):
        if value.startswith("$"):
            _validate_style_slot(
                value, path, errors, available, y_mode, option_keys,
                allow_label=allow_label,
            )
        return
    if isinstance(value, dict):
        errors.append(f"{path}: must be a scalar, list or $opt.<key> slot")
        return
    if isinstance(value, list):
        _scan_style_list(value, path, errors, available, y_mode, option_keys)
        return
    # scalar literal


def _check_object(
    value: Any,
    path: str,
    errors: list[str],
    allowed: frozenset[str],
    kind: str,
) -> bool:
    if not isinstance(value, dict):
        errors.append(f"{path}: must be an object")
        return False
    for key in sorted(set(value) - allowed, key=str):
        errors.append(f"{path}.{key}: not allowed in {kind}")
    return True


def _validate_indicator_scalar(
    value: Any,
    path: str,
    errors: list[str],
    option_keys: set[str],
) -> None:
    # Indicator scalar leaves allow literals and $opt scalars only; reuse the
    # style walker so data/label slots get the established messages.
    if isinstance(value, (dict, list)):
        errors.append(f"{path}: must be a scalar")
        return
    if isinstance(value, str) and value.startswith("$"):
        rest = value[1:]
        if not value.startswith("$opt."):
            first = rest[:1]
            if not first or not (first.islower() or first == "_"):
                # A literal currency-like prefix/suffix ("$", "$1,000",
                # "$USD") is text, not a slot.
                return
    _validate_style_leaf(value, path, errors, set(), None, option_keys)


def _validate_indicator_scalar_list(
    value: Any,
    path: str,
    errors: list[str],
    option_keys: set[str],
) -> None:
    if not isinstance(value, list):
        errors.append(f"{path}: must be a list")
        return
    for index, item in enumerate(value):
        _validate_indicator_scalar(
            item, f"{path}[{index}]", errors, option_keys
        )


def _validate_indicator_scalar_or_list(
    value: Any,
    path: str,
    errors: list[str],
    option_keys: set[str],
) -> None:
    if isinstance(value, list):
        _validate_indicator_scalar_list(value, path, errors, option_keys)
        return
    _validate_indicator_scalar(value, path, errors, option_keys)


def _validate_indicator_font(
    value: Any,
    path: str,
    errors: list[str],
    option_keys: set[str],
) -> None:
    if not _check_object(value, path, errors, _FONT_KEYS, "font"):
        return
    for key, item in value.items():
        _validate_indicator_scalar(
            item, f"{path}.{key}", errors, option_keys
        )


def _validate_indicator_delta_marker(
    value: Any,
    path: str,
    errors: list[str],
    option_keys: set[str],
) -> None:
    if not _check_object(
        value, path, errors, _DELTA_MARKER_KEYS, "delta marker"
    ):
        return
    for key, item in value.items():
        _validate_indicator_scalar(
            item, f"{path}.{key}", errors, option_keys
        )


def _validate_indicator_range(
    value: Any,
    path: str,
    errors: list[str],
    option_keys: set[str],
) -> None:
    if not isinstance(value, list) or len(value) != 2:
        errors.append(f"{path}: must contain exactly two values")
        return
    _validate_indicator_scalar_list(value, path, errors, option_keys)


def _validate_indicator_axis(
    value: Any,
    path: str,
    errors: list[str],
    option_keys: set[str],
) -> None:
    if not _check_object(value, path, errors, _GAUGE_AXIS_KEYS, "gauge.axis"):
        return
    if "range" in value:
        _validate_indicator_range(
            value["range"], f"{path}.range", errors, option_keys
        )
    for key in ("tickvals", "ticktext"):
        if key in value:
            item = value[key]
            if not isinstance(item, list):
                errors.append(f"{path}.{key}: must be a list")
            else:
                _validate_indicator_scalar_list(
                    item, f"{path}.{key}", errors, option_keys
                )
    for key in ("tickformat", "visible"):
        if key in value:
            _validate_indicator_scalar(
                value[key], f"{path}.{key}", errors, option_keys
            )


def _validate_indicator_bar(
    value: Any,
    path: str,
    errors: list[str],
    option_keys: set[str],
) -> None:
    if not _check_object(value, path, errors, _GAUGE_BAR_KEYS, "gauge.bar"):
        return
    for key, item in value.items():
        _validate_indicator_scalar(
            item, f"{path}.{key}", errors, option_keys
        )


def _validate_indicator_steps(
    value: Any,
    path: str,
    errors: list[str],
    option_keys: set[str],
) -> None:
    if not isinstance(value, list):
        errors.append(f"{path}: must be a list")
        return
    if len(value) > 10:
        errors.append(f"{path}: at most 10 steps are allowed")
    for index, item in enumerate(value):
        item_path = f"{path}[{index}]"
        if not _check_object(
            item, item_path, errors, _GAUGE_STEP_KEYS, "a gauge step"
        ):
            continue
        if "range" not in item:
            errors.append(f"{item_path}.range: is required")
        else:
            _validate_indicator_range(
                item["range"], f"{item_path}.range", errors, option_keys
            )
        if "color" in item:
            _validate_indicator_scalar_or_list(
                item["color"], f"{item_path}.color", errors, option_keys
            )


def _validate_indicator_title(
    value: Any,
    path: str,
    errors: list[str],
    option_keys: set[str],
) -> None:
    if not _check_object(value, path, errors, _INDICATOR_TITLE_KEYS, "title"):
        return
    if "text" in value:
        _validate_indicator_scalar(
            value["text"], f"{path}.text", errors, option_keys
        )
    if "font" in value:
        _validate_indicator_font(
            value["font"], f"{path}.font", errors, option_keys
        )


def _validate_indicator_number(
    value: Any,
    path: str,
    errors: list[str],
    option_keys: set[str],
) -> None:
    if not _check_object(value, path, errors, _INDICATOR_NUMBER_KEYS, "number"):
        return
    for key in ("valueformat", "suffix", "prefix"):
        if key in value:
            _validate_indicator_scalar(
                value[key], f"{path}.{key}", errors, option_keys
            )
    if "font" in value:
        _validate_indicator_font(
            value["font"], f"{path}.font", errors, option_keys
        )


def _validate_indicator_delta(
    value: Any,
    path: str,
    errors: list[str],
    option_keys: set[str],
) -> None:
    if not _check_object(value, path, errors, _INDICATOR_DELTA_KEYS, "delta"):
        return
    for key in ("reference", "relative", "valueformat", "position"):
        if key in value:
            _validate_indicator_scalar(
                value[key], f"{path}.{key}", errors, option_keys
            )
    for key in ("increasing", "decreasing"):
        if key in value:
            _validate_indicator_delta_marker(
                value[key], f"{path}.{key}", errors, option_keys
            )


def _validate_indicator_gauge(
    value: Any,
    path: str,
    errors: list[str],
    option_keys: set[str],
) -> None:
    if not _check_object(value, path, errors, _INDICATOR_GAUGE_KEYS, "gauge"):
        return
    if "axis" in value:
        _validate_indicator_axis(
            value["axis"], f"{path}.axis", errors, option_keys
        )
    if "bar" in value:
        _validate_indicator_bar(
            value["bar"], f"{path}.bar", errors, option_keys
        )
    for key in ("bgcolor", "shape", "thickness"):
        if key in value:
            _validate_indicator_scalar(
                value[key], f"{path}.{key}", errors, option_keys
            )
    if "steps" in value:
        _validate_indicator_steps(
            value["steps"], f"{path}.steps", errors, option_keys
        )


def _validate_indicator_style(
    key: str,
    value: Any,
    path: str,
    errors: list[str],
    option_keys: set[str],
) -> None:
    if key == "title":
        _validate_indicator_title(value, path, errors, option_keys)
    elif key == "number":
        _validate_indicator_number(value, path, errors, option_keys)
    elif key == "delta":
        _validate_indicator_delta(value, path, errors, option_keys)
    elif key == "gauge":
        _validate_indicator_gauge(value, path, errors, option_keys)


def _validate_trace_data_value(
    value: Any,
    path: str,
    errors: list[str],
    available: set[str],
    y_mode: str | None,
    option_keys: set[str],
) -> None:
    if isinstance(value, str) and value.startswith("$"):
        _validate_data_slot(
            value, path, errors, available, y_mode, option_keys
        )
    elif isinstance(value, dict):
        errors.append(
            f"{path}: data values must be a slot string or a JSON literal, "
            f"not an object"
        )
    elif isinstance(value, list):
        _scan_literal_for_slots(value, path, errors)


def _validate_sankey_trace(
    item: dict,
    path: str,
    errors: list[str],
) -> None:
    message = (
        f"{path}: sankey needs source, target and values of equal length"
    )
    keys = ("source", "target", "values")
    if any(key not in item for key in keys):
        errors.append(message)
        return
    lengths: list[int | None] = []
    for key in keys:
        value = item[key]
        if isinstance(value, list):
            lengths.append(len(value))
        elif isinstance(value, str) and value.startswith("$"):
            lengths.append(None)
        else:
            errors.append(message)
            return
    known = [length for length in lengths if length is not None]
    if len(set(known)) > 1:
        errors.append(message)


def _validate_split_trace(
    item: dict,
    path: str,
    errors: list[str],
    declared_channels: set[str],
    available: set[str],
    trace_type: Any,
    facets_by_color: bool,
) -> None:
    if item.get("splitBy") != "$color":
        errors.append(f"{path}.splitBy: only '$color' is supported")
    if facets_by_color:
        errors.append(
            f"{path}.splitBy: not allowed when the manifest facets by '$color'"
        )
    if "color" not in declared_channels:
        errors.append(f"{path}.splitBy: requires a 'color' channel")
    elif "color" not in available:
        errors.append(
            f"{path}.splitBy: the 'color' slot is not available after the "
            f"preceding transforms (group_agg drops ungrouped columns)"
        )
    if trace_type not in SPLIT_TRACE_TYPES:
        errors.append(
            f"{path}.splitBy: not supported on trace type {trace_type!r}"
        )

    if _split_uses_color_slot(item):
        errors.append(
            f"{path}: a split trace cannot also plot the 'color' slot"
        )


def _validate_traces(
    value: Any,
    errors: list[str],
    available: set[str],
    y_mode: str | None,
    option_keys: set[str],
    declared_channels: set[str],
    facets_by_color: bool,
) -> None:
    if value is None:
        errors.append("traces: must contain 1-8 traces")
        return
    if not isinstance(value, list):
        errors.append("traces: must be a list of 1-8 traces")
        return
    if not 1 <= len(value) <= MAX_TRACES:
        errors.append(
            f"traces: must contain 1-{MAX_TRACES} traces (got {len(value)})"
        )

    for index, item in enumerate(value):
        path = f"traces[{index}]"
        if not isinstance(item, dict):
            errors.append(f"{path}: must be an object")
            continue
        trace_type = item.get("type")
        if not isinstance(trace_type, str) or trace_type not in TRACE_TYPES:
            errors.append(
                f"{path}.type: unsupported trace type {trace_type!r} (allowed: "
                f"{', '.join(TRACE_TYPES)})"
            )
        if "segments" in item:
            for conflict in ("x", "y"):
                if conflict in item:
                    errors.append(
                        f"{path}: 'segments' and {conflict!r} are mutually "
                        f"exclusive"
                    )
            _validate_segments(
                item["segments"],
                path,
                errors,
                available,
                y_mode,
                option_keys,
                trace_type,
                item.get("mode"),
            )
        if "splitBy" in item:
            _validate_split_trace(
                item,
                path,
                errors,
                declared_channels,
                available,
                trace_type,
                facets_by_color,
            )
        if trace_type == "sankey":
            _validate_sankey_trace(item, path, errors)
        for key, item_value in item.items():
            if key in ("type", "segments", "splitBy"):
                continue
            if key in INDICATOR_STYLE_KEYS:
                if trace_type != "indicator":
                    errors.append(
                        f"{path}.{key}: only allowed on the 'indicator' "
                        f"trace type"
                    )
                    continue
                _validate_indicator_style(
                    key,
                    item_value,
                    f"{path}.{key}",
                    errors,
                    option_keys,
                )
                continue
            if key in SANKEY_STYLE_KEYS:
                if trace_type != "sankey":
                    errors.append(
                        f"{path}.{key}: only allowed on the 'sankey' "
                        f"trace type"
                    )
                    continue
                _validate_style_value(
                    key,
                    item_value,
                    f"{path}.{key}",
                    errors,
                    available,
                    y_mode,
                    option_keys,
                )
                continue
            if key in INDICATOR_DATA_KEYS:
                if trace_type != "indicator":
                    errors.append(
                        f"{path}.{key}: only allowed on the 'indicator' "
                        f"trace type"
                    )
                    continue
                _validate_trace_data_value(
                    item_value,
                    f"{path}.{key}",
                    errors,
                    available,
                    y_mode,
                    option_keys,
                )
                continue
            if key in SANKEY_DATA_KEYS:
                if trace_type != "sankey":
                    errors.append(
                        f"{path}.{key}: only allowed on the 'sankey' "
                        f"trace type"
                    )
                    continue
                _validate_trace_data_value(
                    item_value,
                    f"{path}.{key}",
                    errors,
                    available,
                    y_mode,
                    option_keys,
                )
                continue
            if key in DATA_KEYS:
                if trace_type == "indicator" and key in (
                    "z", "labels", "values",
                ):
                    errors.append(
                        f"{path}.{key}: not allowed on the 'indicator' "
                        f"trace type"
                    )
                    continue
                _validate_trace_data_value(
                    item_value,
                    f"{path}.{key}",
                    errors,
                    available,
                    y_mode,
                    option_keys,
                )
            elif key in STYLE_KEYS:
                _validate_style_value(
                    key, item_value, f"{path}.{key}", errors, available, y_mode,
                    option_keys,
                )
            else:
                errors.append(
                    f"{path}.{key}: unsupported key; allowed style keys: "
                    f"{', '.join(STYLE_KEYS)}; allowed data keys: "
                    f"{', '.join(DATA_KEYS)}; 'source'/'target' (sankey); "
                    f"'value' (indicator); 'segments'; 'splitBy'"
                )


def _validate_layout_value(
    value: Any,
    path: str,
    errors: list[str],
    option_keys: set[str],
    depth: int = 0,
) -> None:
    if depth > _MAX_WALK_DEPTH:
        errors.append("manifest is nested too deeply")
        return
    if isinstance(value, str):
        if not value.startswith("$"):
            return
        if value.startswith("$opt."):
            key = value[len("$opt."):]
            if key not in option_keys:
                errors.append(
                    f"{path}: option slot {value!r} refers to unknown option "
                    f"{key!r}"
                )
            return
        errors.append(
            f"{path}: layout values may only use $opt.<key> slots; data and "
            f"label slots are not available in layout"
        )
        return
    if isinstance(value, dict):
        for key, item in value.items():
            _validate_layout_value(
                item, f"{path}.{key}", errors, option_keys, depth + 1
            )
        return
    if isinstance(value, list):
        for index, item in enumerate(value):
            _validate_layout_value(
                item, f"{path}[{index}]", errors, option_keys, depth + 1
            )


def _validate_layout(value: Any, errors: list[str], option_keys: set[str]) -> None:
    if value is None:
        return
    if not isinstance(value, dict):
        errors.append("layout: must be an object")
        return
    for key in value:
        if key not in LAYOUT_KEYS:
            errors.append(
                f"layout.{key}: is not an allowed layout key (allowed: "
                f"{', '.join(LAYOUT_KEYS)})"
            )
    for key, item in value.items():
        _validate_layout_value(item, f"layout.{key}", errors, option_keys)


def _validate_payload_data(data: Any, claimed: list[tuple[str, str]]) -> list[str]:
    """Run every validation rule and return all errors (never raise)."""
    errors: list[str] = []
    if not isinstance(data, dict):
        return ["manifest must be a JSON object"]

    for key in sorted(set(data) - TOP_LEVEL_KEYS, key=str):
        errors.append(f"{key}: unknown top-level key")

    schema_version = data.get("schemaVersion", _MISSING)
    if (
        not isinstance(schema_version, int)
        or isinstance(schema_version, bool)
        or schema_version != 1
    ):
        errors.append("schemaVersion: must be 1")

    chart_id = data.get("id")
    if not isinstance(chart_id, str) or not _ID_RE.fullmatch(chart_id):
        errors.append(
            f"id: must match {_ID_PATTERN} (2-40 characters, lowercase letter "
            f"first)"
        )
    elif chart_registry.is_known_chart_type(chart_id):
        errors.append(
            f"id {chart_id!r}: collides with a built-in chart type"
        )
    elif chart_id in _WINDOWS_RESERVED_STEMS:
        errors.append(f"id: {chart_id!r} is a reserved name on Windows")

    _localized(data.get("label"), "label", errors, 60)
    description = data.get("description")
    if description is not None:
        _localized(description, "description", errors, 200)

    _validate_keywords(data.get("keywords"), errors, claimed)
    option_keys = _validate_options(data.get("options"), errors)
    channels_raw = data.get("channels")
    declared_channels = (
        set(channels_raw) if isinstance(channels_raw, dict) else set()
    )
    available, y_mode = _validate_channels(channels_raw, errors)
    available = _SlotSet(
        available, declared_channels=declared_channels
    )

    facet_by = data.get("facetBy", _MISSING)
    facet_present = facet_by is not _MISSING and facet_by is not None
    facets_by_color = isinstance(facet_by, str) and facet_by == "$color"
    if facet_present:
        if not facets_by_color:
            errors.append("manifest: 'facetBy' is only '$color'")
        if "color" not in declared_channels:
            errors.append("manifest: 'facetBy' requires a 'color' channel")
        if "facet" in declared_channels:
            errors.append(
                "manifest: 'facetBy' and a 'facet' channel are mutually "
                "exclusive"
            )

    has_facet = "facet" in declared_channels or facet_present
    _validate_transforms(
        data.get("transforms"), errors, available, has_facet
    )
    _validate_traces(
        data.get("traces"),
        errors,
        available,
        y_mode,
        option_keys,
        declared_channels,
        facets_by_color,
    )
    _validate_layout(data.get("layout"), errors, option_keys)
    return errors


def _build_manifest(data: dict) -> CustomChartManifest:
    """Construct the model from a payload that already passed validation."""
    channels_raw = data.get("channels") or {}
    channel_kwargs: dict[str, Any] = {}
    for name in CHANNEL_KEYS:
        spec = channels_raw.get(name)
        if spec is None:
            continue
        channel_kwargs[name] = ChannelSpec(
            required=spec.get("required", True),
            types=list(spec.get("types") or []),
        )
    y_fields = channels_raw.get("yFields")
    if y_fields is not None:
        channel_kwargs["y_fields"] = YFieldsSpec(mode=y_fields["mode"])

    description = data.get("description")
    options = [
        CustomChartOption(
            key=item["key"],
            type=item["type"],
            default=item["default"],
            choices=item.get("choices"),
            label=LocalizedText(**item["label"]),
        )
        for item in (data.get("options") or [])
    ]
    return CustomChartManifest(
        schema_version=1,
        id=data["id"],
        label=LocalizedText(**data["label"]),
        description=LocalizedText(**description) if description is not None else None,
        facet_by=data.get("facetBy"),
        channels=CustomChannels(**channel_kwargs),
        transforms=copy.deepcopy(data.get("transforms") or []),
        traces=copy.deepcopy(data.get("traces") or []),
        layout=copy.deepcopy(data.get("layout") or {}),
        options=options,
        keywords=[item.strip().lower() for item in (data.get("keywords") or [])],
    )


def _claimed_keywords(exclude_id: str | None = None) -> list[tuple[str, str]]:
    """Built-in keywords plus keywords of every currently valid custom chart."""
    claimed = list(chart_registry.type_keywords())
    for manifest in manifest_map().values():
        if exclude_id is not None and manifest.id == exclude_id:
            continue
        for keyword in manifest.keywords:
            claimed.append((keyword.lower(), manifest.id))
    return claimed


def validate_payload(data: dict) -> CustomChartManifest:
    """Validate a manifest payload, collecting *all* errors.

    Raises ``ValueError("; ".join(errors))`` when anything is wrong. The
    message is user-facing and each error starts with a JSON path such as
    ``traces[1].y:``.
    """
    if not isinstance(data, dict):
        raise ValueError("manifest must be a JSON object")
    raw_id = data.get("id")
    exclude_id = raw_id if isinstance(raw_id, str) else None
    try:
        claimed = _claimed_keywords(exclude_id)
        errors = _validate_payload_data(data, claimed)
    except RecursionError:
        raise ValueError("manifest is nested too deeply") from None
    if errors:
        raise ValueError("; ".join(errors))
    try:
        return _build_manifest(data)
    except RecursionError:
        raise ValueError("manifest is nested too deeply") from None


# ---------------------------------------------------------------------------
# Storage
# ---------------------------------------------------------------------------

def _is_safe_id(chart_id: Any) -> bool:
    return isinstance(chart_id, str) and _ID_RE.fullmatch(chart_id) is not None


def _invalidate_cache() -> None:
    global _CACHE, _CACHE_SIG
    _CACHE = None
    _CACHE_SIG = None


def _directory_signature() -> tuple:
    """Cheap fingerprint of every manifest file (name, mtime, size)."""
    try:
        paths = sorted(CHART_DIR.glob("*.json"))
    except OSError:
        return (str(CHART_DIR), ())
    entries: list[tuple[str, int | None, int | None]] = []
    for path in paths:
        try:
            file_stat = path.stat()
        except OSError:
            entries.append((path.name, None, None))
            continue
        entries.append((path.name, file_stat.st_mtime_ns, file_stat.st_size))
    return (str(CHART_DIR), tuple(entries))


def _read_manifest_file(path: Path) -> tuple[dict | None, list[str]]:
    """Read one file safely; return (data, errors)."""
    try:
        file_stat = path.stat()
    except OSError as exc:
        return None, [f"cannot read file: {exc}"]
    if not stat.S_ISREG(file_stat.st_mode):
        return None, ["not a regular file"]
    try:
        resolved = path.resolve()
        chart_root = CHART_DIR.resolve()
        resolved.relative_to(chart_root)
    except ValueError:
        return None, ["not a regular file"]
    except (OSError, RuntimeError) as exc:
        return None, [f"cannot read file: {exc}"]
    if file_stat.st_size > MAX_MANIFEST_BYTES:
        return None, [f"file is larger than {MAX_MANIFEST_BYTES // 1024} KB"]
    try:
        text = path.read_text(encoding="utf-8")
    except RecursionError:
        return None, ["manifest is nested too deeply"]
    except (OSError, UnicodeDecodeError) as exc:
        return None, [f"cannot read file: {exc}"]
    try:
        data = json.loads(text.lstrip("\ufeff"))
    except RecursionError:
        return None, ["manifest is nested too deeply"]
    except json.JSONDecodeError as exc:
        return None, [f"invalid JSON: {exc.msg} at line {exc.lineno} column {exc.colno}"]
    if not isinstance(data, dict):
        return None, ["manifest must be a JSON object"]
    return data, []


def _list_manifests() -> tuple[list[CustomChartManifest], list[dict]]:
    valid: list[CustomChartManifest] = []
    invalid: list[dict] = []
    claimed = list(chart_registry.type_keywords())

    try:
        paths = sorted(CHART_DIR.glob("*.json"))
    except OSError:
        paths = []

    for path in paths:
        try:
            data, file_errors = _read_manifest_file(path)
        except RecursionError:
            invalid.append(
                {
                    "id": path.stem,
                    "file": path.name,
                    "errors": ["manifest is nested too deeply"],
                }
            )
            continue
        if file_errors:
            invalid.append(
                {"id": path.stem, "file": path.name, "errors": file_errors}
            )
            continue
        assert data is not None
        manifest_id = data.get("id")
        try:
            errors = _validate_payload_data(data, claimed)
            if isinstance(manifest_id, str) and manifest_id != path.stem:
                errors.append(
                    f"id {manifest_id!r}: does not match the file name "
                    f"{path.name!r}"
                )
            if errors:
                entry_id = (
                    manifest_id
                    if isinstance(manifest_id, str) and manifest_id
                    else path.stem
                )
                invalid.append(
                    {"id": entry_id, "file": path.name, "errors": errors}
                )
                continue
            manifest = _build_manifest(data)
        except RecursionError:
            entry_id = (
                manifest_id
                if isinstance(manifest_id, str) and manifest_id
                else path.stem
            )
            invalid.append(
                {
                    "id": entry_id,
                    "file": path.name,
                    "errors": ["manifest is nested too deeply"],
                }
            )
            continue
        valid.append(manifest)
        for keyword in manifest.keywords:
            claimed.append((keyword, manifest.id))
    return valid, invalid


def list_manifests() -> tuple[list[CustomChartManifest], list[dict]]:
    """Return ``(valid, invalid)``.

    Invalid entries are ``{"id": str, "file": str, "errors": [str]}``. Corrupt
    or oversized files never raise; they become invalid entries. Files are
    processed in filename order so a duplicate keyword is deterministically
    claimed by the first manifest.
    """
    return _list_manifests()


def _copy_manifest_map(
    source: dict[str, CustomChartManifest],
) -> dict[str, CustomChartManifest]:
    """Deep-copy cached models so callers cannot poison the process cache."""
    return {
        chart_id: manifest.model_copy(deep=True)
        for chart_id, manifest in source.items()
    }


def manifest_map() -> dict[str, CustomChartManifest]:
    """Valid manifests by id, cached until a file's mtime/size changes."""
    global _CACHE, _CACHE_SIG
    signature = _directory_signature()
    if _CACHE is not None and _CACHE_SIG == signature:
        return _copy_manifest_map(_CACHE)
    try:
        valid, _ = _list_manifests()
    except RecursionError:
        # Per-file validation catches this already; this is the last line of
        # defence so one pathological file can never 500 the whole list.
        _LOG.debug("custom chart scan hit the recursion limit", exc_info=True)
        if _CACHE is not None:
            return _copy_manifest_map(_CACHE)
        return {}
    _CACHE = {manifest.id: manifest for manifest in valid}
    _CACHE_SIG = signature
    return _copy_manifest_map(_CACHE)


def load_manifest(chart_id: str) -> CustomChartManifest | None:
    """Return a valid custom manifest, or ``None`` for unknown/invalid ids."""
    if not _is_safe_id(chart_id):
        return None
    return manifest_map().get(chart_id)


def is_custom_id(chart_id: str) -> bool:
    """True when ``chart_id`` is a valid id with a valid manifest on disk."""
    if not _is_safe_id(chart_id):
        return False
    return chart_id in manifest_map()


def save_manifest(data: dict) -> tuple[CustomChartManifest, bool]:
    """Validate and write ``CHART_DIR/{id}.json``; return (manifest, replaced)."""
    manifest = validate_payload(data)
    try:
        CHART_DIR.mkdir(parents=True, exist_ok=True)
    except OSError as exc:
        raise ValueError(f"cannot write manifest: {exc}") from exc
    path = CHART_DIR / f"{manifest.id}.json"
    replaced = path.exists()

    payload = _json_safe(manifest.model_dump(by_alias=True, exclude_none=True))
    text = json.dumps(payload, ensure_ascii=False, indent=2) + "\n"
    encoded = text.encode("utf-8")
    if len(encoded) > MAX_MANIFEST_BYTES:
        raise ValueError(
            f"manifest is larger than {MAX_MANIFEST_BYTES // 1024} KB"
        )

    # Unique temp name: concurrent saves of the same id must not clobber each
    # other's temporary file before os.replace makes the write atomic.
    temporary = CHART_DIR / f"{manifest.id}.{uuid.uuid4().hex}.tmp"
    try:
        temporary.write_text(text, encoding="utf-8")
        os.replace(temporary, path)
    except OSError as exc:
        try:
            temporary.unlink()
        except OSError:
            pass
        raise ValueError(f"cannot write manifest: {exc}") from exc
    _invalidate_cache()
    return manifest, replaced


def delete_manifest(chart_id: str) -> bool:
    """Delete ``CHART_DIR/{id}.json``; ``False`` for unsafe/unknown ids."""
    if not _is_safe_id(chart_id):
        return False
    path = CHART_DIR / f"{chart_id}.json"
    try:
        path.unlink()
    except FileNotFoundError:
        return False
    except OSError:
        return False
    _invalidate_cache()
    return True


def keywords() -> tuple[tuple[str, str], ...]:
    """``(lowercased keyword, custom id)`` pairs for valid custom charts.

    Sorted longest-first (then alphabetically) to match
    :func:`backend.core.chart_registry.type_keywords`, so callers can simply
    concatenate both tuples before running positional keyword detection.
    """
    pairs = [
        (keyword.lower(), manifest.id)
        for manifest in manifest_map().values()
        for keyword in manifest.keywords
    ]
    pairs.sort(key=lambda pair: (-len(pair[0]), pair[0], pair[1]))
    return tuple(pairs)


# ---------------------------------------------------------------------------
# Introspection
# ---------------------------------------------------------------------------

def channel_requirements(manifest: CustomChartManifest) -> dict[str, object]:
    """UI-facing channel requirements.

    ``{"x": {"required": True, "types": [...]}, ..., "yFields": "range"}``.
    ``types: []`` means "any type". ``yFields`` is always present; ``"none"``
    means the chart does not use y fields.
    """
    result: dict[str, object] = {}
    channels = manifest.channels
    for name in CHANNEL_KEYS:
        spec = _obj_get(channels, name)
        if spec is not None:
            result[name] = {
                "required": bool(_obj_get(spec, "required", True)),
                "types": list(_obj_get(spec, "types", []) or []),
            }
    y_fields = _obj_get(channels, "y_fields")
    if y_fields is None:
        y_fields = _obj_get(channels, "yFields")
    result["yFields"] = _obj_get(y_fields, "mode", "none")
    return result


def is_samplable(manifest: CustomChartManifest) -> bool:
    """False for row-changing transforms or any indicator trace."""
    for transform in (manifest.transforms or []):
        if isinstance(transform, dict) and transform.get("op") in {
            "group_agg", "cumulate", "limit", "reduce",
        }:
            return False
    for trace in (manifest.traces or []):
        if isinstance(trace, dict) and trace.get("type") == "indicator":
            return False
    return True


# ---------------------------------------------------------------------------
# Rendering
# ---------------------------------------------------------------------------

class _RenderError(Exception):
    """Internal signal: the current configuration cannot be rendered."""


class _RenderConfigError(ValueError):
    """Structural config error surfaced to the API as a 400, not swallowed."""


def _json_safe(value: Any) -> Any:
    """Convert pandas/numpy values to JSON-safe Python values (NaN -> None)."""
    if value is None:
        return None
    if isinstance(value, bool):
        return value
    if isinstance(value, str):
        return value
    if isinstance(value, int):
        return value
    if isinstance(value, float):
        numeric = float(value)
        return numeric if math.isfinite(numeric) else None
    if isinstance(value, (pd.Timestamp, datetime, date)):
        try:
            if pd.isna(value):
                return None
        except (TypeError, ValueError):
            pass
        return value.isoformat()
    if isinstance(value, (pd.Timedelta, timedelta)):
        try:
            if pd.isna(value):
                return None
        except (TypeError, ValueError):
            pass
        return value.total_seconds()
    if isinstance(value, Decimal):
        numeric = float(value)
        return numeric if math.isfinite(numeric) else None
    if hasattr(value, "item"):
        try:
            return _json_safe(value.item())
        except (TypeError, ValueError):
            pass
    if isinstance(value, dict):
        return {str(key): _json_safe(item) for key, item in value.items()}
    if isinstance(value, (list, tuple, set)):
        return [_json_safe(item) for item in value]
    try:
        if pd.isna(value):
            return None
    except (TypeError, ValueError):
        pass
    if hasattr(value, "isoformat"):
        try:
            return value.isoformat()
        except (TypeError, ValueError):
            pass
    return str(value)


def _series_to_list(series: Any) -> list:
    if isinstance(series, pd.Series):
        values = series.tolist()
    else:
        values = list(series)
    return [_json_safe(value) for value in values]


def _is_missing_value(value: Any) -> bool:
    if value is None:
        return True
    try:
        return bool(pd.isna(value))
    except (TypeError, ValueError):
        return False


def _split_value_label(value: Any) -> str:
    if _is_missing_value(value):
        return "None"
    if isinstance(value, (pd.Timestamp, datetime, date)):
        return value.isoformat()
    # pandas returns numpy.datetime64 scalars from pd.unique(datetime64).
    if (
        hasattr(value, "dtype")
        and pd.api.types.is_datetime64_any_dtype(value.dtype)
    ):
        try:
            return pd.Timestamp(value).isoformat()
        except (TypeError, ValueError):
            return str(value)
    return str(value)


def _facet_axis_copy(value: Any) -> dict:
    """Copy axis styling while dropping keys owned by the facet grid."""
    if not isinstance(value, dict):
        return {}
    return {
        key: item
        for key, item in value.items()
        if key not in _FACET_AXIS_STRIP_KEYS
    }


def _facet_axis_title(base_title: Any, label: str) -> Any:
    """Keep axis-title font/styling while replacing its text with the cell."""
    if isinstance(base_title, dict):
        title = dict(base_title)
        title["text"] = label
        return title
    return label


def _is_array_style_value(value: Any) -> bool:
    """True for a literal list or a ``$slot.values`` array style slot."""
    if isinstance(value, list):
        return True
    return (
        isinstance(value, str)
        and value.startswith("$")
        and value.endswith(".values")
    )


def _ensure_no_slots(value: Any) -> None:
    """Raise if a literal still contains an unresolved ``$`` slot string."""
    if isinstance(value, str):
        if value.startswith("$"):
            raise _RenderError(f"unresolved slot {value!r}")
        return
    if isinstance(value, list):
        for item in value:
            _ensure_no_slots(item)
        return
    if isinstance(value, dict):
        for item in value.values():
            _ensure_no_slots(item)


def _obj_get(obj: Any, name: str, default: Any = None) -> Any:
    """Read ``name`` from a dict or an attribute-style object."""
    if obj is None:
        return default
    if isinstance(obj, dict):
        return obj.get(name, default)
    return getattr(obj, name, default)


def _encoding_get(encoding: Any, snake: str, camel: str | None = None) -> Any:
    if isinstance(encoding, dict):
        if snake in encoding:
            return encoding[snake]
        if camel is not None:
            return encoding.get(camel)
        return None
    return getattr(encoding, snake, None)


def _field_of(channel: Any) -> str | None:
    value = _obj_get(channel, "field")
    return value if isinstance(value, str) and value else None


def _type_of(channel: Any) -> str | None:
    value = _obj_get(channel, "type")
    return value if isinstance(value, str) and value else None


def _label_of(channel: Any) -> str | None:
    value = _obj_get(channel, "label")
    return value if isinstance(value, str) and value else None


def _coerce_option_value(option: Any, value: Any) -> Any:
    """Return a value matching the option's declared type, or ``_OPTION_INVALID``."""
    option_type = _obj_get(option, "type")
    if option_type == "number":
        if isinstance(value, bool):
            return _OPTION_INVALID
        if isinstance(value, (int, float)):
            numeric = value
        elif isinstance(value, str):
            try:
                numeric = float(value)
            except (TypeError, ValueError, OverflowError):
                return _OPTION_INVALID
        else:
            return _OPTION_INVALID
        try:
            numeric = float(numeric)
        except (TypeError, ValueError, OverflowError):
            return _OPTION_INVALID
        if not math.isfinite(numeric):
            return _OPTION_INVALID
        return int(numeric) if numeric.is_integer() else numeric
    if option_type == "boolean":
        return value if isinstance(value, bool) else _OPTION_INVALID
    if option_type == "select":
        choices = _obj_get(option, "choices") or []
        if isinstance(value, str) and value in choices:
            return value
        return _OPTION_INVALID
    if option_type == "text":
        return value if isinstance(value, str) else _OPTION_INVALID
    return _OPTION_INVALID


class _OptionResolver:
    """Resolve ``$opt.<key>`` from encoding overrides, then manifest defaults."""

    def __init__(self, manifest: CustomChartManifest, encoding: Any):
        self.options = {
            _obj_get(option, "key"): option
            for option in (manifest.options or [])
            if _obj_get(option, "key")
        }
        self.encoding_options = _obj_get(encoding, "options")

    def _raw_override(self, key: str) -> Any:
        options = self.encoding_options
        if isinstance(options, dict):
            return options[key] if key in options else _MISSING
        if options is None:
            return _MISSING
        extra = getattr(options, "model_extra", None)
        if isinstance(extra, dict) and key in extra:
            return extra[key]
        return getattr(options, key, _MISSING)

    def get(self, key: str) -> Any:
        option = self.options.get(key)
        if option is None:
            raise _RenderError(f"unknown option {key!r}")
        default = _json_safe(_obj_get(option, "default"))
        raw = self._raw_override(key)
        if raw is _MISSING or raw is None:
            return default
        coerced = _coerce_option_value(option, raw)
        if coerced is _OPTION_INVALID:
            return default
        return _json_safe(coerced)


def _resolve_indicator_scalar_value(
    value: Any,
    resolver: _OptionResolver,
) -> Any:
    if isinstance(value, (dict, list)):
        return _MISSING
    if isinstance(value, str):
        if value.startswith("$opt."):
            return resolver.get(value[len("$opt."):])
        if value.startswith("$"):
            first = value[1:2]
            if first and (first.islower() or first == "_"):
                raise _RenderError(
                    "indicator styles only allow $opt.<key> slots"
                )
            return value
        return value
    return _json_safe(value)


def _resolve_indicator_scalar_list(
    value: Any,
    resolver: _OptionResolver,
) -> Any:
    if not isinstance(value, list):
        return _MISSING
    result = []
    for item in value:
        resolved = _resolve_indicator_scalar_value(item, resolver)
        if resolved is _MISSING:
            return _MISSING
        result.append(resolved)
    return result


def _resolve_indicator_scalar_or_list(
    value: Any,
    resolver: _OptionResolver,
) -> Any:
    if isinstance(value, list):
        return _resolve_indicator_scalar_list(value, resolver)
    return _resolve_indicator_scalar_value(value, resolver)


def _resolve_indicator_range(
    value: Any,
    resolver: _OptionResolver,
) -> Any:
    if not isinstance(value, list) or len(value) != 2:
        return _MISSING
    return _resolve_indicator_scalar_list(value, resolver)


def _resolve_indicator_font(
    value: Any,
    resolver: _OptionResolver,
) -> Any:
    if not isinstance(value, dict):
        return _MISSING
    result = {}
    for key in _FONT_KEYS:
        if key not in value:
            continue
        resolved = _resolve_indicator_scalar_value(value[key], resolver)
        if resolved is not _MISSING:
            result[key] = resolved
    return result


def _resolve_indicator_delta_marker(
    value: Any,
    resolver: _OptionResolver,
) -> Any:
    if not isinstance(value, dict):
        return _MISSING
    result = {}
    for key in _DELTA_MARKER_KEYS:
        if key not in value:
            continue
        resolved = _resolve_indicator_scalar_value(value[key], resolver)
        if resolved is not _MISSING:
            result[key] = resolved
    return result


def _resolve_indicator_axis(
    value: Any,
    resolver: _OptionResolver,
) -> Any:
    if not isinstance(value, dict):
        return _MISSING
    result = {}
    for key in _GAUGE_AXIS_KEYS:
        if key not in value:
            continue
        if key == "range":
            resolved = _resolve_indicator_range(value[key], resolver)
        elif key in ("tickvals", "ticktext"):
            resolved = _resolve_indicator_scalar_list(value[key], resolver)
        else:
            resolved = _resolve_indicator_scalar_value(value[key], resolver)
        if resolved is not _MISSING:
            result[key] = resolved
    return result


def _resolve_indicator_bar(
    value: Any,
    resolver: _OptionResolver,
) -> Any:
    if not isinstance(value, dict):
        return _MISSING
    result = {}
    for key in _GAUGE_BAR_KEYS:
        if key not in value:
            continue
        resolved = _resolve_indicator_scalar_value(value[key], resolver)
        if resolved is not _MISSING:
            result[key] = resolved
    return result


def _resolve_indicator_steps(
    value: Any,
    resolver: _OptionResolver,
) -> Any:
    if not isinstance(value, list):
        return _MISSING
    result = []
    for item in value[:10]:
        if not isinstance(item, dict):
            continue
        step = {}
        if "range" in item:
            resolved_range = _resolve_indicator_range(
                item["range"], resolver
            )
            if resolved_range is not _MISSING:
                step["range"] = resolved_range
        if "range" not in step:
            continue
        if "color" in item:
            resolved_color = _resolve_indicator_scalar_or_list(
                item["color"], resolver
            )
            if resolved_color is not _MISSING:
                step["color"] = resolved_color
        result.append(step)
    return result


def _resolve_indicator_style_value(
    key: str,
    value: Any,
    resolver: _OptionResolver,
) -> dict:
    schema = _INDICATOR_SCHEMA.get(key)
    if schema is None or not isinstance(value, dict):
        return {}
    result = {}
    for object_key, kind in schema.items():
        if object_key not in value:
            continue
        item = value[object_key]
        if kind == "scalar":
            resolved = _resolve_indicator_scalar_value(item, resolver)
        elif kind == "font":
            resolved = _resolve_indicator_font(item, resolver)
        elif kind == "delta_marker":
            resolved = _resolve_indicator_delta_marker(item, resolver)
        elif kind == "axis":
            resolved = _resolve_indicator_axis(item, resolver)
        elif kind == "bar":
            resolved = _resolve_indicator_bar(item, resolver)
        elif kind == "steps":
            resolved = _resolve_indicator_steps(item, resolver)
        else:
            resolved = _MISSING
        if resolved is not _MISSING:
            result[object_key] = resolved
    return result


def _resolve_layout_value(value: Any, resolver: _OptionResolver) -> Any:
    if isinstance(value, str):
        if value.startswith("$opt."):
            return resolver.get(value[len("$opt."):])
        if value.startswith("$"):
            raise _RenderError(f"unsupported layout slot {value!r}")
        return value
    if isinstance(value, dict):
        return {
            key: _resolve_layout_value(item, resolver)
            for key, item in value.items()
        }
    if isinstance(value, list):
        return [_resolve_layout_value(item, resolver) for item in value]
    return _json_safe(value)


def _resolve_layout(
    layout: dict,
    resolver: _OptionResolver,
) -> dict:
    if not isinstance(layout, dict):
        return {}
    return {
        key: _resolve_layout_value(value, resolver)
        for key, value in layout.items()
        if key in LAYOUT_KEYS
    }


class _RenderEnv:
    """Mutable render state: frame copy, slot -> column map, labels."""

    def __init__(
        self,
        df: pd.DataFrame,
        manifest: CustomChartManifest,
        encoding: Any,
        resolver: _OptionResolver,
        palette: list[str] | None = None,
    ):
        self.df = df
        self.manifest = manifest
        self.encoding = encoding
        self.resolver = resolver
        self.work = df
        self.palette = list(palette) if palette else list(_DEFAULT_PALETTE)
        self.slots: dict[str, str] = {}
        self.y_labels: dict[str, str] = {}
        self.y_mode: str | None = None
        self.y_fields: list[Any] = []
        self.facet_field: str | None = None
        self.channels = manifest.channels

    # -- setup ---------------------------------------------------------

    def prepare(self) -> None:
        if not isinstance(self.df, pd.DataFrame):
            raise _RenderError("render expects a DataFrame")
        self.work = self.df.copy()

        self.y_fields = list(
            _encoding_get(self.encoding, "y_fields", "yFields") or []
        )

        for name in CHANNEL_KEYS:
            spec = _obj_get(self.channels, name)
            if spec is None:
                continue
            channel = _encoding_get(self.encoding, name)
            field = _field_of(channel)
            usable = bool(field and field in self.work.columns)
            declared_types = list(_obj_get(spec, "types", []) or [])
            if usable and declared_types and _type_of(channel) not in declared_types:
                usable = False
            if _obj_get(spec, "required", True) and not usable:
                raise _RenderError(f"missing required channel {name!r}")
            if usable and name in _SLOT_CHANNEL_KEYS:
                self.slots[name] = field  # type: ignore[assignment]
            if usable and name == "facet":
                self.facet_field = field  # type: ignore[assignment]

        y_spec = _obj_get(self.channels, "y_fields")
        if y_spec is None:
            y_spec = _obj_get(self.channels, "yFields")
        self.y_mode = _obj_get(y_spec, "mode", "none") if y_spec is not None else "none"
        needed = {"one": 1, "range": 2, "multi": 1}.get(self.y_mode, 0)
        if len(self.y_fields) < needed:
            raise _RenderError("not enough y fields configured")
        limit = {"one": 1, "range": 2, "multi": 5}.get(self.y_mode, 0)
        for index in range(min(limit, len(self.y_fields))):
            channel = self.y_fields[index]
            field = _field_of(channel)
            if not field or field not in self.work.columns:
                raise _RenderError(f"unusable y field {index}")
            slot = f"y{index}"
            self.slots[slot] = field
            self.y_labels[slot] = _label_of(channel) or field

    # -- transforms ----------------------------------------------------

    def _column(self, slot: str) -> str:
        column = self.slots.get(slot)
        if column is None or column not in self.work.columns:
            raise _RenderError(f"unresolved slot {slot!r}")
        return column

    @staticmethod
    def _slot_name(value: Any) -> str:
        if not isinstance(value, str) or not value:
            raise _RenderError("invalid slot name")
        return value[1:] if value.startswith("$") else value

    def apply_transforms(self) -> None:
        for transform_index, transform in enumerate(
            self.manifest.transforms or []
        ):
            if not isinstance(transform, dict):
                raise _RenderError("invalid transform")
            op = transform.get("op")
            if op == "dropna":
                columns: list[str] = []
                for slot in transform.get("slots") or []:
                    column = self._column(self._slot_name(slot))
                    if column not in columns:
                        columns.append(column)
                if not columns:
                    raise _RenderError("dropna needs at least one slot")
                self.work = self.work.dropna(subset=columns)
            elif op == "sort":
                column = self._column(self._slot_name(transform.get("by")))
                self.work = self.work.sort_values(
                    by=column,
                    ascending=transform.get("descending") is not True,
                    kind="stable",
                    na_position="last",
                )
            elif op == "limit":
                count = transform.get("count")
                if not isinstance(count, int) or isinstance(count, bool):
                    raise _RenderError("invalid limit count")
                if transform.get("from", "top") == "bottom":
                    self.work = self.work.tail(count)
                else:
                    self.work = self.work.head(count)
            elif op == "group_agg":
                raw_group = transform.get("groupBy")
                if isinstance(raw_group, list):
                    group_slots = [
                        self._slot_name(item) for item in raw_group
                    ]
                else:
                    group_slots = [self._slot_name(raw_group)]
                group_columns: list[str] = []
                for slot in group_slots:
                    column = self._column(slot)
                    if column not in group_columns:
                        group_columns.append(column)
                field_slot = self._slot_name(transform.get("field"))
                field_column = self._column(field_slot)
                as_name = transform.get("as")
                if (
                    not isinstance(as_name, str)
                    or as_name in group_columns
                ):
                    raise _RenderError("invalid group_agg output name")
                grouped = self.work.groupby(
                    group_columns, dropna=False, sort=False
                )[field_column]
                agg = transform.get("agg")
                if agg == "count":
                    result = grouped.count()
                elif agg in GROUP_AGGS:
                    result = grouped.agg(agg)
                else:
                    raise _RenderError("invalid group_agg function")
                self.work = result.rename(as_name).reset_index()
                next_slots = {
                    name: column
                    for name, column in self.slots.items()
                    if column in group_columns
                }
                next_slots[as_name] = as_name
                self.slots = next_slots
            elif op == "reduce":
                field_column = self._column(
                    self._slot_name(transform.get("field"))
                )
                agg = transform.get("agg")
                as_name = transform.get("as")
                if not isinstance(as_name, str):
                    raise _RenderError("invalid reduce output name")
                series = self.work[field_column]
                if agg == "count":
                    value = series.count()
                elif agg in GROUP_AGGS:
                    if not pd.api.types.is_numeric_dtype(series):
                        raise _RenderConfigError(
                            f"transforms[{transform_index}]: aggregate "
                            f"{agg!r} needs a numeric column"
                        )
                    value = series.agg(agg)
                else:
                    raise _RenderError("invalid reduce function")
                self.work = pd.DataFrame({as_name: [value]})
                self.slots = {as_name: as_name}
            elif op == "cumulate":
                # Deliberate: cumulate is global (before facet/split). Facet
                # cells therefore carry the global running totals; group_agg +
                # facet is rejected, so per-cell grouping is unavailable.
                field_column = self._column(self._slot_name(transform.get("field")))
                as_name = transform.get("as")
                if not isinstance(as_name, str):
                    raise _RenderError("invalid cumulate output name")
                x_column = self.slots.get("x")
                if x_column is not None and x_column in self.work.columns:
                    self.work = self.work.sort_values(
                        by=x_column,
                        ascending=True,
                        kind="stable",
                        na_position="last",
                    )
                numeric = pd.to_numeric(self.work[field_column], errors="raise")
                self.work[as_name] = numeric.cumsum()
                self.slots[as_name] = as_name
            else:
                raise _RenderError(f"unsupported transform {op!r}")

    # -- traces --------------------------------------------------------

    def _resolve_data_slot(self, value: str) -> list:
        name = value[1:]
        if name == "count":
            return [1] * len(self.work)
        if name == "index":
            return list(range(len(self.work)))
        column = self._column(name)
        return _series_to_list(self.work[column])

    def _resolve_data_value(self, value: Any) -> Any:
        if isinstance(value, str):
            if value.startswith("$"):
                return self._resolve_data_slot(value)
            return value
        _ensure_no_slots(value)
        return _json_safe(value)

    def _resolve_segment_slot(self, value: Any) -> list:
        if not isinstance(value, str) or not value.startswith("$"):
            raise _RenderError("segment values must be data slots")
        if value.startswith("$opt.") or ".label" in value:
            raise _RenderError("segment values must be data slots")
        return self._resolve_data_slot(value)

    def _resolve_segments(self, value: Any) -> dict:
        """Turn one row per segment into Plotly's nested-array form."""
        if not isinstance(value, dict):
            raise _RenderError("invalid segments object")
        if set(value) - _SEGMENT_KEYS:
            raise _RenderError("invalid segments key")
        if any(key not in value for key in ("x", "from", "to")):
            raise _RenderError("missing segments key")
        horizontal = value.get("horizontal", False)
        if not isinstance(horizontal, bool):
            raise _RenderError("invalid segments.horizontal")

        x_values = self._resolve_segment_slot(value["x"])
        from_values = self._resolve_segment_slot(value["from"])
        to_values = self._resolve_segment_slot(value["to"])
        if not (
            len(x_values) == len(from_values) == len(to_values)
        ):
            raise _RenderError("segment slots have different lengths")

        x_segments: list[list] = []
        y_segments: list[list] = []
        for x_value, from_value, to_value in zip(
            x_values, from_values, to_values
        ):
            # A segment needs all three coordinates; dropping it here prevents
            # emitting a partial [None, value] line.
            if x_value is None or from_value is None or to_value is None:
                continue
            if horizontal:
                x_segments.append([from_value, to_value])
                y_segments.append([x_value, x_value])
            else:
                x_segments.append([x_value, x_value])
                y_segments.append([from_value, to_value])
        return {"x": x_segments, "y": y_segments}

    def _resolve_label(self, value: str) -> str:
        name = value[1:-len(".label")]
        if name in self.slots:
            if name in self.y_labels:
                return self.y_labels[name]
            return self.slots[name]
        raise _RenderError(f"unresolved label slot {value!r}")

    def _resolve_values_slot(self, name: str, *, numeric: bool) -> list:
        if name == "count":
            return _json_safe([1] * len(self.work))
        if name == "index":
            return _json_safe(list(range(len(self.work))))
        column = self._column(name)
        series = self.work[column]
        if numeric:
            # Pandas happily turns datetime64/timedelta64 into epoch integers;
            # at a numeric style path that is never what the author meant.
            if (
                pd.api.types.is_datetime64_any_dtype(series)
                or pd.api.types.is_timedelta64_dtype(series)
            ):
                return [None] * len(series)
            try:
                converted = pd.to_numeric(series, errors="coerce")
            except (TypeError, ValueError):
                return [None] * len(series)
            if (
                not pd.api.types.is_numeric_dtype(series)
                and not bool(converted.notna().any())
            ):
                return [None] * len(series)
            series = converted
        return _series_to_list(series)

    def _resolve_style_slot(
        self,
        value: str,
        *,
        allow_label: bool,
        allow_values: bool = False,
        numeric_values: bool = False,
    ) -> Any:
        if value.startswith("$opt."):
            return self.resolver.get(value[len("$opt."):])
        if ".label" in value:
            if not allow_label:
                raise _RenderError(f"label slot {value!r} not allowed here")
            return self._resolve_label(value)
        if value.endswith(".values"):
            if not allow_values:
                raise _RenderError(f"array slot {value!r} not allowed here")
            name = value[1:-len(".values")]
            if not name:
                raise _RenderError(f"invalid array slot {value!r}")
            return self._resolve_values_slot(name, numeric=numeric_values)
        raise _RenderError(f"data slot {value!r} not allowed in a style position")

    def _resolve_style_list(self, value: list) -> list:
        result = []
        for item in value:
            if isinstance(item, str) and item.startswith("$"):
                result.append(self._resolve_style_slot(item, allow_label=False))
            elif isinstance(item, list):
                result.append(self._resolve_style_list(item))
            else:
                _ensure_no_slots(item)
                result.append(_json_safe(item))
        return result

    def _resolve_style_leaf(
        self,
        value: Any,
        *,
        allow_values: bool = False,
        numeric_values: bool = False,
    ) -> Any:
        if isinstance(value, str):
            if value.startswith("$"):
                return self._resolve_style_slot(
                    value,
                    allow_label=False,
                    allow_values=allow_values,
                    numeric_values=numeric_values,
                )
            return value
        if isinstance(value, list):
            return self._resolve_style_list(value)
        if isinstance(value, dict):
            _ensure_no_slots(value)
            return _json_safe(value)
        return _json_safe(value)

    def _resolve_nested_style(self, kind: str, value: dict) -> dict:
        allowed = _NESTED_STYLE_KEYS[kind]
        result: dict[str, Any] = {}
        for key, item in value.items():
            if key not in allowed:
                continue
            if kind in ("marker", "node", "link") and key == "line":
                if isinstance(item, dict):
                    result[key] = self._resolve_nested_style("line", item)
                continue
            path = f"{kind}.{key}"
            result[key] = self._resolve_style_leaf(
                item,
                allow_values=path in _ARRAY_SLOT_PATHS,
                numeric_values=path in _NUMERIC_ARRAY_SLOT_PATHS,
            )
        return result

    def _resolve_style_value(self, key: str, value: Any) -> Any:
        if key in _NESTED_STYLE_KEYS:
            if not isinstance(value, dict):
                raise _RenderError(f"style object {key!r} must be an object")
            return self._resolve_nested_style(key, value)
        allow_label = key in ("name", "text")
        if isinstance(value, str):
            if value.startswith("$"):
                return self._resolve_style_slot(value, allow_label=allow_label)
            return value
        if isinstance(value, dict):
            raise _RenderError(f"unsupported style object {key!r}")
        if isinstance(value, list):
            return self._resolve_style_list(value)
        return _json_safe(value)

    def _build_trace_body(
        self,
        raw: dict,
        trace_type: str,
        trace_index: int = 0,
    ) -> dict:
        has_segments = "segments" in raw
        if has_segments:
            if "x" in raw or "y" in raw:
                raise _RenderError("segments and x/y are mutually exclusive")
            if trace_type != "scatter":
                raise _RenderError("segments need a scatter trace")
            mode = raw.get("mode")
            if not isinstance(mode, str) or "lines" not in mode.split("+"):
                raise _RenderError("segments need a lines mode")
        trace: dict[str, Any] = {"type": trace_type}
        for key, value in raw.items():
            if key in ("type", "splitBy"):
                continue
            if key in INDICATOR_STYLE_KEYS:
                if trace_type == "indicator":
                    trace[key] = _resolve_indicator_style_value(
                        key, value, self.resolver
                    )
                continue
            if key in SANKEY_STYLE_KEYS:
                if trace_type == "sankey":
                    trace[key] = self._resolve_style_value(key, value)
                continue
            if key in INDICATOR_DATA_KEYS:
                if trace_type == "indicator":
                    trace[key] = self._resolve_data_value(value)
                continue
            if key in SANKEY_DATA_KEYS:
                if trace_type == "sankey":
                    trace[key] = self._resolve_data_value(value)
                continue
            if key == "segments":
                trace.update(self._resolve_segments(value))
            elif key in DATA_KEYS:
                if trace_type == "indicator" and key in (
                    "x", "y", "z", "labels", "values",
                ):
                    continue
                trace[key] = self._resolve_data_value(value)
            elif key in STYLE_KEYS:
                trace[key] = self._resolve_style_value(key, value)
            # Unknown keys are deliberately dropped, never passed through.
        if trace_type == "indicator":
            self._finalize_indicator(trace, trace_index)
        elif trace_type == "sankey":
            self._finalize_sankey(trace, trace_index)
        return trace

    def _finalize_indicator(
        self,
        trace: dict,
        trace_index: int,
    ) -> None:
        value = trace.pop("value", _MISSING)
        trace.pop("x", None)
        trace.pop("y", None)
        if value is _MISSING:
            return
        if isinstance(value, list):
            if len(value) == 0:
                raise _RenderConfigError(
                    f"traces[{trace_index}].value: no rows after transforms"
                )
            if len(value) != 1:
                raise _RenderConfigError(
                    f"traces[{trace_index}].value: needs exactly one row "
                    f"after transforms (got {len(value)}); add a 'reduce' "
                    f"transform"
                )
            value = value[0]
        trace["value"] = value

    def _finalize_sankey(
        self,
        trace: dict,
        trace_index: int,
    ) -> None:
        source = trace.pop("source", None)
        target = trace.pop("target", None)
        values = trace.pop("values", None)
        message = (
            f"traces[{trace_index}]: sankey needs source, target and values "
            f"of equal length"
        )
        if not (
            isinstance(source, list)
            and isinstance(target, list)
            and isinstance(values, list)
        ):
            raise _RenderConfigError(message)
        if not (len(source) == len(target) == len(values)):
            raise _RenderConfigError(message)

        numeric_values = pd.to_numeric(
            pd.Series(values), errors="coerce"
        )
        if not bool(numeric_values.notna().any()):
            raise _RenderConfigError(
                f"traces[{trace_index}].values: sankey link values must be "
                f"numeric"
            )
        link_values = _series_to_list(numeric_values)

        node_index: dict = {}
        try:
            for label in source:
                if label not in node_index:
                    node_index[label] = len(node_index)
            for label in target:
                if label not in node_index:
                    node_index[label] = len(node_index)
        except TypeError as exc:
            raise _RenderConfigError(message) from exc
        node_labels = list(node_index)

        node_style = trace.get("node")
        node_style = dict(node_style) if isinstance(node_style, dict) else {}
        node_style["label"] = node_labels
        trace["node"] = node_style

        link_style = trace.get("link")
        link_style = dict(link_style) if isinstance(link_style, dict) else {}
        link_style["source"] = [node_index[label] for label in source]
        link_style["target"] = [node_index[label] for label in target]
        link_style["value"] = link_values
        trace["link"] = link_style

    def _apply_split_palette(
        self,
        trace: dict,
        raw: dict,
        trace_type: str,
        series_index: int,
    ) -> None:
        color = self.palette[series_index % len(self.palette)]
        marker_raw = raw.get("marker")
        raw_marker_color = (
            marker_raw.get("color")
            if isinstance(marker_raw, dict)
            else _MISSING
        )
        if not _is_array_style_value(raw_marker_color):
            marker = trace.get("marker")
            if not isinstance(marker, dict):
                marker = {}
                trace["marker"] = marker
            marker["color"] = color

        mode = trace.get("mode")
        if (
            trace_type == "scatter"
            and isinstance(mode, str)
            and "lines" in mode.split("+")
        ):
            line_raw = raw.get("line")
            raw_line_color = (
                line_raw.get("color")
                if isinstance(line_raw, dict)
                else _MISSING
            )
            if not _is_array_style_value(raw_line_color):
                line = trace.get("line")
                if not isinstance(line, dict):
                    line = {}
                    trace["line"] = line
                line["color"] = color

    def _build_split_traces(
        self,
        raw: dict,
        trace_type: str,
        *,
        default_showlegend: bool = True,
        trace_index: int = 0,
    ) -> list[dict]:
        if raw.get("splitBy") != "$color":
            raise _RenderError("splitBy must be '$color'")
        if trace_type not in SPLIT_TRACE_TYPES:
            raise _RenderError("splitBy not supported on this trace type")
        facet_by = _obj_get(self.manifest, "facet_by")
        if facet_by is None:
            facet_by = _obj_get(self.manifest, "facetBy")
        if facet_by == "$color":
            raise _RenderError("splitBy is not allowed when faceting by color")
        if "color" not in self.slots:
            raise _RenderError("splitBy requires a color channel")
        if _split_uses_color_slot(raw):
            raise _RenderError("split trace also plots the color slot")

        color_column = self._column("color")
        original = self.work
        series = original[color_column]
        try:
            values = list(pd.unique(series))
        except (TypeError, ValueError) as exc:
            raise _RenderError("cannot split by color") from exc

        base_name: Any = None
        if "name" in raw:
            base_name = self._resolve_style_value("name", raw["name"])

        traces: list[dict] = []
        try:
            for value in values:
                if _is_missing_value(value):
                    subset = original[series.isna()]
                else:
                    subset = original[series == value]
                # Defensive: values come from pd.unique(series), so each has rows.
                if subset.empty:
                    continue
                self.work = subset
                trace = self._build_trace_body(
                    raw, trace_type, trace_index
                )
                value_label = _split_value_label(value)
                if base_name is None or base_name == "":
                    trace["name"] = value_label
                else:
                    trace["name"] = f"{base_name} · {value_label}"
                trace["legendgroup"] = value_label
                if "showlegend" not in raw:
                    trace["showlegend"] = default_showlegend
                self._apply_split_palette(
                    trace, raw, trace_type, len(traces)
                )
                traces.append(trace)
        finally:
            self.work = original
        return traces

    def facet_column(self) -> str | None:
        facet_by = _obj_get(self.manifest, "facet_by")
        if facet_by is None:
            facet_by = _obj_get(self.manifest, "facetBy")
        declared_facet = _obj_get(self.channels, "facet") is not None
        if facet_by is not None:
            if declared_facet:
                raise _RenderError(
                    "facetBy and a facet channel are mutually exclusive"
                )
            if facet_by != "$color":
                raise _RenderError("invalid facetBy")
            if "color" not in self.slots:
                raise _RenderError("facetBy requires a color channel")
            column = self.slots["color"]
            if column not in self.work.columns:
                raise _RenderError("facetBy color column is unavailable")
            return column
        if declared_facet:
            if (
                self.facet_field is None
                or self.facet_field not in self.work.columns
            ):
                raise _RenderError("facet channel is not bound")
            return self.facet_field
        return None

    def _build_traces_for_current_frame(
        self,
        *,
        default_showlegend: bool | None = None,
    ) -> list[dict]:
        traces: list[dict] = []
        for trace_index, raw in enumerate(self.manifest.traces or []):
            if not isinstance(raw, dict):
                continue
            trace_type = raw.get("type")
            if trace_type not in TRACE_TYPES:
                continue
            if "splitBy" in raw:
                split_default = (
                    True
                    if default_showlegend is None
                    else default_showlegend
                )
                traces.extend(
                    self._build_split_traces(
                        raw,
                        trace_type,
                        default_showlegend=split_default,
                        trace_index=trace_index,
                    )
                )
            else:
                trace = self._build_trace_body(
                    raw, trace_type, trace_index
                )
                if (
                    default_showlegend is not None
                    and "showlegend" not in raw
                ):
                    trace["showlegend"] = default_showlegend
                traces.append(trace)
        return traces

    def build_faceted_traces(
        self,
        facet_column: str,
        layout: dict,
    ) -> list[dict]:
        original = self.work
        series = original[facet_column]
        try:
            all_values = list(pd.unique(series))
        except (TypeError, ValueError) as exc:
            raise _RenderError("cannot facet by this column") from exc
        if not all_values:
            return []
        total = len(all_values)
        values = all_values[:MAX_FACET_CELLS]

        columns = min(len(values), 3)
        rows = (len(values) + columns - 1) // columns
        layout["grid"] = {
            "rows": rows,
            "columns": columns,
            "pattern": "independent",
            "xgap": 0.08,
            "ygap": 0.12,
        }

        base_xaxis = _facet_axis_copy(layout.get("xaxis"))
        base_yaxis = _facet_axis_copy(layout.get("yaxis"))

        traces: list[dict] = []
        try:
            for index, value in enumerate(values):
                suffix = "" if index == 0 else str(index + 1)
                label = _split_value_label(value)
                cell_xaxis = dict(base_xaxis)
                cell_xaxis["title"] = _facet_axis_title(
                    base_xaxis.get("title"), label
                )
                layout[f"xaxis{suffix}"] = cell_xaxis
                layout[f"yaxis{suffix}"] = dict(base_yaxis)

                if _is_missing_value(value):
                    subset = original[series.isna()]
                else:
                    subset = original[series == value]
                # Defensive: values come from pd.unique(series), so each has rows.
                if subset.empty:
                    continue
                self.work = subset
                cell_traces = self._build_traces_for_current_frame(
                    default_showlegend=(index == 0)
                )
                for trace in cell_traces:
                    trace["xaxis"] = f"x{suffix}"
                    trace["yaxis"] = f"y{suffix}"
                traces.extend(cell_traces)
        finally:
            self.work = original

        if total > MAX_FACET_CELLS:
            annotation = {
                "text": f"Showing {MAX_FACET_CELLS} of {total} facet values",
                "showarrow": False,
                "xref": "paper",
                "yref": "paper",
                "x": 0,
                "y": 1.08,
                "xanchor": "left",
                "font": {"size": 11},
            }
            existing = layout.get("annotations")
            if isinstance(existing, dict):
                annotations = [existing]
            elif isinstance(existing, (list, tuple)):
                annotations = list(existing)
            else:
                annotations = []
            annotations.append(annotation)
            layout["annotations"] = annotations
        return traces

    def build_traces(self) -> list[dict]:
        return self._build_traces_for_current_frame(
            default_showlegend=None
        )


def render(
    df: pd.DataFrame,
    manifest: CustomChartManifest,
    encoding: Any,
    base_layout: dict,
    *,
    palette: list[str] | None = None,
) -> dict:
    """Render a custom manifest against ``df``.

    ``encoding`` is duck-typed like :class:`backend.models.chart.ChartEncoding`
    (``.x``, ``.y_fields``, ``.color``, ``.size``, ``.z``, ``.error``,
    ``.options``, ``.chart_type``); nothing from ``backend.api`` is imported.

    A missing required channel or an unusable field returns the app's normal
    "configure me" state — ``{"data": [], "layout": merged}`` — instead of
    raising. ``base_layout`` is never mutated; ``manifest.layout`` is merged
    over a shallow copy.

    ``palette`` overrides the ten-colour default used by ``splitBy`` traces;
    it is keyword-only so existing four-argument callers are unaffected.

    Structural configuration errors — indicator ``value`` not exactly one row,
    or Sankey ``source``/``target``/``values`` length mismatch — raise
    ``ValueError`` so the API can return the actionable message instead of a
    silent empty figure.
    """
    layout = dict(base_layout or {})
    try:
        resolver = _OptionResolver(manifest, encoding)
        resolved_layout = _resolve_layout(
            _obj_get(manifest, "layout", {}) or {}, resolver
        )
    except Exception:
        _LOG.debug("custom chart layout resolution failed", exc_info=True)
        resolver = None
        resolved_layout = {}
    layout.update(resolved_layout)

    try:
        if resolver is None or df is None:
            raise _RenderError("no data")

        env = _RenderEnv(
            df, manifest, encoding, resolver, palette=palette
        )
        env.prepare()
        env.apply_transforms()
        facet_column = env.facet_column()
        if facet_column is not None:
            traces = env.build_faceted_traces(facet_column, layout)
        else:
            traces = env.build_traces()
        if not traces:
            return {"data": [], "layout": layout}
        return {"data": traces, "layout": layout}
    except _RenderConfigError:
        # Actionable structural errors (indicator arity, sankey lengths) must
        # reach the API/user instead of becoming a silent empty figure.
        raise
    except _RenderError:
        return {"data": [], "layout": layout}
    except Exception:
        # A declarative manifest is user data: never let a pandas edge case
        # turn a preview request into a 500.
        _LOG.debug("custom chart render failed", exc_info=True)
        return {"data": [], "layout": layout}
