"""Datasets expose their origin (sourceType) in list metadata."""

from __future__ import annotations

import sqlite3


def _import_csv(client, name: str = "t.csv") -> dict:
    csv = "name,value\na,10\nb,20\n"
    resp = client.post("/api/v1/data/import", files={"file": (name, csv.encode(), "text/csv")})
    assert resp.status_code == 200, resp.text
    return resp.json()[0]


def test_csv_import_reports_source_type(client):
    meta = _import_csv(client)
    assert meta["sourceType"] == "csv"


def test_pasted_text_reports_paste(client):
    resp = client.post("/api/v1/data/import-text", json={"name": "pasted", "text": "a,b\n1,2\n"})
    assert resp.status_code == 200, resp.text
    assert resp.json()[0]["sourceType"] == "paste"


def test_sqlite_table_reports_sqlite(client, tmp_path):
    path = tmp_path / "source.db"
    with sqlite3.connect(path) as connection:
        connection.execute("CREATE TABLE t (id INTEGER, v TEXT)")
        connection.execute("INSERT INTO t VALUES (1, 'x')")
    resp = client.post(
        "/api/v1/sql/import",
        json={"engine": "sqlite", "path": str(path), "table": "t", "name": "from-db"},
    )
    assert resp.status_code == 200, resp.text
    assert resp.json()["sourceType"] == "sqlite"


def test_sql_result_reports_sql(client, tmp_path):
    path = tmp_path / "result.db"
    with sqlite3.connect(path) as connection:
        connection.execute("CREATE TABLE t (id INTEGER)")
        connection.execute("INSERT INTO t VALUES (1)")
    imported = client.post(
        "/api/v1/sql/import",
        json={"engine": "sqlite", "path": str(path), "table": "t", "name": "origin"},
    )
    assert imported.status_code == 200, imported.text
    schema = client.get("/api/v1/sql/workbench/schema").json()
    table = next(t["table"] for t in schema["tables"] if t["dataset"] == "origin")
    run = client.post("/api/v1/sql/workbench/query", json={"sql": f"SELECT * FROM {table}"})
    assert run.status_code == 200, run.text
    resp = client.post("/api/v1/sql/workbench/import-result", json={"name": "query output"})
    assert resp.status_code == 200, resp.text
    assert resp.json()["sourceType"] == "sql"


def test_snapshot_restore_reports_snapshot(client):
    dataset = _import_csv(client, "snap.csv")
    snap = client.post(f"/api/v1/data/{dataset['id']}/snapshots", json={"name": "original"}).json()
    resp = client.post(f"/api/v1/snapshots/{snap['id']}/restore", json={"name": "restored"})
    assert resp.status_code == 200, resp.text
    assert resp.json()["sourceType"] == "snapshot"


def test_source_type_survives_restart(client, monkeypatch):
    """The origin tag is persisted and restored with the dataset."""
    from backend.core.session import SessionManager

    meta = _import_csv(client)
    session = SessionManager()
    restored = session.restore()
    assert restored >= 1
    assert session.get(meta["id"]).source_type == "csv"
