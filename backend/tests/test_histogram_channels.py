"""histogram advertises (x, color) in the registry — both channels must be real.

Regression guard for the registry refactor: before this, `{'x': cat}` and
`{'color': cat2}` produced byte-identical figures, so the EncodingPanel controls
and AI configs carrying them changed nothing.
"""

from backend.core.chart_agent import retarget_recommendation

CSV = """value,cat,cat2
1,A,g1
2,B,g1
3,A,g2
4,B,g2
5,A,g1
6,B,g2
"""


def _import(client, csv):
    resp = client.post("/api/v1/data/import", files={"file": ("t.csv", csv.encode(), "text/csv")})
    assert resp.status_code == 200, resp.text
    return resp.json()[0]["id"]


def _preview(client, dsid, encoding):
    resp = client.post("/api/v1/chart/preview", json={"dataset_id": dsid, "encoding": encoding})
    assert resp.status_code == 200, resp.text
    return resp.json()


def test_color_splits_into_overlaid_traces(client):
    dsid = _import(client, CSV)
    body = _preview(client, dsid, {
        "chartType": "histogram",
        "color": {"field": "cat", "type": "nominal"},
        "yFields": [{"field": "value", "type": "quantitative"}],
    })
    data = body["data"]
    assert len(data) >= 2, "each color value gets its own histogram trace"
    for trace in data:
        assert trace["type"] == "histogram"
        assert "name" in trace and trace["name"], "traces must be legend-identifiable"
    assert body["layout"]["barmode"] == "overlay"
    assert body["layout"]["showlegend"] is True


def test_x_only_histogram_bins_the_x_column(client):
    """No yFields: x is the value channel, so the chart is not empty."""
    dsid = _import(client, CSV)
    body = _preview(client, dsid, {
        "chartType": "histogram",
        "x": {"field": "value", "type": "quantitative"},
        "yFields": [],
    })
    data = body["data"]
    assert data, "an x-only histogram must render"
    assert len(data) == 1
    assert sorted(data[0]["x"]) == [1.0, 2.0, 3.0, 4.0, 5.0, 6.0]


def test_no_color_yfields_keeps_single_trace_shape(client):
    """Byte-identical guard: the plain path stays one unnamed trace, no barmode."""
    dsid = _import(client, CSV)
    body = _preview(client, dsid, {
        "chartType": "histogram",
        "yFields": [{"field": "value", "type": "quantitative"}],
    })
    data = body["data"]
    assert len(data) == 1
    assert "name" not in data[0]
    assert "barmode" not in body["layout"]
    assert body["layout"]["yaxis"]["title"] == "value"
    assert data[0]["x"] == [1.0, 2.0, 3.0, 4.0, 5.0, 6.0]


def test_color_on_missing_column_is_ignored(client):
    dsid = _import(client, CSV)
    body = _preview(client, dsid, {
        "chartType": "histogram",
        "color": {"field": "nope", "type": "nominal"},
        "yFields": [{"field": "value", "type": "quantitative"}],
    })
    assert len(body["data"]) == 1
    assert "barmode" not in body["layout"]


def test_retarget_recommendation_covers_the_relational_family_plus_histogram():
    for chart_id in ("pie", "bar", "barh", "line", "area", "step", "scatter", "dot", "histogram"):
        encoding = {"chartType": "bar", "x": {"field": "cat", "type": "nominal"}}
        retarget_recommendation(encoding, chart_id)
        assert encoding["chartType"] == chart_id
        if chart_id == "pie":
            assert encoding["color"] == {"field": "cat", "type": "nominal"}

    exotic = {"chartType": "bar", "x": {"field": "cat", "type": "nominal"}}
    retarget_recommendation(exotic, "sankey")
    assert exotic["chartType"] == "bar"
    assert exotic["x"] == {"field": "cat", "type": "nominal"}
