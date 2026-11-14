"""Registry invariants, TS-mirror drift, and all-type render coverage.

backend/core/chart_registry.py is the single source of truth for chart ids, UI
channels/options, sampling eligibility and keyword detection. These tests pin
that contract for every consumer (models.ChartEncoding, chart_agent validation,
the preview dispatcher, scripts/gen-chart-registry.py) and then prove it at the
only level that really matters: every registered id renders a trace through
POST /api/v1/chart/preview.
"""

from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

import pytest

from backend.core import chart_registry
from backend.core.chart_registry import CHART_TYPE_IDS, CHART_TYPES

ROOT = Path(__file__).resolve().parents[2]
GEN_SCRIPT = ROOT / "scripts" / "gen-chart-registry.py"

EXPECTED_TYPE_COUNT_FLOOR = 34  # a guard against silent shrinkage, not an exact pin
VALID_Y_FIELDS = {"multi", "first", "none"}
VALID_CHANNELS = {"x", "color", "size", "facet", "z", "error", "source", "target"}
VALID_OPTIONS = {
    "barmode", "orientation", "histnorm", "cumulative", "boxPoints",
    "marginal", "annotated", "corr", "ganttFields", "candlestickFields",
    "gaugeRange",
}
VALID_DIMENSIONS = {None, "dimensions", "columns"}


# --------------------------------------------------------------- invariants

def test_registry_shape_is_unique_and_complete():
    # Derived from the registry, never a hardcoded id list: adding type #35 must
    # not fail a "registry invariants" test for no reason.
    assert len(CHART_TYPES) >= EXPECTED_TYPE_COUNT_FLOOR
    assert len(CHART_TYPE_IDS) == len(CHART_TYPES)
    assert len(CHART_TYPE_IDS) == len(set(CHART_TYPE_IDS)), "chart ids must be unique"
    assert all(t.id and t.id == t.id.strip() for t in CHART_TYPES)
    assert all(t.label for t in CHART_TYPES), "every type needs a UI label"


def test_registry_axes_use_known_vocabularies():
    for spec in CHART_TYPES:
        assert spec.y_fields in VALID_Y_FIELDS, f"{spec.id}: bad y_fields {spec.y_fields!r}"
        for channel in spec.channels:
            assert channel in VALID_CHANNELS, f"{spec.id}: unknown channel {channel!r}"
        for option in spec.options:
            assert option in VALID_OPTIONS, f"{spec.id}: unknown option {option!r}"
        assert spec.dimensions in VALID_DIMENSIONS, f"{spec.id}: bad dimensions {spec.dimensions!r}"
        # Every type must expose something the config panel can bind to.
        assert spec.channels or spec.dimensions or spec.path or spec.y_fields != "none", (
            f"{spec.id}: no channel, dimensions, path or y-field — it could not be configured"
        )


def test_registry_keywords_are_lowercase_and_unique():
    seen: dict[str, str] = {}
    for spec in CHART_TYPES:
        for keyword in spec.keywords:
            assert keyword == keyword.lower(), f"{spec.id}: keyword {keyword!r} must be lowercase"
            assert keyword and keyword == keyword.strip(), (
                f"{spec.id}: keyword {keyword!r} must be non-empty and trimmed"
            )
            assert keyword not in seen, (
                f"keyword {keyword!r} claimed by both {seen.get(keyword)} and {spec.id}"
            )
            seen[keyword] = spec.id


def test_registry_derived_helpers():
    assert sorted(i for i in CHART_TYPE_IDS if chart_registry.samplable(i)) == [
        "area", "dot", "line", "scatter", "step",
    ]
    assert sorted(chart_registry.relational_types()) == [
        "area", "bar", "barh", "dot", "line", "pie", "scatter", "step",
    ]
    assert chart_registry.no_yfield_types() == {
        "candlestick", "parcats", "parcoords", "splom", "table",
    }
    assert chart_registry.is_known_chart_type("gauge") is True
    assert chart_registry.is_known_chart_type("not_a_chart") is False


def test_type_keywords_are_sorted_longest_first():
    keywords = chart_registry.type_keywords()
    assert keywords, "keyword table must not be empty"
    assert all(chart_registry.is_known_chart_type(chart_id) for _, chart_id in keywords)
    lengths = [len(keyword) for keyword, _ in keywords]
    assert lengths == sorted(lengths, reverse=True), (
        "type_keywords() must stay sorted by descending keyword length "
        "(deterministic table order); resolution itself is position-based — "
        "see test_detect_chart_type_resolves_by_first_mention"
    )


