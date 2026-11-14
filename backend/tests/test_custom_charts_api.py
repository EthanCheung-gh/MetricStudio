"""HTTP API + AI chart agent integration for declarative custom charts.

The manifest engine itself (validation, storage, transforms, rendering) is
covered by ``test_custom_charts.py``. These tests prove the *wiring*:

* a manifest is CRUD-able over ``/api/v1/chart/custom``;
* an unsafe id is rejected before it can touch the filesystem;
* ``chartType: "<custom id>"`` is a first-class preview type that renders
  through ``custom_charts.render`` (including ``$opt.<key>`` option values);
* the chart agent accepts custom ids, derives its yFields rule from the
  manifest and detects custom keywords.

Every manifest read/write is redirected to ``tmp_path``; the user's real
``~/.metricstudio/charts`` is never touched (see the two fixtures below).
"""

from __future__ import annotations

import json
from pathlib import Path

import pandas as pd
import pytest

import backend.core.chart_agent as chart_agent
from backend.core import custom_charts as cc

ROOT = Path(__file__).resolve().parents[2]
EXAMPLES = ROOT / "examples" / "charts"
REAL_CHART_DIR = Path.home() / ".metricstudio" / "charts"

DUMBBELL_CSV = """city,start,end
A,10,18
B,20,17
C,30,45
"""


# ---------------------------------------------------------------------------
# Fixtures: manifest storage isolation
# ---------------------------------------------------------------------------

@pytest.fixture(scope="session", autouse=True)
def real_chart_dir_untouched():
    """Fail the session if any test leaked into the real chart directory."""

    def snapshot():
        try:
            return (
                REAL_CHART_DIR.exists(),
                tuple(
                    sorted(
                        (path.name, path.stat().st_mtime_ns, path.stat().st_size)
                        for path in REAL_CHART_DIR.glob("*.json")
                    )
                ),
            )
        except OSError:
            return (REAL_CHART_DIR.exists(), ())

    before = snapshot()
    yield
    assert snapshot() == before, "a test wrote into the real ~/.metricstudio/charts"


@pytest.fixture(autouse=True)
def charts_dir(tmp_path, monkeypatch):
    """Point every manifest read/write at tmp_path and clear the mtime cache.

    ``custom_charts`` keeps a module-level manifest cache keyed by a directory
    signature; the signature includes ``CHART_DIR`` so a new tmp path already
    invalidates it, but the cache is cleared explicitly to keep tests order
    independent.
    """
    directory = tmp_path / "charts"
    monkeypatch.setattr(cc, "CHART_DIR", directory)
    invalidate = getattr(cc, "_invalidate_cache", None)
    if callable(invalidate):
        invalidate()
    # The guarantee this whole module depends on.
    assert cc.CHART_DIR != REAL_CHART_DIR
    assert tmp_path in cc.CHART_DIR.parents
    yield directory
    if callable(invalidate):
        invalidate()


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def manifest_payload(name: str = "dumbbell") -> dict:
    """A real, valid example manifest (``examples/charts/*.json``)."""
    return json.loads((EXAMPLES / f"{name}.json").read_text(encoding="utf-8"))


def x_only_manifest(chart_id: str = "microbars") -> dict:
    """A minimal manifest that declares only x + yFields (no other channels)."""
    return {
        "schemaVersion": 1,
        "id": chart_id,
        "label": {"zh": "微型柱", "en": "Micro bars"},
        "channels": {
            "x": {"required": True, "types": ["nominal"]},
            "yFields": {"mode": "one"},
        },
        "transforms": [{"op": "dropna", "slots": ["x", "y0"]}],
        "traces": [{"type": "bar", "x": "$x", "y": "$y0"}],
    }


def dumbbell_encoding(**overrides) -> dict:
    encoding = {
        "chartType": "dumbbell",
        "x": {"field": "city", "type": "nominal"},
        "yFields": [
            {"field": "start", "type": "quantitative", "label": "Start"},
            {"field": "end", "type": "quantitative", "label": "End"},
        ],
    }
    encoding.update(overrides)
    return encoding


def lollipop_encoding(**overrides) -> dict:
    encoding = {
        "chartType": "lollipop",
        "x": {"field": "city", "type": "nominal"},
        "yFields": [{"field": "start", "type": "quantitative"}],
    }
    encoding.update(overrides)
    return encoding


def preview(client, dataset_id: str, encoding: dict):
    return client.post(
        "/api/v1/chart/preview",
        json={"dataset_id": dataset_id, "encoding": encoding},
    )


