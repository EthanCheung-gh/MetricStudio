"""Tests for server-side data preview pagination, filtering, and sorting."""


def _import(client):
    csv = """name,group,value
alpha,A,30
beta,B,10
gamma,A,20
delta,B,40
epsilon,A,50
"""
    response = client.post(
        "/api/v1/data/import",
        files={"file": ("paged.csv", csv.encode(), "text/csv")},
    )
    assert response.status_code == 200, response.text
    return response.json()[0]["id"]


def test_preview_offset_and_limit(client):
    dataset_id = _import(client)
    response = client.get(f"/api/v1/data/{dataset_id}/preview?limit=2&offset=2")
    assert response.status_code == 200, response.text
    body = response.json()
    assert [row[0] for row in body["rows"]] == ["gamma", "delta"]
    assert body["offset"] == 2
    assert body["limit"] == 2
    assert body["totalRows"] == 5
    assert body["totalFilteredRows"] == 5


def test_preview_sorts_before_pagination(client):
    dataset_id = _import(client)
    response = client.get(
        f"/api/v1/data/{dataset_id}/preview?limit=2&offset=0&sort_by=value&sort_asc=false"
    )
    assert response.status_code == 200, response.text
    assert [row[2] for row in response.json()["rows"]] == [50, 40]


def test_preview_filters_and_searches_full_dataset(client):
    dataset_id = _import(client)
    filtered = client.get(
        f"/api/v1/data/{dataset_id}/preview",
        params={"limit": 2, "filters": '{"group":"A"}'},
    )
    searched = client.get(
        f"/api/v1/data/{dataset_id}/preview",
        params={"limit": 2, "search": "ta"},
    )
    assert filtered.status_code == 200, filtered.text
    assert filtered.json()["totalFilteredRows"] == 3
    assert [row[0] for row in filtered.json()["rows"]] == ["alpha", "gamma"]
    assert searched.status_code == 200, searched.text
    assert searched.json()["totalFilteredRows"] == 2
    assert [row[0] for row in searched.json()["rows"]] == ["beta", "delta"]


def test_distinct_values_use_full_dataset(client):
    dataset_id = _import(client)
    response = client.get(
        f"/api/v1/data/{dataset_id}/values",
        params={"column": "group"},
    )
    assert response.status_code == 200, response.text
    assert response.json()["values"] == ["A", "B"]


def test_preview_rejects_invalid_filter_and_sort_columns(client):
    dataset_id = _import(client)
    invalid_filter = client.get(
        f"/api/v1/data/{dataset_id}/preview",
        params={"filters": '{"missing":"x"}'},
    )
    invalid_sort = client.get(
        f"/api/v1/data/{dataset_id}/preview",
        params={"sort_by": "missing"},
    )
    assert invalid_filter.status_code == 400
    assert invalid_sort.status_code == 400