def test_detect_chart_type_resolves_by_first_mention():
    """Keyword resolution is position-based, not registry-order-based."""
    # line is mentioned first and bar second. bar's keywords come earlier in the
    # registry, so a registry-order scan would have answered bar.
    assert chart_registry.detect_chart_type("折线图和柱状图") == "line"
    # A longer phrase starting earlier beats the shorter keyword it contains.
    assert chart_registry.detect_chart_type("horizontal bar chart") == "barh"
    # barh precedes pie in the registry; the request mentions pie first.
    assert chart_registry.detect_chart_type("用饼图替代现在的条形图") == "pie"
    assert chart_registry.detect_chart_type("nothing chart-like here") is None


def test_builders_only_dispatch_registered_types():
    """A registry entry with no builder silently falls through to the generic
    chain, so a typo'd builder key would ship an empty chart. The render matrix
    proves this empirically; this pins the direction of the seam: no builder may
    exist for an id the registry does not advertise."""
    from backend.api.chart import _BUILDERS

    assert set(_BUILDERS) <= set(CHART_TYPE_IDS), (
        "builders registered for unregistered ids: "
        f"{sorted(set(_BUILDERS) - set(CHART_TYPE_IDS))}"
    )


# ---------------------------------------------------------- generated mirror

def test_generated_ts_mirror_is_up_to_date():
    if not GEN_SCRIPT.exists():
        pytest.skip(f"registry generator missing at {GEN_SCRIPT.relative_to(ROOT)}")
    proc = subprocess.run(
        [sys.executable, str(GEN_SCRIPT), "--check"],
        cwd=ROOT,
        capture_output=True,
        text=True,
    )
    assert proc.returncode == 0, (
        "src/utils/chartTypeRegistry.generated.ts drifted from "
        "backend/core/chart_registry.py — run scripts/gen-chart-registry.py\n"
        + proc.stdout
        + proc.stderr
    )
    assert "up to date" in proc.stdout.lower(), proc.stdout


# ------------------------------------------------------- render coverage

# One fixture wide enough to satisfy every channel the registry advertises:
# low-cardinality categories (cat/cat2), a task label, three numeric measures
# (v1/v2/v3), OHLC prices and two datetime columns for gantt.
ALL_TYPES_CSV = """date,cat,cat2,task,v1,v2,v3,open,high,low,close,start,end
2024-01-01,A,x,design,10,1.5,100,100,110,90,105,2024-01-01 08:00,2024-01-01 12:00
2024-01-02,B,y,build,20,2.5,200,105,115,95,108,2024-01-02 08:00,2024-01-02 13:00
2024-01-03,C,x,test,30,1.5,300,108,120,100,115,2024-01-03 09:00,2024-01-03 14:00
2024-01-04,D,y,ship,40,2.5,400,115,125,110,120,2024-01-04 09:00,2024-01-04 15:00
2024-01-05,A,y,design,10,2.5,110,120,130,115,126,2024-01-05 08:00,2024-01-05 12:00
2024-01-06,B,x,build,20,1.5,210,126,135,120,130,2024-01-06 08:00,2024-01-06 13:00
2024-01-07,C,y,test,30,2.5,310,130,140,125,136,2024-01-07 09:00,2024-01-07 14:00
2024-01-08,D,x,ship,40,1.5,410,136,145,130,140,2024-01-08 09:00,2024-01-08 15:00
"""


def _q(field: str) -> dict:
    return {"field": field, "type": "quantitative"}


def _n(field: str) -> dict:
    return {"field": field, "type": "nominal"}


def _t(field: str) -> dict:
    return {"field": field, "type": "temporal"}


# Types whose x channel is binned/positioned numerically rather than categorically
# (their x feeds a numeric axis, so a nominal category would not render).
_NUMERIC_X_TYPES = (
    "density_heatmap", "density_contour", "heatmap", "contour",
    "surface", "scatter3d", "ternary",
)