def import_csv(client, csv: str, name: str = "data.csv") -> str:
    resp = client.post(
        "/api/v1/data/import",
        files={"file": (name, csv.encode("utf-8"), "text/csv")},
    )
    assert resp.status_code == 200, resp.text
    return resp.json()[0]["id"]


def save(client, name: str = "dumbbell"):
    resp = client.post("/api/v1/chart/custom", json=manifest_payload(name))
    assert resp.status_code == 200, resp.text
    return resp


@pytest.fixture
def dumbbell_dataset(client):
    return import_csv(client, DUMBBELL_CSV, "dumbbell.csv")


# ---------------------------------------------------------------------------
# 1. CRUD round-trip
# ---------------------------------------------------------------------------

def test_crud_roundtrip(client, charts_dir):
    payload = manifest_payload()

    created = client.post("/api/v1/chart/custom", json=payload)
    assert created.status_code == 200, created.text
    assert created.json() == {"id": "dumbbell", "replaced": False}

    listing = client.get("/api/v1/chart/custom")
    assert listing.status_code == 200
    body = listing.json()
    assert body["invalid"] == []
    [item] = body["items"]
    assert item["id"] == "dumbbell"
    assert item["file"] == str(charts_dir / "dumbbell.json")
    assert item["label"] == {"zh": "哑铃图", "en": "Dumbbell"}
    assert item["channels"]["yFields"] == {"mode": "range"}

    fetched = client.get("/api/v1/chart/custom/dumbbell")
    assert fetched.status_code == 200
    dumped = fetched.json()
    assert dumped["id"] == "dumbbell"
    assert dumped["schemaVersion"] == 1
    assert [option["key"] for option in dumped["options"]] == ["connector", "width"]

    again = client.post("/api/v1/chart/custom", json=payload)
    assert again.status_code == 200
    assert again.json() == {"id": "dumbbell", "replaced": True}

    deleted = client.delete("/api/v1/chart/custom/dumbbell")
    assert deleted.status_code == 200
    assert deleted.json() == {"deleted": True}
    assert client.delete("/api/v1/chart/custom/dumbbell").status_code == 404
    assert client.get("/api/v1/chart/custom/dumbbell").status_code == 404


def test_channels_omit_undeclared_keys(client):
    resp = client.post("/api/v1/chart/custom", json=x_only_manifest())
    assert resp.status_code == 200, resp.text

    [item] = client.get("/api/v1/chart/custom").json()["items"]
    # Only the declared channels are sent: a null key would make the SPA render
    # a picker for a channel the manifest never declared (and binding it would
    # silently do nothing when rendering).
    assert set(item["channels"]) == {"x", "yFields"}
    assert item["channels"]["yFields"] == {"mode": "one"}
    assert item["channels"]["x"] == {"required": True, "types": ["nominal"]}

    fetched = client.get("/api/v1/chart/custom/microbars").json()
    assert set(fetched["channels"]) == {"x", "yFields"}
    assert "description" not in fetched  # nulls are absent, not null


def test_list_reports_invalid_files_without_failing(client, charts_dir):
    charts_dir.mkdir(parents=True)
    (charts_dir / "broken.json").write_text("{not json", encoding="utf-8")

    body = client.get("/api/v1/chart/custom").json()
    assert body["items"] == []
    [entry] = body["invalid"]
    # Both lists report an absolute "Source" path; core supplies the basename.
    assert entry["file"] == str(charts_dir / "broken.json")
    assert "invalid JSON" in entry["errors"][0]


# ---------------------------------------------------------------------------
# 2. Invalid manifest -> 400 with the joined validation errors
# ---------------------------------------------------------------------------

def test_invalid_manifest_is_400_with_specific_errors(client, charts_dir):
    payload = manifest_payload()
    payload["traces"][0]["type"] = "mesh3d"

    resp = client.post("/api/v1/chart/custom", json=payload)
    assert resp.status_code == 400
    detail = resp.json()["detail"]
    assert isinstance(detail, str)
    assert "unsupported trace type 'mesh3d'" in detail
    assert not (charts_dir / "dumbbell.json").exists()

    non_object = client.post("/api/v1/chart/custom", json=[payload])
    assert non_object.status_code == 400
    assert non_object.json()["detail"] == "manifest must be a JSON object"


def test_save_and_delete_map_filesystem_errors_to_400(client, monkeypatch):
    # A read-only directory / full disk must surface as a user-facing 400,
    # never as a 500 (the core raises OSError for those cases).
    def failing_save(payload):
        raise OSError(28, "No space left on device")

    monkeypatch.setattr(cc, "save_manifest", failing_save)
    resp = client.post("/api/v1/chart/custom", json=manifest_payload())
    assert resp.status_code == 400
    assert "No space left on device" in resp.json()["detail"]

    def failing_delete(chart_id):
        raise OSError(13, "Permission denied")

    monkeypatch.setattr(cc, "delete_manifest", failing_delete)
    resp = client.delete("/api/v1/chart/custom/dumbbell")
    assert resp.status_code == 400
    assert "Permission denied" in resp.json()["detail"]


