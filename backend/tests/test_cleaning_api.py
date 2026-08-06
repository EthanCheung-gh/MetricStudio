"""Integration tests for the cleaning assistant API surface."""

from backend.core.quality import detect_quality


def test_quality_endpoint(dirty_dataset, client):
    resp = client.get(f"/api/v1/data/{dirty_dataset['id']}/quality")
    assert resp.status_code == 200
    report = resp.json()
    ids = {i["id"] for i in report["issues"]}
    assert {"missing", "duplicates", "outliers", "type"} <= ids
    assert {r["id"] for r in report["recipes"]} == {
        "dedupe",
        "dropna",
        "fillna-median-numeric",
        "clip-outliers",
        "coerce-numeric",
    }


def test_apply_recipe_chain_and_history(dirty_dataset, client):
    dsid = dirty_dataset["id"]

    # dedupe: 10 -> 9 rows
    r = client.post(f"/api/v1/transform/{dsid}/recipe/dedupe")
    assert r.status_code == 200 and r.json()["totalRows"] == 9

    # fillna-median: score has no missing anymore
    r = client.post(f"/api/v1/transform/{dsid}/recipe/fillna-median-numeric")
    p = r.json()
    score_col = p["columns"].index("score")
    assert all(row[score_col] is not None for row in p["rows"])

    # clip-outliers: 500 -> bound, 999 -> bound
    r = client.post(f"/api/v1/transform/{dsid}/recipe/clip-outliers")
    p = r.json()
    val_col = p["columns"].index("value")
    sc_col = p["columns"].index("score")
    vals = [row[val_col] for row in p["rows"]]
    scs = [row[sc_col] for row in p["rows"]]
    assert 500 not in vals and 999 not in scs
    assert max(vals) <= 217.5 and max(scs) <= 93.5

    # coerce-numeric: 1,000 -> 1000.0
    r = client.post(f"/api/v1/transform/{dsid}/recipe/coerce-numeric")
    p = r.json()
    num_col = p["columns"].index("num_str")
    assert all(isinstance(row[num_col], (int, float)) for row in p["rows"])

    # history preserves the full chain (clip emits one op per column)
    hist = client.get(f"/api/v1/transform/{dsid}/history").json()
    types = [h["type"] for h in hist]
    assert types == ["dedupe", "fillna", "clip", "clip", "parse_numeric"], types


def test_undo_after_recipes(dirty_dataset, client):
    dsid = dirty_dataset["id"]
    client.post(f"/api/v1/transform/{dsid}/recipe/dedupe")
    client.post(f"/api/v1/transform/{dsid}/recipe/fillna-median-numeric")

    r = client.post(f"/api/v1/transform/{dsid}/undo", json={"to_index": 1})
    assert r.status_code == 200 and r.json()["totalRows"] == 9  # back to dedupe-only

    # undo to 0 restores the raw frame (10 rows incl. duplicate)
    r = client.post(f"/api/v1/transform/{dsid}/undo", json={"to_index": 0})
    assert r.json()["totalRows"] == 10


def test_batch_endpoint(dirty_dataset, client):
    dsid = dirty_dataset["id"]
    r = client.post(
        f"/api/v1/transform/{dsid}/batch",
        json={"operations": [{"type": "dedupe", "params": {}}]},
    )
    assert r.status_code == 200 and r.json()["totalRows"] == 9


def test_recipe_matches_rule_detection(dirty_dataset, client):
    """The applied recipe must actually fix what the detector reported."""
    dsid = dirty_dataset["id"]
    # Apply every suggested recipe per issue, then re-scan.
    report = client.get(f"/api/v1/data/{dsid}/quality").json()
    for issue in report["issues"]:
        for rid in issue["suggestions"]:
            client.post(f"/api/v1/transform/{dsid}/recipe/{rid}")
    after = client.get(f"/api/v1/data/{dsid}/quality").json()
    remaining = {i["id"] for i in after["issues"]}
    # numeric-string coercion is idempotent; duplicates/missing/outliers should clear
    assert "duplicates" not in remaining
    assert "missing" not in remaining
