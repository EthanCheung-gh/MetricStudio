"""SQL workbench: read-only SELECT, plan, history, result snapshot."""


def _import(client, csv="a,b\n1,2\n3,4\n5,6\n", name="t.csv"):
    return client.post(
        "/api/v1/data/import", files={"file": (name, csv.encode(), "text/csv")}
    ).json()[0]


def _mirror_table(client):
    tables = client.get("/api/v1/sql/workbench/schema").json()["tables"]
    assert tables, "at least one dataset must be mirrored"
    return tables[-1]["table"]


def test_query_returns_rows_columns_and_plan(client):
    dataset = _import(client)
    table = _mirror_table(client)
    body = client.post(
        "/api/v1/sql/workbench/query",
        json={"sql": f"SELECT a, SUM(b) AS total FROM {table} GROUP BY a ORDER BY a"},
    ).json()
    assert body["columns"] == ["a", "total"]
    assert body["rows"] == [[1, 2], [3, 4], [5, 6]]
    assert body["rowCount"] == 3 and body["truncated"] is False
    assert any("GROUP BY" in step for step in body["plan"])


def test_query_rejects_mutations_and_multiple_statements(client):
    dataset = _import(client)
    table = _mirror_table(client)
    for sql in (
        f"DELETE FROM {table}",
        "PRAGMA database_list",
        f"SELECT * FROM sqlite_master; DROP TABLE {table}",
        "CREATE TABLE x(a int)",
        "ATTACH DATABASE 'x' AS y",
        "",
    ):
        response = client.post("/api/v1/sql/workbench/query", json={"sql": sql})
        assert response.status_code in (400, 408), f"{sql!r} should be rejected"
    # Dataset survives the rejected mutations.
    remaining = client.get(f"/api/v1/data/{dataset['id']}").status_code
    assert remaining == 200


def test_query_invalid_sql_reports_error(client):
    _import(client)
    response = client.post("/api/v1/sql/workbench/query", json={"sql": "SELECT nope FROM missing"})
    assert response.status_code == 400
    assert "SQL 执行失败" in response.json()["detail"]


def test_history_records_and_clears(client):
    _import(client)
    table = _mirror_table(client)
    client.post("/api/v1/sql/workbench/query", json={"sql": f"SELECT COUNT(*) FROM {table}"})
    history = client.get("/api/v1/sql/workbench/history").json()["history"]
    assert len(history) >= 1
    entry = history[0]
    assert "COUNT(*)" in entry["sql"]
    assert entry["rowCount"] >= 1

    cleared = client.delete("/api/v1/sql/workbench/history")
    assert cleared.status_code == 200
    assert client.get("/api/v1/sql/workbench/history").json()["history"] == []


def test_import_result_creates_dataset(client):
    _import(client)
    table = _mirror_table(client)
    query = client.post("/api/v1/sql/workbench/query", json={"sql": f"SELECT a * 10 AS ten_a FROM {table}"})
    assert query.status_code == 200

    imported = client.post("/api/v1/sql/workbench/import-result", json={"name": "Ten A"})
    assert imported.status_code == 200, imported.text
    meta = imported.json()
    assert meta["name"] == "Ten A"

    preview = client.get(f"/api/v1/data/{meta['id']}/preview")
    rows = [row[0] for row in preview.json()["rows"]]
    assert rows == [10, 30, 50]

    # Snapshot buffer consumed: importing again without a new query fails.
    again = client.post("/api/v1/sql/workbench/import-result", json={})
    assert again.status_code == 409