# ---------------------------------------------------------------------------
# 3. Path traversal / unsafe ids never reach the filesystem
# ---------------------------------------------------------------------------

@pytest.mark.parametrize(
    "raw_id", ["..%2F..%2Fetc%2Fpasswd", "../x", "%2e%2e%2Fpasswd"]
)
def test_traversal_ids_never_reach_the_loader(client, monkeypatch, raw_id):
    calls: list[str] = []
    real_load = cc.load_manifest
    monkeypatch.setattr(
        cc,
        "load_manifest",
        lambda chart_id: (calls.append(chart_id), real_load(chart_id))[1],
    )

    resp = client.get(f"/api/v1/chart/custom/{raw_id}")
    assert resp.status_code in (400, 404)
    assert "root:" not in resp.text
    # Whatever route the id took, no traversal string reached the loader.
    assert not any(".." in call or "/" in call for call in calls)


@pytest.mark.parametrize("bad_id", ["a.b", "Dumbbell", "x", "-lead", "a b"])
def test_unsafe_ids_are_rejected_before_filesystem(client, monkeypatch, bad_id):
    calls: list[str] = []
    real_load = cc.load_manifest
    monkeypatch.setattr(
        cc,
        "load_manifest",
        lambda chart_id: (calls.append(chart_id), real_load(chart_id))[1],
    )

    assert client.get(f"/api/v1/chart/custom/{bad_id}").status_code == 400
    assert client.delete(f"/api/v1/chart/custom/{bad_id}").status_code == 400
    assert calls == []


# ---------------------------------------------------------------------------
# 4. Render through /preview with a custom chartType
# ---------------------------------------------------------------------------

def test_custom_chart_renders_through_preview(client, dumbbell_dataset, charts_dir):
    save(client)

    resp = preview(client, dumbbell_dataset, dumbbell_encoding())
    assert resp.status_code == 200, resp.text
    figure = resp.json()
    assert figure["data"], "dumbbell must render traces"
    for trace in figure["data"]:
        assert trace["type"] in cc.TRACE_TYPES
    # The manifest's layout patch is merged over the app's base layout.
    assert figure["layout"]["margin"] == {"l": 70, "r": 20, "t": 30, "b": 50}
    assert figure["layout"]["autosize"] is True


def test_custom_chart_missing_required_channel_is_empty(client, dumbbell_dataset):
    save(client)

    # dumbbell declares x as required: without it the app's normal
    # "configure me" state (empty data) is returned, not an error.
    resp = preview(
        client,
        dumbbell_dataset,
        {"chartType": "dumbbell", "yFields": dumbbell_encoding()["yFields"]},
    )
    assert resp.status_code == 200, resp.text
    assert resp.json()["data"] == []


# ---------------------------------------------------------------------------
# 4b. Renderer capabilities: splitBy palette + array style slots
# ---------------------------------------------------------------------------

SERIES_LINE_CSV = """month,sales,region
Jan,10,North
Feb,20,South
Mar,30,North
Apr,40,South
"""

BUBBLE_CSV = """x,y,group,size,err
1,10,A,5,1
2,20,B,7,2
3,30,A,9,3
"""


def test_series_line_splits_by_color_with_builtin_palette(client):
    from backend.api.chart import DEFAULT_COLORS

    dataset_id = import_csv(client, SERIES_LINE_CSV, "series.csv")
    save(client, "series-line")

    resp = preview(
        client,
        dataset_id,
        {
            "chartType": "series-line",
            "x": {"field": "month", "type": "nominal"},
            "yFields": [{"field": "sales", "type": "quantitative"}],
            "color": {"field": "region", "type": "nominal"},
        },
    )
    assert resp.status_code == 200, resp.text
    data = resp.json()["data"]
    assert len(data) == 2

    # splitBy orders series by first appearance in the data: North, South.
    assert [trace["legendgroup"] for trace in data] == ["North", "South"]
    # The API passes DEFAULT_COLORS to render(), so a custom split series is
    # coloured exactly like a built-in multi-series chart.
    assert [trace["marker"]["color"] for trace in data] == list(DEFAULT_COLORS[:2])
    assert [trace["line"]["color"] for trace in data] == list(DEFAULT_COLORS[:2])
    # Each trace carries only its own group's rows.
    assert data[0]["y"] == [10, 30]
    assert data[1]["y"] == [20, 40]


