"""Difference tests + confidence intervals (v0.8.2)."""


def _import(client, csv: str, name: str) -> str:
    response = client.post(
        "/api/v1/data/import",
        files={"file": (name, csv.encode(), "text/csv")},
    )
    assert response.status_code == 200, response.text
    return response.json()[0]["id"]


def test_group_difference_detects_significant_gap(client):
    csv = "group,value\nA,10\nA,12\nA,11\nA,13\nB,30\nB,32\nB,29\nB,31\n"
    dataset_id = _import(client, csv, "groups.csv")
    body = client.get(
        f"/api/v1/data/{dataset_id}/difference-test",
        params={"column_a": "value", "group_column": "group", "group_a": "A", "group_b": "B"},
    ).json()
    assert body["ok"] is True
    assert body["significant"] is True
    assert body["method"] == "Welch t 检验"
    assert body["p_value"] < 0.001
    assert body["statistic"] < 0  # A mean << B mean
    assert body["sizes"] == [4, 4]
    assert "显著差异" in body["interpretation"]


def test_group_difference_no_signal(client):
    import random

    random.seed(42)
    rows = ["group,value"]
    for i in range(20):
        group = "A" if i % 2 == 0 else "B"
        rows.append(f"{group},{100 + random.randint(-15, 15)}")
    dataset_id = _import(client, "\n".join(rows) + "\n", "noise.csv")
    body = client.get(
        f"/api/v1/data/{dataset_id}/difference-test",
        params={"column_a": "value", "group_column": "group", "group_a": "A", "group_b": "B"},
    ).json()
    assert body["ok"] is True
    # Randomly sampled from the same distribution: overwhelmingly not significant.
    assert body["p_value"] > 0.05


def test_two_column_comparison_includes_mann_whitney(client):
    csv = "before,after\n10,14\n12,15\n11,16\n13,17\n"
    dataset_id = _import(client, csv, "paired.csv")
    body = client.get(
        f"/api/v1/data/{dataset_id}/difference-test",
        params={"column_a": "before", "column_b": "after"},
    ).json()
    assert body["ok"] is True
    assert body["significant"] is True
    assert body.get("mann_whitney_u") is not None or body.get("mann_whitney_p") is None


def test_paired_t_test_with_confidence_interval(client):
    csv = "pre,post\n10,12\n14,17\n12,13\n15,19\n16,20\n"
    dataset_id = _import(client, csv, "pair2.csv")
    body = client.get(
        f"/api/v1/data/{dataset_id}/difference-test",
        params={"column_a": "pre", "column_b": "post", "paired": True},
    ).json()
    assert body["ok"] is True
    assert body["method"] == "配对 t 检验"
    assert body["ci"]["low"] <= body["ci"]["high"]
    assert body["ci"]["low"] <= body["ci"]["high"]


def test_difference_test_rejects_missing_group_value(client):
    csv = "group,value\nA,1\nB,2\n"
    dataset_id = _import(client, csv, "tiny.csv")
    response = client.get(
        f"/api/v1/data/{dataset_id}/difference-test",
        params={"column_a": "value", "group_column": "group", "group_a": "A", "group_b": "Z"},
    )
    assert response.status_code == 400


def test_ci_mean_reports_interval_and_rejects_bad_level(client):
    csv = "value\n10\n12\n11\n13\n14\n"
    dataset_id = _import(client, csv, "ci.csv")
    body = client.get(f"/api/v1/data/{dataset_id}/ci-mean", params={"column": "value"}).json()
    assert body["ok"] is True
    assert body["mean"] == 12.0
    assert body["ci_low"] < body["mean"] < body["ci_high"]

    bad = client.get(f"/api/v1/data/{dataset_id}/ci-mean", params={"column": "value", "level": 1.5})
    assert bad.status_code == 400

    missing = client.get(f"/api/v1/data/{dataset_id}/ci-mean", params={"column": "nope"})
    assert missing.status_code in (400, 404)
