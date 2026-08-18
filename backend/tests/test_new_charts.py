"""Tests for the newly added chart types (candlestick / surface / timeline)."""


def _import(client, csv):
    resp = client.post("/api/v1/data/import", files={"file": ("t.csv", csv.encode(), "text/csv")})
    assert resp.status_code == 200, resp.text
    return resp.json()[0]["id"]


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
