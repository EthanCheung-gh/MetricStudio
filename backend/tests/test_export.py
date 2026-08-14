"""Tests for dataset export (CSV / Parquet)."""

import io

import pandas as pd


def test_export_csv(client):
    csv = "a,b\n1,10\n2,20\n"
    resp = client.post("/api/v1/data/import", files={"file": ("t.csv", csv.encode(), "text/csv")})
    dsid = resp.json()[0]["id"]

    resp = client.get(f"/api/v1/data/{dsid}/export", params={"format": "csv"})
    assert resp.status_code == 200
    assert "text/csv" in resp.headers["content-type"]
    df = pd.read_csv(io.StringIO(resp.text))
    assert df["a"].tolist() == [1, 2]
    assert df["b"].tolist() == [10, 20]


def test_export_parquet(client):
    csv = "a,b\n1,10\n2,20\n"
    resp = client.post("/api/v1/data/import", files={"file": ("t.csv", csv.encode(), "text/csv")})
    dsid = resp.json()[0]["id"]

    resp = client.get(f"/api/v1/data/{dsid}/export", params={"format": "parquet"})
    assert resp.status_code == 200
    df = pd.read_parquet(io.BytesIO(resp.content))
    assert df["a"].tolist() == [1, 2]


def test_export_reflects_transforms(client):
    csv = "a,b\n1,10\n2,20\n3,30\n"
    resp = client.post("/api/v1/data/import", files={"file": ("t.csv", csv.encode(), "text/csv")})
    dsid = resp.json()[0]["id"]

    # filter a > 1, then export -> 2 rows
    client.post(f"/api/v1/transform/{dsid}/filter", json={"column": "a", "operator": "gt", "value": 1})
    resp = client.get(f"/api/v1/data/{dsid}/export", params={"format": "csv"})
    df = pd.read_csv(io.StringIO(resp.text))
    assert len(df) == 2


def test_export_invalid_format(client):
    csv = "a\n1\n"
    resp = client.post("/api/v1/data/import", files={"file": ("t.csv", csv.encode(), "text/csv")})
    dsid = resp.json()[0]["id"]
    resp = client.get(f"/api/v1/data/{dsid}/export", params={"format": "json"})
    assert resp.status_code == 400
