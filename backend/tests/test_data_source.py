"""Tests for data source persistence + refresh."""

from backend.core.session import session


def test_import_persists_source_and_refresh_replays(client):
    csv = "date,value\n2024-01-01,100\n2024-02-01,200\n"
    resp = client.post("/api/v1/data/import", files={"file": ("src.csv", csv.encode(), "text/csv")})
    assert resp.status_code == 200, resp.text
    dsid = resp.json()[0]["id"]

    ds = session.get(dsid)
    assert dsid in session.sources, "source metadata should be recorded"
    source_path = session.sources[dsid]["path"]
    assert source_path and source_path.endswith(".csv")

    # apply a transform (filter value > 100) then refresh
    client.post(f"/api/v1/transform/{dsid}/filter", json={"column": "value", "operator": "gt", "value": 100})
    assert session.get(dsid).meta.rows == 1

    resp = client.post(f"/api/v1/data/{dsid}/refresh")
    assert resp.status_code == 200, resp.text
    meta = resp.json()
    # filter replayed: still 1 row (value > 100)
    assert meta["rows"] == 1


def test_refresh_reapplies_history(client):
    csv = "name,value\na,10\nb,20\nc,30\n"
    resp = client.post("/api/v1/data/import", files={"file": ("s2.csv", csv.encode(), "text/csv")})
    dsid = resp.json()[0]["id"]

    # dedupe then refresh: history replayed (no error, meta intact)
    client.post(f"/api/v1/transform/{dsid}/recipe/dedupe")
    resp = client.post(f"/api/v1/data/{dsid}/refresh")
    assert resp.status_code == 200, resp.text


def test_refresh_missing_source(client):
    csv = "a\n1\n2\n"
    resp = client.post("/api/v1/data/import", files={"file": ("s3.csv", csv.encode(), "text/csv")})
    dsid = resp.json()[0]["id"]

    # delete the source file to simulate missing source
    source_path = session.sources[dsid]["path"]
    import os

    os.remove(source_path)

    resp = client.post(f"/api/v1/data/{dsid}/refresh")
    assert resp.status_code == 400, resp.text
    assert "missing" in resp.json()["detail"].lower()


def test_refresh_unknown_dataset(client):
    resp = client.post("/api/v1/data/nope/refresh")
    assert resp.status_code == 404
