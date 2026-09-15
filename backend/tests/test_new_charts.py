"""Tests for the newly added chart types (candlestick / surface / timeline)."""


def _import(client, csv):
    resp = client.post("/api/v1/data/import", files={"file": ("t.csv", csv.encode(), "text/csv")})
    assert resp.status_code == 200, resp.text
    return resp.json()[0]["id"]


def test_density_heatmap_drops_null_rows(client):
    """NaN/null in x or y must be dropped before histogram2d binning
    (null values crash plotly's createImageData) — v1.7.1 parity fix."""
    csv = "x,y\n1,10\n2,\n3,30\n,40\nabc,50\n4,60\n"
    dsid = _import(client, csv)
    for chart_type in ("density_heatmap", "density_contour"):
        encoding = {
            "chartType": chart_type,
            "x": {"field": "x", "type": "quantitative"},
            "yFields": [{"field": "y", "type": "quantitative"}],
        }
        resp = client.post("/api/v1/chart/preview", json={"dataset_id": dsid, "encoding": encoding})
        assert resp.status_code == 200, resp.text
        data = resp.json()["data"]
        assert data, "expected a density trace for rows with clean values"
        trace = data[0]
        assert all(v is not None for v in trace["x"]), "x must not contain nulls"
        assert all(v is not None for v in trace["y"]), "y must not contain nulls"
        assert trace["x"] == [1.0, 3.0, 4.0]
        assert trace["y"] == [10.0, 30.0, 60.0]


def test_density_heatmap_all_null_returns_empty(client):
    csv = "x,y\n1,\n2,\n"
    dsid = _import(client, csv)
    encoding = {
        "chartType": "density_heatmap",
        "x": {"field": "x", "type": "quantitative"},
        "yFields": [{"field": "y", "type": "quantitative"}],
    }
    resp = client.post("/api/v1/chart/preview", json={"dataset_id": dsid, "encoding": encoding})
    assert resp.status_code == 200, resp.text
    assert resp.json()["data"] == []


def test_candlestick(client):
    csv = """date,open,high,low,close
2024-01-01,100,110,90,105
2024-01-02,105,115,95,108
2024-01-03,108,120,100,115
"""
    dsid = _import(client, csv)
    encoding = {
        "chartType": "candlestick",
        "x": {"field": "date", "type": "temporal"},
        "yFields": [],
        "options": {"openField": "open", "highField": "high", "lowField": "low", "closeField": "close"},
    }
    resp = client.post("/api/v1/chart/preview", json={"dataset_id": dsid, "encoding": encoding})
    assert resp.status_code == 200, resp.text
    trace = resp.json()["data"][0]
    assert trace["type"] == "candlestick"
    assert trace["open"] == [100, 105, 108]
    assert trace["close"] == [105, 108, 115]


def test_candlestick_uses_default_ohlc_column_names(client):
    csv = """date,open,high,low,close
2024-01-01,100,110,90,105
"""
    dsid = _import(client, csv)
    encoding = {
        "chartType": "candlestick",
        "x": {"field": "date", "type": "temporal"},
        "yFields": [],
    }
    resp = client.post("/api/v1/chart/preview", json={"dataset_id": dsid, "encoding": encoding})
    assert resp.status_code == 200, resp.text
    trace = resp.json()["data"][0]
    assert trace["open"] == [100]
    assert trace["high"] == [110]
    assert trace["low"] == [90]
    assert trace["close"] == [105]


def test_surface(client):
    csv = """x,y,z
1,a,10
2,a,20
1,b,30
2,b,40
"""
    dsid = _import(client, csv)
    encoding = {
        "chartType": "surface",
        "x": {"field": "x", "type": "quantitative"},
        "yFields": [{"field": "y", "type": "nominal", "axis": "left", "normalize": "none"}],
        "z": {"field": "z", "type": "quantitative"},
    }
    resp = client.post("/api/v1/chart/preview", json={"dataset_id": dsid, "encoding": encoding})
    assert resp.status_code == 200, resp.text
    trace = resp.json()["data"][0]
    assert trace["type"] == "surface"
    assert len(trace["z"]) == 2  # 2 rows (a, b)


def test_timeline(client):
    csv = """date,event
2024-01-01,start
2024-02-01,milestone
2024-03-01,launch
"""
    dsid = _import(client, csv)
    encoding = {
        "chartType": "timeline",
        "x": {"field": "date", "type": "temporal"},
        "yFields": [{"field": "event", "type": "nominal", "axis": "left", "normalize": "none"}],
    }
    resp = client.post("/api/v1/chart/preview", json={"dataset_id": dsid, "encoding": encoding})
    assert resp.status_code == 200, resp.text
    trace = resp.json()["data"][0]
    assert trace["type"] == "scatter"
    assert trace["mode"] == "markers"
    assert trace["y"] == ["start", "milestone", "launch"]