def test_bubble_renders_array_size_color_and_error(client):
    dataset_id = import_csv(client, BUBBLE_CSV, "bubble.csv")
    save(client, "bubble")

    resp = preview(
        client,
        dataset_id,
        {
            "chartType": "bubble",
            "x": {"field": "x", "type": "quantitative"},
            "yFields": [{"field": "y", "type": "quantitative"}],
            "color": {"field": "group", "type": "nominal"},
            "size": {"field": "size", "type": "quantitative"},
            "error": {"field": "err", "type": "quantitative"},
        },
    )
    assert resp.status_code == 200, resp.text
    trace = resp.json()["data"][0]
    assert len(trace["x"]) == 3
    # $size.values / $color.values become Plotly arrays, not scalars.
    assert trace["marker"]["size"] == [5, 7, 9]
    assert trace["marker"]["color"] == ["A", "B", "A"]
    # $error.values is the numeric error column, value for value.
    assert trace["error_y"]["array"] == [1, 2, 3]
    assert trace["error_y"]["visible"] is True


def test_bubble_without_size_channel_is_empty(client):
    dataset_id = import_csv(client, BUBBLE_CSV, "bubble.csv")
    save(client, "bubble")

    resp = preview(
        client,
        dataset_id,
        {
            "chartType": "bubble",
            "x": {"field": "x", "type": "quantitative"},
            "yFields": [{"field": "y", "type": "quantitative"}],
            "color": {"field": "group", "type": "nominal"},
            # size intentionally omitted: the manifest declares it required.
            "error": {"field": "err", "type": "quantitative"},
        },
    )
    assert resp.status_code == 200, resp.text
    assert resp.json()["data"] == []


# ---------------------------------------------------------------------------
# 4c. Faceting: subplot grid from a channel or from facetBy: "$color"
# ---------------------------------------------------------------------------

FACET_CSV = """city,sales,region
A,10,North
B,20,South
C,30,East
D,40,North
E,50,South
"""

COLORS_CSV = """city,sales,tier
A,10,Gold
B,20,Silver
C,30,Bronze
D,40,Gold
E,50,Silver
"""


def test_facet_grid_renders_subplot_grid(client):
    dataset_id = import_csv(client, FACET_CSV, "facet.csv")
    save(client, "facet-grid")

    resp = preview(
        client,
        dataset_id,
        {
            "chartType": "facet-grid",
            "x": {"field": "city", "type": "nominal"},
            "yFields": [{"field": "sales", "type": "quantitative"}],
            "facet": {"field": "region", "type": "nominal"},
        },
    )
    assert resp.status_code == 200, resp.text
    figure = resp.json()
    data = figure["data"]
    assert len(data) == 3

    # One row of three independent cells, first-appearance order.
    assert figure["layout"]["grid"] == {
        "rows": 1,
        "columns": 3,
        "pattern": "independent",
        "xgap": 0.08,
        "ygap": 0.12,
    }
    # Cell i uses axes suffix "" then "2", "3".
    assert [(trace["xaxis"], trace["yaxis"]) for trace in data] == [
        ("x", "y"),
        ("x2", "y2"),
        ("x3", "y3"),
    ]
    # Cell xaxis titles come from the facet values.
    assert [
        figure["layout"][axis]["title"] for axis in ("xaxis", "xaxis2", "xaxis3")
    ] == ["North", "South", "East"]
    # Each trace carries only its own cell's rows.
    assert [trace["y"] for trace in data] == [[10, 40], [20, 50], [30]]


def test_colors_grid_facets_by_color(client):
    dataset_id = import_csv(client, COLORS_CSV, "colors.csv")
    save(client, "colors-grid")

    resp = preview(
        client,
        dataset_id,
        {
            "chartType": "colors-grid",
            "x": {"field": "city", "type": "nominal"},
            "yFields": [{"field": "sales", "type": "quantitative"}],
            "color": {"field": "tier", "type": "nominal"},
        },
    )
    assert resp.status_code == 200, resp.text
    figure = resp.json()
    data = figure["data"]
    # facetBy: "$color" -> one cell (and one trace) per colour value.
    assert len(data) == 3
    assert figure["layout"]["grid"]["columns"] == 3
    assert [
        figure["layout"][axis]["title"] for axis in ("xaxis", "xaxis2", "xaxis3")
    ] == ["Gold", "Silver", "Bronze"]
    assert [(trace["xaxis"], trace["yaxis"]) for trace in data] == [
        ("x", "y"),
        ("x2", "y2"),
        ("x3", "y3"),
    ]
    # $color.values stays cell-local: every point in a cell shares its colour.
    assert [trace["marker"]["color"] for trace in data] == [
        ["Gold", "Gold"],
        ["Silver", "Silver"],
        ["Bronze"],
    ]


