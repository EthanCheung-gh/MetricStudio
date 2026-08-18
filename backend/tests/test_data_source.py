"""Tests for data source persistence + refresh."""

from pathlib import Path

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


def test_import_path_detects_and_refreshes_original_file(client, tmp_path):
    source = tmp_path / "live.csv"
    source.write_text("name,value\na,10\n", encoding="utf-8")
    imported = client.post("/api/v1/data/import-path", json={"path": str(source)})
    assert imported.status_code == 200, imported.text
    dataset_id = imported.json()[0]["id"]

    source.write_text("name,value\na,10\nb,20\n", encoding="utf-8")
    statuses = client.get("/api/v1/data/sources/status").json()
    status = next(item for item in statuses if item["dataset_id"] == dataset_id)
    assert status["changed"] is True
    assert status["original_exists"] is True

    refreshed = client.post(f"/api/v1/data/{dataset_id}/refresh")
    assert refreshed.status_code == 200, refreshed.text
    assert refreshed.json()["rows"] == 2
    status = next(item for item in client.get("/api/v1/data/sources/status").json() if item["dataset_id"] == dataset_id)
    assert status["changed"] is False


def test_merged_excel_refresh_keeps_all_sheets(client, tmp_path):
    import pandas as pd

    path = tmp_path / "merged.xlsx"
    with pd.ExcelWriter(path, engine="openpyxl") as writer:
        pd.DataFrame({"value": [1, 2]}).to_excel(writer, sheet_name="one", index=False)
        pd.DataFrame({"value": [3, 4]}).to_excel(writer, sheet_name="two", index=False)
    imported = client.post(
        "/api/v1/data/import-path",
        json={"path": str(path), "merge_sheets": True},
    )
    dataset_id = imported.json()[0]["id"]
    refreshed = client.post(f"/api/v1/data/{dataset_id}/refresh")
    assert refreshed.status_code == 200, refreshed.text
    assert refreshed.json()["rows"] == 4


def test_sqlite_refresh_and_delete_preserve_original_database(client, tmp_path):
    import sqlite3

    path = tmp_path / "source.db"
    with sqlite3.connect(path) as connection:
        connection.execute("CREATE TABLE metrics (value INTEGER)")
        connection.execute("INSERT INTO metrics VALUES (10)")
    imported = client.post(
        "/api/v1/sql/import",
        json={"path": str(path), "table": "metrics"},
    )
    dataset_id = imported.json()["id"]
    with sqlite3.connect(path) as connection:
        connection.execute("INSERT INTO metrics VALUES (20)")
    status = next(item for item in client.get("/api/v1/data/sources/status").json() if item["dataset_id"] == dataset_id)
    assert status["changed"] is True
    refreshed = client.post(f"/api/v1/data/{dataset_id}/refresh")
    assert refreshed.status_code == 200, refreshed.text
    assert refreshed.json()["rows"] == 2
    client.delete(f"/api/v1/data/{dataset_id}")
    assert path.exists(), "deleting a dataset must never delete the user's SQLite database"


def test_pasted_dataset_is_not_refreshable(client):
    imported = client.post(
        "/api/v1/data/import-text",
        json={"name": "pasted", "text": "a\n1\n"},
    )
    dataset_id = imported.json()[0]["id"]
    status = next(item for item in client.get("/api/v1/data/sources/status").json() if item["dataset_id"] == dataset_id)
    assert status["refreshable"] is False


def test_refresh_unknown_dataset(client):
    resp = client.post("/api/v1/data/nope/refresh")
    assert resp.status_code == 404
