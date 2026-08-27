"""Statistical toolbox: correlation matrix + OLS regression endpoints."""


def _import(client, csv: str, name: str) -> str:
    response = client.post(
        "/api/v1/data/import",
        files={"file": (name, csv.encode(), "text/csv")},
    )
    assert response.status_code == 200, response.text
    return response.json()[0]["id"]


def test_correlation_matrix_detects_strong_pairs(client):
    csv = "a,b,noise\n1,2,7\n2,4,3\n3,6,9\n4,8,1\n5,10,5\n"
    dataset_id = _import(client, csv, "corr.csv")
    body = client.get(f"/api/v1/data/{dataset_id}/correlation").json()
    assert body["ok"] is True
    assert body["columns"] == ["a", "b", "noise"]
    # a and b are perfectly correlated
    top = body["pairs"][0]
    assert {top["x"], top["y"]} == {"a", "b"}
    assert top["r"] == 1.0
    # noise vs a/b should be below the notable threshold on this fixture
    assert all({"a", "b"} == {p["x"], p["y"]} for p in body["pairs"])


def test_correlation_matrix_handles_non_numeric_columns(client):
    csv = "name,value\nx,1\ny,2\nz,3\n"
    dataset_id = _import(client, csv, "mixed.csv")
    body = client.get(f"/api/v1/data/{dataset_id}/correlation").json()
    assert body["ok"] is False  # only one numeric column


def test_regression_interprets_significant_slope(client):
    csv = "spend,revenue\n10,105\n20,204\n30,296\n40,404\n50,495\n"
    dataset_id = _import(client, csv, "reg.csv")
    body = client.get(
        f"/api/v1/data/{dataset_id}/regression",
        params={"x": "spend", "y": "revenue"},
    ).json()
    assert body["ok"] is True
    assert body["n"] == 5
    assert 9.0 < body["slope"] < 10.0
    assert body["r_squared"] > 0.99
    assert body["p_value"] is not None and body["p_value"] < 0.05
    assert "正" in body["interpretation"]
    assert "R²" in body["interpretation"]


def test_regression_rejects_non_numeric_or_missing_columns(client):
    csv = "name,value\nx,1\ny,2\n"
    dataset_id = _import(client, csv, "bad.csv")
    for combo in ({"x": "value", "y": "missing"}, {"x": "name", "y": "value"}):
        response = client.get(f"/api/v1/data/{dataset_id}/regression", params=combo)
        assert response.status_code == 400


def test_regression_rejects_constant_x(client):
    csv = "a,b\n1,10\n1,20\n1,30\n"
    dataset_id = _import(client, csv, "const.csv")
    response = client.get(f"/api/v1/data/{dataset_id}/regression", params={"x": "a", "y": "b"})
    assert response.status_code == 400