# Per-type encodings the generic builder genuinely cannot guess: they depend on
# channels the type reads through options/paths/dimensions rather than x/yFields.
_PER_TYPE_OVERRIDES: dict[str, dict] = {
    chart_id: {"x": _q("v2"), "z": _q("v3")} for chart_id in _NUMERIC_X_TYPES
}
_PER_TYPE_OVERRIDES.update({
    "pie": {"color": _n("cat")},
    "sankey": {"source": _n("cat"), "target": _n("cat2")},
    "splom": {"dimensions": ["v1", "v2"]},
    "parcoords": {"dimensions": ["v1", "v2"]},
    "parcats": {"dimensions": ["cat", "cat2"]},
    "table": {"dimensions": ["cat", "cat2"]},
    "treemap": {"path": ["cat", "cat2"]},
    "sunburst": {"path": ["cat", "cat2"]},
    "icicle": {"path": ["cat", "cat2"]},
    "gantt": {
        "yFields": [{"field": "task", "type": "nominal"}],
        "x": _t("date"),
        "options": {"startField": "start", "endField": "end"},
    },
    "candlestick": {
        "yFields": [],
        "x": _t("date"),
        "options": {
            "openField": "open", "highField": "high",
            "lowField": "low", "closeField": "close",
        },
    },
    "gauge": {"yFields": [{"field": "v1", "type": "quantitative", "aggregate": "sum"}]},
})


def build_encoding(chart_id: str) -> dict:
    """Drive a chart encoding from the registry metadata, not from 34 hand-tuned configs.

    Generic defaults cover the channels a type actually advertises; the override
    table above only adds what the type reads through options/paths/dimensions.
    """
    spec = chart_registry.get_chart_type(chart_id)
    assert spec is not None, f"{chart_id} is not registered"

    encoding: dict = {"chartType": chart_id}
    if spec.y_fields != "none":
        encoding["yFields"] = [_q("v1")]
    if "x" in spec.channels:
        encoding["x"] = _n("cat")
    if "color" in spec.channels:
        encoding["color"] = _n("cat2")
    if "size" in spec.channels:
        encoding["size"] = _q("v2")
    if "error" in spec.channels:
        encoding["error"] = _q("v2")
    if "facet" in spec.channels:
        encoding["facet"] = _n("cat2")
    encoding.update(_PER_TYPE_OVERRIDES.get(chart_id, {}))
    return encoding


@pytest.fixture
def wide_dataset_id(client) -> str:
    resp = client.post(
        "/api/v1/data/import",
        files={"file": ("all_types.csv", ALL_TYPES_CSV.encode(), "text/csv")},
    )
    assert resp.status_code == 200, resp.text
    return resp.json()[0]["id"]


def test_override_table_only_covers_registered_types():
    unknown = sorted(set(_PER_TYPE_OVERRIDES) - set(CHART_TYPE_IDS))
    assert not unknown, f"overrides for unregistered ids: {unknown}"


def test_every_registered_chart_type_renders(client, wide_dataset_id):
    """One broken builder must not hide the other 33: collect and report all."""
    failures: list[str] = []
    for chart_id in CHART_TYPE_IDS:
        encoding = build_encoding(chart_id)
        resp = client.post(
            "/api/v1/chart/preview",
            json={"dataset_id": wide_dataset_id, "encoding": encoding},
        )
        if resp.status_code != 200:
            failures.append(f"{chart_id}: HTTP {resp.status_code} — {resp.text[:300]}")
            continue
        data = resp.json().get("data")
        if not isinstance(data, list) or not data:
            failures.append(f"{chart_id}: preview returned an empty data array (encoding={encoding})")
            continue
        untyped = [i for i, trace in enumerate(data) if not isinstance(trace, dict) or "type" not in trace]
        if untyped:
            failures.append(f"{chart_id}: traces missing a 'type' key at index {untyped}")
    assert not failures, "chart types failed to render:\n" + "\n".join(failures)


def test_unknown_chart_type_is_rejected_with_a_registry_hint(client, wide_dataset_id):
    resp = client.post(
        "/api/v1/chart/preview",
        json={"dataset_id": wide_dataset_id, "encoding": {"chartType": "definitely_not_registered"}},
    )
    assert resp.status_code == 422, resp.text
    detail = json.dumps(resp.json()["detail"])
    assert "definitely_not_registered" in detail
    assert "chart_registry" in detail, "the error must point at the registry to extend"

    # ...and a registered id never trips the same guard.
    ok = client.post(
        "/api/v1/chart/preview",
        json={
            "dataset_id": wide_dataset_id,
            "encoding": build_encoding("gauge"),
        },
    )
    assert ok.status_code == 200, ok.text
