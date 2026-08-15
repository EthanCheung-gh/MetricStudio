"""Tests for time-series analysis."""


def test_timeseries_pct_change(client):
    csv = "date,value\n2024-01-01,100\n2024-02-01,200\n2024-03-01,300\n"
    resp = client.post("/api/v1/data/import", files={"file": ("t.csv", csv.encode(), "text/csv")})
    dsid = resp.json()[0]["id"]

    resp = client.get(f"/api/v1/data/{dsid}/timeseries", params={"column": "value"})
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["ok"] is True
    assert body["values"] == [100.0, 200.0, 300.0]
    assert body["pct_change"] == [None, 100.0, 50.0]
    assert body["periods"] == ["2024-01", "2024-02", "2024-03"]


def test_timeseries_no_temporal(client):
    csv = "a,b\n1,10\n2,20\n"
    resp = client.post("/api/v1/data/import", files={"file": ("t.csv", csv.encode(), "text/csv")})
    dsid = resp.json()[0]["id"]
    resp = client.get(f"/api/v1/data/{dsid}/timeseries", params={"column": "a"})
    assert resp.status_code == 200
    assert resp.json()["ok"] is False
