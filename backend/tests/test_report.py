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
    assert "洞察" in doc  # insights section included
    assert "注释" in doc and "Draft notes" in doc
    assert "dirty.csv" in doc  # dataset meta
    assert "Plotly.newPlot('chart-0'" in doc


def test_generate_report_uses_requested_locale(client, dirty_dataset):
    resp = client.post(
        "/api/v1/report/generate",
        json={
            "title": "English report",
            "dataset_id": dirty_dataset["id"],
            "charts": [],
            "notes": "A note",
            "include_insights": True,
            "locale": "en",
        },
    )
    assert resp.status_code == 200, resp.text
    doc = resp.json()["html"]
    assert '<html lang="en">' in doc
    assert "Insights" in doc and "Notes" in doc
    assert "rows" in doc and "cols" in doc and "engine" in doc
    assert "mean" in doc or "missing values" in doc or "of rows" in doc
    assert "洞察" not in doc and "注释" not in doc
    assert "均值" not in doc and "缺失值" not in doc and "的行属于" not in doc


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
    assert "洞察" not in doc
    assert "<section><h2>注释</h2>" not in doc
    assert '<html lang="zh">' in doc


def test_generate_report_includes_kpis_and_text_cards(client):
    resp = client.post(
        "/api/v1/report/generate",
        json={
            "title": "Dashboard",
            "charts": [],
            "kpis": [{"label": "Revenue", "value": "270", "detail": "sum · value"}],
            "text_cards": [{"text": "North region only"}],
            "notes": "",
            "include_insights": False,
        },
    )
    assert resp.status_code == 200, resp.text
    doc = resp.json()["html"]
    assert "关键指标" in doc
    assert "Revenue" in doc and "270" in doc and "sum · value" in doc
    assert "North region only" in doc


def test_report_escapes_script_end_tags_in_figure_json(client):
    attack = "</script><script>alert(1)</script>"
    resp = client.post(
        "/api/v1/report/generate",
        json={
            "title": "Safe chart",
            "charts": [{"name": "Chart", "figure": {"data": [{"x": [attack], "y": [1]}], "layout": {}}}],
            "notes": "",
            "include_insights": False,
        },
    )
    assert resp.status_code == 200
    doc = resp.json()["html"]
    assert attack not in doc
    assert "\\u003c/script\\u003e" in doc


def test_report_escapes_kpis_and_text_cards(client):
    malicious = "<img src=x onerror=alert(1)>"
    resp = client.post(
        "/api/v1/report/generate",
        json={
            "title": "Safe",
            "charts": [],
            "kpis": [{"label": malicious, "value": malicious, "detail": malicious}],
            "text_cards": [{"text": malicious}],
            "notes": "",
            "include_insights": False,
        },
    )
    assert resp.status_code == 200
    doc = resp.json()["html"]
    assert malicious not in doc
    assert "&lt;img" in doc


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


def test_generate_report_records_filters_and_generated_at(client, dirty_dataset):
    resp = client.post(
        "/api/v1/report/generate",
        json={
            "title": "Filtered export",
            "charts": [],
            "filter_descriptions": ["region: North, South", "value: 10 ~ 100"],
            "notes": "",
            "include_insights": False,
            "locale": "en",
        },
    )
    assert resp.status_code == 200, resp.text
    doc = resp.json()["html"]
    assert "Filters" in doc
    assert "region: North, South" in doc
    assert "value: 10 ~ 100" in doc
    assert "Generated at:" in doc
    # Malicious filter text is escaped like every other user content.
    attack_resp = client.post(
        "/api/v1/report/generate",
        json={
            "title": "Escape filters",
            "charts": [],
            "filter_descriptions": ["<script>alert(1)</script>"],
            "notes": "",
            "include_insights": False,
        },
    )
    assert attack_resp.status_code == 200
    assert "<script>alert(1)</script>" not in attack_resp.json()["html"]

    omitted = client.post(
        "/api/v1/report/generate",
        json={"title": "No filters", "charts": [], "notes": "", "include_insights": False},
    )
    assert "Filters" not in omitted.json()["html"]
