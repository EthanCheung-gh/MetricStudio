"""Integration tests for the report generator."""

YV = [{"field": "value", "type": "quantitative", "axis": "left", "normalize": "none"}]


def _make_chart(client, dsid):
    resp = client.post(
        "/api/v1/chart/preview",
        json={
            "dataset_id": dsid,
            "encoding": {"chartType": "bar", "x": {"field": "category", "type": "nominal"}, "yFields": YV},
        },
    )
    assert resp.status_code == 200, resp.text
    return resp.json()


def test_generate_report_with_insights_and_charts(client, dirty_dataset):
    figure = _make_chart(client, dirty_dataset["id"])
    resp = client.post(
        "/api/v1/report/generate",
        json={
            "title": "Quarterly Analysis",
            "dataset_id": dirty_dataset["id"],
            "charts": [{"name": "Value by Category", "figure": figure}],
            "notes": "Draft notes\nline two",
            "include_insights": True,
        },
    )
    assert resp.status_code == 200, resp.text
    doc = resp.json()["html"]

    assert "<title>Quarterly Analysis</title>" in doc
    assert "cdn.plot.ly" in doc
    assert "Value by Category" in doc
    assert '"chartType"' in doc or '"type"' in doc  # embedded figure data
    assert "Insights" in doc  # insights section included
    assert "Notes" in doc and "Draft notes" in doc
    assert "dirty.csv" in doc  # dataset meta
    assert "Plotly.newPlot('chart-0'" in doc


def test_generate_report_without_insights_and_notes(client, dirty_dataset):
    figure = _make_chart(client, dirty_dataset["id"])
    resp = client.post(
        "/api/v1/report/generate",
        json={
            "title": "Minimal",
            "dataset_id": dirty_dataset["id"],
            "charts": [{"name": "Only Chart", "figure": figure}],
            "notes": "",
            "include_insights": False,
        },
    )
    assert resp.status_code == 200
    doc = resp.json()["html"]
    assert "Insights" not in doc
    assert "<section><h2>Notes</h2>" not in doc


def test_report_escapes_user_content(client, dirty_dataset):
    figure = _make_chart(client, dirty_dataset["id"])
    malicious = "<script>alert('xss')</script>"
    resp = client.post(
        "/api/v1/report/generate",
        json={
            "title": malicious,
            "dataset_id": dirty_dataset["id"],
            "charts": [],
            "notes": malicious,
            "include_insights": False,
        },
    )
    assert resp.status_code == 200
    doc = resp.json()["html"]
    assert "<script>alert('xss')</script>" not in doc  # escaped
    assert "&lt;script&gt;" in doc


def test_generate_report_unknown_dataset_404(client):
    resp = client.post(
        "/api/v1/report/generate",
        json={"title": "X", "dataset_id": "nope", "charts": [], "notes": ""},
    )
    assert resp.status_code == 404
