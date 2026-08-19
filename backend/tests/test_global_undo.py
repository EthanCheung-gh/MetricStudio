"""Tests for the global undo/redo stack."""


def test_global_undo_redo_across_datasets(client, dirty_dataset):
    # import a second dataset (self-contained; independent of sample_data.csv contents)
    ds2 = client.post(
        "/api/v1/data/import",
        files={"file": ("sample2.csv", b"value\n3\n1\n2\n", "text/csv")},
    ).json()[0]

    # transform dataset 1 (dedupe) then dataset 2 (sort)
    client.post(f"/api/v1/transform/{dirty_dataset['id']}/recipe/dedupe")
    client.post(f"/api/v1/transform/{ds2['id']}/sort", json={"column": "value", "ascending": True})

    hist = client.get("/api/v1/transform/global/history").json()
    assert len(hist["undo"]) == 2
    assert hist["undo"][-1]["dataset_id"] == ds2["id"]

    # undo dataset 2's sort
    r = client.post("/api/v1/transform/global/undo")
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["dataset_id"] == ds2["id"]
    # dataset 2 back to raw (no history applied) — import has no ops, preview = 3 rows
    assert body["preview"]["total_rows"] == 3

    # undo dataset 1's dedupe -> 10 rows (duplicate back)
    r = client.post("/api/v1/transform/global/undo")
    body = r.json()
    assert body["dataset_id"] == dirty_dataset["id"]
    assert body["preview"]["total_rows"] == 10

    # redo both
    r = client.post("/api/v1/transform/global/redo")
    assert r.json()["dataset_id"] == dirty_dataset["id"]
    assert r.json()["preview"]["total_rows"] == 9
    r = client.post("/api/v1/transform/global/redo")
    assert r.json()["dataset_id"] == ds2["id"]

    hist = client.get("/api/v1/transform/global/history").json()
    assert len(hist["undo"]) == 2 and len(hist["redo"]) == 0


def test_global_undo_empty_returns_400(client):
    r = client.post("/api/v1/transform/global/undo")
    assert r.status_code == 400


def test_recipe_is_one_global_entry(client, dirty_dataset):
    dsid = dirty_dataset["id"]
    client.post(f"/api/v1/transform/{dsid}/recipe/dedupe")
    client.post(f"/api/v1/transform/{dsid}/recipe/fillna-median-numeric")

    hist = client.get("/api/v1/transform/global/history").json()
    assert len(hist["undo"]) == 2

    # a single undo removes the whole fillna recipe (multi-op batch)
    r = client.post("/api/v1/transform/global/undo")
    assert r.json()["dataset_id"] == dsid
    # after undoing fillna, history has only dedupe -> 9 rows, score has missing again
    assert r.json()["preview"]["total_rows"] == 9

    # redo restores fillna
    r = client.post("/api/v1/transform/global/redo")
    assert r.status_code == 200


def test_new_operation_clears_redo(client, dirty_dataset):
    dsid = dirty_dataset["id"]
    client.post(f"/api/v1/transform/{dsid}/recipe/dedupe")
    client.post("/api/v1/transform/global/undo")
    assert len(client.get("/api/v1/transform/global/history").json()["redo"]) == 1

    client.post(f"/api/v1/transform/{dsid}/sort", json={"column": "value", "ascending": True})
    hist = client.get("/api/v1/transform/global/history").json()
    assert len(hist["redo"]) == 0  # redo stack cleared by new op