def test_facet_grid_sampling_keeps_grid_cells(client, monkeypatch):
    # 12 rows, 4 per cell; the 5-point stride samples rows 0, 3, 6, 8, 11,
    # i.e. two A rows, one B row and two C rows.
    rows = "\n".join(
        f"x{i},{i},{cell}"
        for i, cell in enumerate(["A"] * 4 + ["B"] * 4 + ["C"] * 4, start=1)
    )
    dataset_id = import_csv(client, f"city,sales,region\n{rows}\n", "many.csv")
    monkeypatch.setenv("METRICSTUDIO_CHART_MAX_POINTS", "5")
    save(client, "facet-grid")

    resp = preview(
        client,
        dataset_id,
        {
            "chartType": "facet-grid",
            "x": {"field": "city", "type": "nominal"},
            "yFields": [{"field": "sales", "type": "quantitative"}],
            "facet": {"field": "region", "type": "nominal"},
        },
    )
    assert resp.status_code == 200, resp.text
    figure = resp.json()
    # Sampling runs on the whole frame before faceting: the cells survive but
    # their row counts scale down with the cap (2 + 1 + 2 = 5).
    assert figure["layout"]["meta"]["sampled"] == {"total": 12, "shown": 5, "max": 5}
    assert figure["layout"]["grid"]["columns"] == 3
    assert figure["layout"]["grid"]["rows"] == 1
    assert [len(trace["y"]) for trace in figure["data"]] == [2, 1, 2]
    assert sum(len(trace["y"]) for trace in figure["data"]) == 5


def test_facet_grid_unbound_required_facet_is_empty(client):
    dataset_id = import_csv(client, FACET_CSV, "facet.csv")
    save(client, "facet-grid")

    resp = preview(
        client,
        dataset_id,
        {
            "chartType": "facet-grid",
            "x": {"field": "city", "type": "nominal"},
            "yFields": [{"field": "sales", "type": "quantitative"}],
            # facet intentionally omitted: the manifest declares it required.
        },
    )
    assert resp.status_code == 200, resp.text
    figure = resp.json()
    assert figure["data"] == []
    assert "grid" not in figure["layout"]


def test_split_by_with_facet_by_color_is_rejected(client, charts_dir):
    payload = manifest_payload("colors-grid")
    payload["traces"][0]["splitBy"] = "$color"

    resp = client.post("/api/v1/chart/custom", json=payload)
    assert resp.status_code == 400
    detail = resp.json()["detail"]
    assert isinstance(detail, str)
    assert "not allowed when the manifest facets by '$color'" in detail
    assert not (charts_dir / "colors-grid.json").exists()


# ---------------------------------------------------------------------------
# 4d. Data shaping (reduce / multi-key group_agg) + indicator and sankey traces
# ---------------------------------------------------------------------------

KPI_CSV = """value
10
20
30
"""

DUPLICATE_FLOW_CSV = """src,dst,amount
A,X,10
A,X,5
B,Y,20
A,Y,7
C,X,3
"""


def test_kpi_gauge_uses_options_for_range_and_colour(client):
    dataset_id = import_csv(client, KPI_CSV, "kpi.csv")
    save(client, "kpi-gauge")

    resp = preview(
        client,
        dataset_id,
        {
            "chartType": "kpi-gauge",
            "yFields": [{"field": "value", "type": "quantitative"}],
            "options": {"min": 0, "max": 200, "color": "#112233"},
        },
    )
    assert resp.status_code == 200, resp.text
    data = resp.json()["data"]
    assert len(data) == 1
    trace = data[0]
    assert trace["type"] == "indicator"
    # reduce collapses three rows to the aggregate scalar, never a list.
    assert not isinstance(trace["value"], list)
    assert trace["value"] == 60
    assert trace["gauge"]["axis"]["range"] == [0, 200]
    assert trace["gauge"]["bar"]["color"] == "#112233"
    assert "gauge" in trace["mode"] and "number" in trace["mode"]


def test_kpi_gauge_uses_manifest_defaults_without_options(client):
    dataset_id = import_csv(client, KPI_CSV, "kpi.csv")
    save(client, "kpi-gauge")

    resp = preview(
        client,
        dataset_id,
        {
            "chartType": "kpi-gauge",
            "yFields": [{"field": "value", "type": "quantitative"}],
        },
    )
    assert resp.status_code == 200, resp.text
    trace = resp.json()["data"][0]
    # examples/charts/kpi-gauge.json declares min=0, max=100, color=#2563eb.
    assert trace["value"] == 60
    assert trace["gauge"]["axis"]["range"] == [0, 100]
    assert trace["gauge"]["bar"]["color"] == "#2563eb"


