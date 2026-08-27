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


def test_timeseries_workbench_fields(client):
    """Moving average, anomalies, and forecast ride along with the base result."""
    rows = ["date,value"]
    for month in range(1, 11):
        value = 100 + month * 10
        if month == 5:
            value = 1000  # injected anomaly
        rows.append(f"2024-{month:02d}-01,{value}")
    csv = "\n".join(rows) + "\n"
    dsid = client.post(
        "/api/v1/data/import", files={"file": ("bench.csv", csv.encode(), "text/csv")}
    ).json()[0]["id"]

    body = client.get(f"/api/v1/data/{dsid}/timeseries", params={"column": "value"}).json()
    assert body["ok"] is True
    assert len(body["moving_average"]) == len(body["values"])
    assert body["moving_average"][0] == 110.0  # first window = single point
    # The flat trend makes the spike stand out against the moving average.
    assert body["anomaly_indexes"], "injected spike should be detected"
    assert 4 in body["anomaly_indexes"]  # zero-based index of month 5

    assert body["forecast_periods"] == ["2024-11", "2024-12", "2025-01"]
    assert len(body["forecast_values"]) == 3
    assert all(v >= 0 for v in body["forecast_values"])

    # Same-month comparison: none of the months have a year-ago pair yet.
    assert set(body["yoy_change"]) == {None}


def test_timeseries_yoy_matches_previous_year(client):
    csv = (
        "date,value\n"
        "2023-01-01,100\n2023-02-01,150\n"
        "2024-01-01,200\n2024-02-01,225\n"
    )
    dsid = client.post(
        "/api/v1/data/import", files={"file": ("yoy.csv", csv.encode(), "text/csv")}
    ).json()[0]["id"]
    body = client.get(f"/api/v1/data/{dsid}/timeseries", params={"column": "value"}).json()

    yoy = dict(zip(body["periods"], body["yoy_change"]))
    assert yoy["2023-01"] is None
    assert yoy["2024-01"] == 100.0  # 100 -> 200
    assert yoy["2024-02"] == 50.0   # 150 -> 225
