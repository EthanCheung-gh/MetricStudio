"""Tests for the gauge chart type (registry-dispatched _build_gauge)."""


def _import(client, csv):
    resp = client.post("/api/v1/data/import", files={"file": ("t.csv", csv.encode(), "text/csv")})
    assert resp.status_code == 200, resp.text
    return resp.json()[0]["id"]


def _preview(client, dsid, encoding):
    resp = client.post("/api/v1/chart/preview", json={"dataset_id": dsid, "encoding": encoding})
    assert resp.status_code == 200, resp.text
    return resp.json()


def test_gauge_sums_y_field_and_defaults_axis_range(client):
    dsid = _import(client, "value\n10\n20\n30\n")
    figure = _preview(client, dsid, {
        "chartType": "gauge",
        "yFields": [{"field": "value", "type": "quantitative"}],
    })
    trace = figure["data"][0]
    assert trace["type"] == "indicator"
    assert trace["mode"] == "gauge+number"
    assert trace["value"] == 60.0
    assert trace["gauge"]["axis"]["range"] == [0.0, 75.0]


def test_gauge_count_aggregate_counts_non_null_rows(client):
    dsid = _import(client, "cat,value\nA,10\nB,20\nC,\n")
    figure = _preview(client, dsid, {
        "chartType": "gauge",
        "yFields": [{"field": "value", "type": "quantitative", "aggregate": "count"}],
    })
    assert figure["data"][0]["value"] == 2.0


def test_gauge_count_aggregate_works_on_text_columns(client):
    """count needs no numeric values — every column is offered to yFields."""
    dsid = _import(client, "cat,value\nA,10\nB,20\nC,30\nD,40\n")
    figure = _preview(client, dsid, {
        "chartType": "gauge",
        "yFields": [{"field": "cat", "type": "nominal", "aggregate": "count"}],
    })
    assert figure["data"][0]["value"] == 4.0
    assert figure["data"][0]["gauge"]["axis"]["range"] == [0.0, 5.0]


def test_gauge_count_aggregate_over_all_null_column_is_zero(client):
    """An empty count is 0, not an empty figure (the dial still renders)."""
    dsid = _import(client, "value\n\n\n")
    figure = _preview(client, dsid, {
        "chartType": "gauge",
        "yFields": [{"field": "value", "type": "quantitative", "aggregate": "count"}],
    })
    trace = figure["data"][0]
    assert trace["value"] == 0.0
    assert trace["gauge"]["axis"]["range"] == [0.0, 1.0]


def test_gauge_sum_over_text_column_stays_empty(client):
    dsid = _import(client, "cat\nA\nB\n")
    figure = _preview(client, dsid, {
        "chartType": "gauge",
        "yFields": [{"field": "cat", "type": "nominal", "aggregate": "sum"}],
    })
    assert figure["data"] == []


def test_gauge_negative_value_keeps_the_value_inside_the_dial(client):
    dsid = _import(client, "value\n-100\n-50\n-25\n")
    figure = _preview(client, dsid, {
        "chartType": "gauge",
        "yFields": [{"field": "value", "type": "quantitative"}],
    })
    trace = figure["data"][0]
    lo, hi = trace["gauge"]["axis"]["range"]
    assert trace["value"] == -175.0
    assert lo < hi
    assert lo <= trace["value"] <= hi


def test_gauge_negative_value_with_only_max_keeps_the_value_inside(client):
    dsid = _import(client, "value\n-100\n-50\n-25\n")
    figure = _preview(client, dsid, {
        "chartType": "gauge",
        "yFields": [{"field": "value", "type": "quantitative"}],
        "options": {"gaugeMax": -100},
    })
    lo, hi = figure["data"][0]["gauge"]["axis"]["range"]
    assert (lo, hi) == (-218.75, -100.0)
    assert lo <= -175.0 <= hi


def test_gauge_absurd_max_still_yields_a_non_inverted_range(client):
    """A user bound is never overridden, but the derived side must not invert."""
    dsid = _import(client, "value\n-100\n-50\n-25\n")
    figure = _preview(client, dsid, {
        "chartType": "gauge",
        "yFields": [{"field": "value", "type": "quantitative"}],
        "options": {"gaugeMax": -1000},
    })
    lo, hi = figure["data"][0]["gauge"]["axis"]["range"]
    assert (lo, hi) == (-1001.0, -1000.0)


def test_gauge_positive_value_with_only_min(client):
    dsid = _import(client, "value\n10\n20\n30\n")
    figure = _preview(client, dsid, {
        "chartType": "gauge",
        "yFields": [{"field": "value", "type": "quantitative"}],
        "options": {"gaugeMin": 50},
    })
    lo, hi = figure["data"][0]["gauge"]["axis"]["range"]
    assert (lo, hi) == (50.0, 75.0)


def test_gauge_zero_value_gets_a_unit_range(client):
    dsid = _import(client, "value\n0\n0\n")
    figure = _preview(client, dsid, {
        "chartType": "gauge",
        "yFields": [{"field": "value", "type": "quantitative"}],
    })
    trace = figure["data"][0]
    assert trace["value"] == 0.0
    assert trace["gauge"]["axis"]["range"] == [0.0, 1.0]


def test_gauge_explicit_range_options(client):
    dsid = _import(client, "value\n10\n20\n30\n")
    figure = _preview(client, dsid, {
        "chartType": "gauge",
        "yFields": [{"field": "value", "type": "quantitative"}],
        "options": {"gaugeMin": 0, "gaugeMax": 200},
    })
    assert figure["data"][0]["gauge"]["axis"]["range"] == [0.0, 200.0]


def test_gauge_without_y_field_returns_empty_figure(client):
    dsid = _import(client, "value\n10\n20\n30\n")
    figure = _preview(client, dsid, {"chartType": "gauge", "yFields": []})
    assert figure["data"] == []
