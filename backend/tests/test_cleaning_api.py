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
        "trim-whitespace",
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


def test_quality_fix_preview_is_read_only_and_excludes_destructive_dropna(dirty_dataset, client):
    dsid = dirty_dataset["id"]
    history_before = client.get(f"/api/v1/transform/{dsid}/history").json()

    response = client.post(f"/api/v1/transform/{dsid}/quality-fix/preview", json={})

    assert response.status_code == 200, response.text
    body = response.json()
    operation_types = [operation["type"] for operation in body["operations"]]
    assert "dedupe" in operation_types
    assert "fillna" in operation_types
    assert "clip" in operation_types
    assert "parse_numeric" in operation_types
    assert body["datasetId"] == dsid
    assert "dropna" not in operation_types
    assert body["diff"]["left_rows"] == 10
    assert body["diff"]["right_rows"] == 9
    assert body["preview"]["totalRows"] == 9
    assert client.get(f"/api/v1/transform/{dsid}/history").json() == history_before


def test_quality_fix_preview_operations_apply_as_one_batch(dirty_dataset, client):
    dsid = dirty_dataset["id"]
    plan = client.post(f"/api/v1/transform/{dsid}/quality-fix/preview", json={}).json()
    applied = client.post(
        f"/api/v1/transform/{dsid}/batch",
        json={"operations": plan["operations"]},
    )
    assert applied.status_code == 200, applied.text
    remaining = {issue["id"] for issue in client.get(f"/api/v1/data/{dsid}/quality").json()["issues"]}
    assert "duplicates" not in remaining
    assert "missing" not in remaining
    assert "outliers" not in remaining
    assert "type" not in remaining


def test_quality_fix_preview_skips_all_nan_numeric_columns(client):
    csv = "value\n\n\n"
    imported = client.post(
        "/api/v1/data/import",
        files={"file": ("empty-numeric.csv", csv.encode(), "text/csv")},
    )
    dataset_id = imported.json()[0]["id"]
    response = client.post(f"/api/v1/transform/{dataset_id}/quality-fix/preview", json={})
    assert response.status_code == 200, response.text
    assert all(
        not (operation["type"] == "fillna" and operation["params"].get("column") == "value")
        for operation in response.json()["operations"]
    )


def test_quality_fix_preview_rejects_invalid_issue_ids_shape(dirty_dataset, client):
    response = client.post(
        f"/api/v1/transform/{dirty_dataset['id']}/quality-fix/preview",
        json={"issue_ids": "missing"},
    )
    assert response.status_code == 400


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


def test_quality_report_exposes_column_stats_and_samples(dirty_dataset, client):
    dsid = dirty_dataset["id"]
    report = client.get(f"/api/v1/data/{dsid}/quality").json()
    stats = {entry["column"]: entry for entry in report["column_stats"]}
    assert set(stats) == {"id", "value", "score", "category", "num_str", "note"}
    assert stats["score"]["missing"] == 3
    assert "mean" in stats["value"]
    assert stats["note"]["top"]

    duplicates_issue = next(issue for issue in report["issues"] if issue["id"] == "duplicates")
    assert len(duplicates_issue["samples"]) == 2
    first = duplicates_issue["samples"][0]["values"]
    assert first["id"] == 1 and first["note"] == "hello"

    outliers = next(issue for issue in report["issues"] if issue["id"] == "outliers")
    assert outliers["samples"], "outlier rows should carry samples"


def test_format_whitespace_detection_and_trim_recipe(client):
    csv = 'name,city\n" alice","New York"\n"bob","San  Francisco"\ncarol," LA "\n'
    dataset_id = client.post(
        "/api/v1/data/import",
        files={"file": ("ws.csv", csv.encode(), "text/csv")},
    ).json()[0]["id"]

    report = client.get(f"/api/v1/data/{dataset_id}/quality").json()
    format_issues = [issue for issue in report["issues"] if issue["id"] == "format"]
    assert {issue["columns"][0] for issue in format_issues} == {"name", "city"}
    name_issue = next(issue for issue in format_issues if issue["columns"] == ["name"])
    assert name_issue["samples"][0]["values"]["name"] == " alice"
    assert any(recipe["id"] == "trim-whitespace" for recipe in report["recipes"])

    applied = client.post(f"/api/v1/transform/{dataset_id}/recipe/trim-whitespace")
    assert applied.status_code == 200, applied.text
    after = client.get(f"/api/v1/data/{dataset_id}/quality").json()
    assert not [issue for issue in after["issues"] if issue["id"] == "format"]
    preview_rows = applied.json()["rows"]
    names = [row[applied.json()["columns"].index("name")] for row in preview_rows]
    assert "alice" in names and not any(value.startswith(" ") for value in names)


def test_quality_fix_plan_includes_format_steps(client):
    csv = 'name\n" a "\n" b  c"\n'
    dataset_id = client.post(
        "/api/v1/data/import",
        files={"file": ("plan.csv", csv.encode(), "text/csv")},
    ).json()[0]["id"]
    plan = client.post(f"/api/v1/transform/{dataset_id}/quality-fix/preview", json={}).json()
    str_clean = [op for op in plan["operations"] if op["type"] == "str_clean"]
    assert {"column": "name", "action": "trim"} in [op["params"] for op in str_clean]