def test_flow_sankey_aggregates_links_and_labels_nodes(client):
    dataset_id = import_csv(client, DUPLICATE_FLOW_CSV, "flow.csv")
    save(client, "flow-sankey")

    resp = preview(
        client,
        dataset_id,
        {
            "chartType": "flow-sankey",
            "source": {"field": "src", "type": "nominal"},
            "target": {"field": "dst", "type": "nominal"},
            "yFields": [{"field": "amount", "type": "quantitative"}],
        },
    )
    assert resp.status_code == 200, resp.text
    trace = resp.json()["data"][0]
    assert trace["type"] == "sankey"
    # Node labels: every source first appearance, then unseen targets.
    assert trace["node"]["label"] == ["A", "B", "C", "X", "Y"]
    assert trace["link"]["source"] == [0, 1, 0, 2]
    assert trace["link"]["target"] == [3, 4, 4, 3]
    # (A,X) rows 10 + 5 were folded into one link: multi-key group_agg ran.
    assert trace["link"]["value"] == [15, 20, 7, 3]
    pairs = {
        (trace["node"]["label"][source], trace["node"]["label"][target]): value
        for source, target, value in zip(
            trace["link"]["source"],
            trace["link"]["target"],
            trace["link"]["value"],
        )
    }
    assert pairs == {
        ("A", "X"): 15,
        ("B", "Y"): 20,
        ("A", "Y"): 7,
        ("C", "X"): 3,
    }


def test_indicator_value_with_several_rows_is_400(client):
    payload = manifest_payload("kpi-gauge")
    payload["id"] = "kpiarity"
    payload["label"] = {"zh": "KPI 异常", "en": "KPI arity"}
    payload["keywords"] = []
    payload["transforms"] = []  # no reduce: $y0 keeps one value per row
    payload["traces"][0]["value"] = "$y0"
    created = client.post("/api/v1/chart/custom", json=payload)
    assert created.status_code == 200, created.text

    dataset_id = import_csv(client, "value\n1\n2\n3\n4\n5\n", "kpi.csv")
    resp = preview(
        client,
        dataset_id,
        {
            "chartType": "kpiarity",
            "yFields": [{"field": "value", "type": "quantitative"}],
        },
    )
    assert resp.status_code == 400, resp.text
    detail = resp.json()["detail"]
    assert isinstance(detail, str)
    assert "needs exactly one row" in detail
    assert "reduce" in detail


def test_sankey_length_mismatch_is_400(client):
    payload = manifest_payload("flow-sankey")
    payload["id"] = "sankeymismatch"
    payload["label"] = {"zh": "错长桑基", "en": "Sankey mismatch"}
    payload["keywords"] = []
    # A 2-entry literal source against a multi-key group_agg frame: the
    # manifest validates, the renderer finds the length mismatch.
    payload["traces"][0]["source"] = ["A", "B"]
    created = client.post("/api/v1/chart/custom", json=payload)
    assert created.status_code == 200, created.text

    dataset_id = import_csv(client, DUPLICATE_FLOW_CSV, "flow.csv")
    resp = preview(
        client,
        dataset_id,
        {
            "chartType": "sankeymismatch",
            "source": {"field": "src", "type": "nominal"},
            "target": {"field": "dst", "type": "nominal"},
            "yFields": [{"field": "amount", "type": "quantitative"}],
        },
    )
    assert resp.status_code == 400, resp.text
    assert (
        "sankey needs source, target and values of equal length"
        in resp.json()["detail"]
    )


def test_indicator_style_key_on_a_bar_is_400(client):
    payload = x_only_manifest("barstyle")
    payload["traces"][0]["gauge"] = {"axis": {"range": [0, 10]}}

    resp = client.post("/api/v1/chart/custom", json=payload)
    assert resp.status_code == 400
    detail = resp.json()["detail"]
    assert isinstance(detail, str)
    assert "only allowed on the 'indicator' trace type" in detail


# ---------------------------------------------------------------------------
# 5. Unknown custom id -> 422 from the ChartEncoding validator
# ---------------------------------------------------------------------------

def test_unknown_custom_id_is_422_not_500(client, dumbbell_dataset):
    resp = preview(
        client,
        dumbbell_dataset,
        {
            "chartType": "ghostchart",
            "x": {"field": "city", "type": "nominal"},
            "yFields": [{"field": "start", "type": "quantitative"}],
        },
    )
    assert resp.status_code == 422
    assert "unknown chart type" in resp.text


