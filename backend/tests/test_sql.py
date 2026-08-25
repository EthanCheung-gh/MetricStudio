"""Tests for SQL (SQLite) data source import."""

import sqlite3


def _make_db(tmp_path):
    path = tmp_path / "test.db"
    conn = sqlite3.connect(str(path))
    conn.execute("CREATE TABLE sales (id INTEGER, region TEXT, value REAL)")
    conn.executemany(
        "INSERT INTO sales VALUES (?, ?, ?)",
        [(1, "North", 100.0), (2, "South", 200.0), (3, "North", 150.0)],
    )
    conn.commit()
    conn.close()
    return str(path)


def test_upload_database(client, tmp_path):
    path = _make_db(tmp_path)
    with open(path, "rb") as database:
        resp = client.post(
            "/api/v1/sql/upload",
            files={"file": ("uploaded.sqlite", database, "application/octet-stream")},
        )
    assert resp.status_code == 200, resp.text
    uploaded_path = resp.json()["path"]
    tables = client.post("/api/v1/sql/tables", json={"engine": "sqlite", "path": uploaded_path})
    assert tables.status_code == 200, tables.text
    assert "sales" in tables.json()["tables"]


def test_list_tables(client, tmp_path):
    path = _make_db(tmp_path)
    resp = client.post("/api/v1/sql/tables", json={"engine": "sqlite", "path": path})
    assert resp.status_code == 200, resp.text
    assert "sales" in resp.json()["tables"]


def test_import_table(client, tmp_path):
    path = _make_db(tmp_path)
    resp = client.post("/api/v1/sql/import", json={"engine": "sqlite", "path": path, "table": "sales"})
    assert resp.status_code == 200, resp.text
    meta = resp.json()
    assert meta["rows"] == 3
    assert meta["cols"] == 3

    # imported dataset is queryable via the normal data API
    dsid = meta["id"]
    preview = client.get(f"/api/v1/data/{dsid}/preview?limit=10").json()
    assert preview["totalRows"] == 3


def test_import_missing_table(client, tmp_path):
    path = _make_db(tmp_path)
    resp = client.post("/api/v1/sql/import", json={"engine": "sqlite", "path": path, "table": "nope"})
    assert resp.status_code == 400
