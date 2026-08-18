"""Tests for dataset diff."""


def test_diff(client):
    csv1 = "a,b\n1,10\n2,20\n"
    csv2 = "a,c\n1,30\n2,40\n3,50\n"
    r1 = client.post("/api/v1/data/import", files={"file": ("x.csv", csv1.encode(), "text/csv")})
    r2 = client.post("/api/v1/data/import", files={"file": ("y.csv", csv2.encode(), "text/csv")})
    id1 = r1.json()[0]["id"]
    id2 = r2.json()[0]["id"]

    resp = client.post("/api/v1/data/diff", json={"left_id": id1, "right_id": id2})
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["left_rows"] == 2
    assert body["right_rows"] == 3
    assert body["only_left"] == ["b"]
    assert body["only_right"] == ["c"]
    # common numeric column a: left mean 1.5 vs right mean 2.0
    assert body["numeric_diff"][0]["column"] == "a"
    assert body["numeric_diff"][0]["left_mean"] == 1.5
    assert body["numeric_diff"][0]["right_mean"] == 2.0


def test_diff_missing_dataset(client):
    resp = client.post("/api/v1/data/diff", json={"left_id": "nope", "right_id": "nope2"})
    assert resp.status_code == 404


def _import_with_history(client):
    csv = "a,b\n1,10\n2,20\n3,30\n"
    imported = client.post("/api/v1/data/import", files={"file": ("steps.csv", csv.encode(), "text/csv")})
    dataset_id = imported.json()[0]["id"]
    filtered = client.post(
        f"/api/v1/transform/{dataset_id}/filter",
        json={"column": "a", "operator": "gte", "value": 2},
    )
    assert filtered.status_code == 200, filtered.text
    renamed = client.post(
        f"/api/v1/transform/{dataset_id}/rename",
        json={"mappings": {"b": "value"}},
    )
    assert renamed.status_code == 200, renamed.text
    return dataset_id


def test_diff_steps_same_dataset_is_read_only(client):
    dataset_id = _import_with_history(client)
    history_before = client.get(f"/api/v1/transform/{dataset_id}/history").json()

    resp = client.post(
        f"/api/v1/data/{dataset_id}/diff-steps",
        json={"step_a": -1, "step_b": 1},
    )

    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["left_step"] == -1
    assert body["right_step"] == 1
    assert body["left_rows"] == 3
    assert body["right_rows"] == 2
    assert body["only_left"] == ["b"]
    assert body["only_right"] == ["value"]
    assert client.get(f"/api/v1/transform/{dataset_id}/history").json() == history_before


def test_diff_steps_rejects_invalid_steps(client):
    dataset_id = _import_with_history(client)
    too_large = client.post(
        f"/api/v1/data/{dataset_id}/diff-steps",
        json={"step_a": -1, "step_b": 99},
    )
    invalid_type = client.post(
        f"/api/v1/data/{dataset_id}/diff-steps",
        json={"step_a": "import", "step_b": 0},
    )
    assert too_large.status_code == 400
    assert invalid_type.status_code == 400


def test_diff_steps_missing_dataset(client):
    resp = client.post(
        "/api/v1/data/nope/diff-steps",
        json={"step_a": -1, "step_b": 0},
    )
    assert resp.status_code == 404


def test_diff_steps_rejects_boolean_step(client):
    dataset_id = _import_with_history(client)
    resp = client.post(
        f"/api/v1/data/{dataset_id}/diff-steps",
        json={"step_a": True, "step_b": 0},
    )
    assert resp.status_code == 400


def test_diff_serializes_empty_numeric_means_as_null(client):
    csv = "a,b\n1,\n2,\n"
    first = client.post("/api/v1/data/import", files={"file": ("first.csv", csv.encode(), "text/csv")})
    second = client.post("/api/v1/data/import", files={"file": ("second.csv", csv.encode(), "text/csv")})
    resp = client.post(
        "/api/v1/data/diff",
        json={"left_id": first.json()[0]["id"], "right_id": second.json()[0]["id"]},
    )
    assert resp.status_code == 200, resp.text
    empty_column = next(item for item in resp.json()["numeric_diff"] if item["column"] == "b")
    assert empty_column["left_mean"] is None
    assert empty_column["right_mean"] is None