# ---------------------------------------------------------------------------
# 6. Options round-trip: extra keys reach $opt slots in the traces
# ---------------------------------------------------------------------------

def test_chart_options_keeps_unknown_keys_and_camel_aliases():
    from backend.models.chart import ChartOptions

    options = ChartOptions(**{"gaugeMin": 1, "connector": "#fff"})
    dumped = options.model_dump(by_alias=True)
    assert dumped["connector"] == "#fff"  # extra key survives by_alias dumping
    assert dumped["gaugeMin"] == 1  # known field still resolves via its alias
    assert ChartOptions(gauge_min=2).model_dump(by_alias=True)["gaugeMin"] == 2


def test_options_roundtrip_reaches_opt_slots(client, dumbbell_dataset, charts_dir):
    save(client)

    resp = preview(
        client,
        dumbbell_dataset,
        dumbbell_encoding(options={"connector": "#123456", "width": 5}),
    )
    assert resp.status_code == 200, resp.text
    figure = resp.json()
    # segments render as layout shapes (line connectors), not as traces.
    shapes = figure["layout"]["shapes"]
    assert shapes, "the connector must be emitted as layout shapes"
    # Proves extra="allow" -> Options.model_extra -> $opt.connector/$opt.width
    # on every connector: one shape per row, all carrying the override.
    assert shapes[0]["line"] == {"color": "#123456", "width": 5}
    assert {shape["line"]["color"] for shape in shapes} == {"#123456"}
    assert all(shape["line"]["width"] == 5 for shape in shapes)


# ---------------------------------------------------------------------------
# 7. Chart agent: custom ids + yFields requirement derived from the manifest
# ---------------------------------------------------------------------------

def test_chart_agent_accepts_custom_ids_with_derived_yfield_rules(charts_dir):
    cc.save_manifest(manifest_payload())
    cc.save_manifest(manifest_payload("lollipop"))
    df = pd.DataFrame({"city": ["A", "B"], "start": [1.0, 2.0], "end": [3.0, 4.0]})

    cfg = {
        "chartType": "dumbbell",
        "encoding": {
            "x": {"field": "city", "type": "nominal"},
            "yFields": [
                {"field": "start", "type": "quantitative"},
                {"field": "end", "type": "quantitative"},
            ],
        },
    }
    assert chart_agent.validate_encoding(df, cfg) == []

    unknown = chart_agent.validate_encoding(df, {**cfg, "chartType": "whatever_unknown"})
    assert len(unknown) == 1
    assert "whatever_unknown" in unknown[0]
    assert "built-in" in unknown[0]
    assert "custom chart" in unknown[0]

    # dumbbell declares yFields.mode="range": one y field is not enough.
    one_yfield = json.loads(json.dumps(cfg))
    one_yfield["encoding"]["yFields"] = one_yfield["encoding"]["yFields"][:1]
    errors = chart_agent.validate_encoding(df, one_yfield)
    assert any("at least 2 entries" in error for error in errors)

    # lollipop declares yFields.mode="one": it needs one, not two.
    lollipop = {
        "chartType": "lollipop",
        "encoding": {"x": {"field": "city", "type": "nominal"}, "yFields": []},
    }
    assert any(
        "at least 1 entry" in error
        for error in chart_agent.validate_encoding(df, lollipop)
    )


def test_custom_request_degrades_without_crashing(charts_dir, monkeypatch):
    cc.save_manifest(manifest_payload())
    df = pd.DataFrame(
        {
            "city": ["A", "B"],
            "start": [1.0, 2.0],
            "end": [3.0, 4.0],
            "value": [5.0, 6.0],
        }
    )
    monkeypatch.setattr(
        chart_agent,
        "chat",
        lambda *args, **kwargs: (_ for _ in ()).throw(RuntimeError("down")),
    )
    result = chart_agent.build_chart_config(df, "画个哑铃图")
    assert result is not None
    assert result["degraded"] is True
    # Custom charts are not retargetable in v1: the recommendation survives
    # untouched instead of producing a broken custom encoding.
    assert result["chartType"] in chart_agent.CHART_TYPES


# ---------------------------------------------------------------------------
# 8. Keyword detection: custom keywords merge with the registry rules
# ---------------------------------------------------------------------------

def test_detect_requested_chart_type_merges_custom_keywords(charts_dir):
    assert chart_agent.detect_requested_chart_type("画个哑铃图") is None

    cc.save_manifest(manifest_payload())
    assert chart_agent.detect_requested_chart_type("画个哑铃图") == "dumbbell"
    assert chart_agent.detect_requested_chart_type("dumbbell chart please") == "dumbbell"
    # First mention wins across both sources: 柱状图(1) beats 哑铃图(6)...
    assert chart_agent.detect_requested_chart_type("用柱状图改成哑铃图") == "bar"
    # ...and the reverse order picks the custom chart.
    assert chart_agent.detect_requested_chart_type("用哑铃图改成柱状图") == "dumbbell"


def test_prompt_summarises_custom_types_only_when_manifests_exist(charts_dir):
    df = pd.DataFrame({"city": ["A"], "start": [1.0], "end": [2.0]})
    baseline = chart_agent._build_prompt(df, "draw something", None)
    assert "Custom chart types:" not in baseline
    # No custom charts -> the prompt is byte-identical to the previous build.
    assert chart_agent._build_prompt(df, "draw something", None) == baseline

    cc.save_manifest(manifest_payload())
    cc.save_manifest(manifest_payload("lollipop"))
    prompt = chart_agent._build_prompt(df, "draw something", None)
    lines = [
        line for line in prompt.splitlines() if line.startswith("Custom chart types:")
    ]
    assert lines == [
        "Custom chart types: dumbbell (x, yFields×2), lollipop (x, yFields×1)"
    ]
    # The rest of the prompt is unchanged: exactly one line was inserted.
    assert prompt.replace(lines[0] + "\n", "") == baseline


# ---------------------------------------------------------------------------
# 9. Sampling invariant: the manifest's transforms decide, not the chart type
# ---------------------------------------------------------------------------

def test_sampling_applies_only_to_samplable_custom_manifests(
    client, monkeypatch, charts_dir
):
    rows = "\n".join(f"c{i:02d},{i},{i + 12}" for i in range(1, 13))
    dataset_id = import_csv(client, f"city,start,end\n{rows}\n", "many.csv")
    monkeypatch.setenv("METRICSTUDIO_CHART_MAX_POINTS", "5")
    save(client)
    save(client, "lollipop")

    # lollipop has no row-semantic transform -> sampled, count recorded.
    sampled = preview(client, dataset_id, lollipop_encoding())
    assert sampled.status_code == 200, sampled.text
    figure = sampled.json()
    assert figure["layout"]["meta"]["sampled"] == {"total": 12, "shown": 5, "max": 5}
    assert len(figure["data"][0]["x"]) == 5  # the stem trace carries the sample

    # dumbbell's `limit` transform changes row semantics -> never sampled.
    unsampled = preview(client, dataset_id, dumbbell_encoding())
    assert unsampled.status_code == 200, unsampled.text
    figure = unsampled.json()
    assert "meta" not in figure["layout"]
    assert len(figure["data"][1]["x"]) == 12


# ---------------------------------------------------------------------------
# 10. Hostile/corrupt files stay per-file failures, never endpoint failures
# ---------------------------------------------------------------------------

def test_deeply_nested_manifest_is_invalid_not_fatal(
    client, dumbbell_dataset, charts_dir
):
    save(client)
    # ~100 KB of nested arrays: json.loads raises RecursionError on this shape,
    # which the core must convert into an invalid entry (not an exception).
    deep = charts_dir / "deep.json"
    deep.write_text("[" * 50000 + "]" * 50000, encoding="utf-8")
    cc._invalidate_cache()

    resp = client.get("/api/v1/chart/custom")
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert [item["id"] for item in body["items"]] == ["dumbbell"]
    [bad] = body["invalid"]
    assert bad["file"] == str(deep)
    assert bad["errors"], "the unusable file must carry a reason"

    # The valid manifest beside it is unaffected: listed and previewable.
    figure = preview(client, dumbbell_dataset, dumbbell_encoding())
    assert figure.status_code == 200, figure.text
    assert figure.json()["data"]


# ---------------------------------------------------------------------------
# 11. Gauge clamp: a pinned lower bound is never overridden
# ---------------------------------------------------------------------------

def test_gauge_both_bounds_pinned_keeps_lower_bound(client):
    dataset_id = import_csv(client, "value\n10\n20\n30\n", "gauge.csv")
    resp = preview(
        client,
        dataset_id,
        {
            "chartType": "gauge",
            "yFields": [{"field": "value", "type": "quantitative"}],
            # Inverted user range: [200, 100]. The clamp must keep gaugeMin
            # pinned and expand gaugeMax instead of moving the user's lower bound.
            "options": {"gaugeMin": 200, "gaugeMax": 100},
        },
    )
    assert resp.status_code == 200, resp.text
    lo, hi = resp.json()["data"][0]["gauge"]["axis"]["range"]
    assert (lo, hi) == (200.0, 201.0)
    assert lo == 200.0  # the user's gaugeMin survived the clamp
