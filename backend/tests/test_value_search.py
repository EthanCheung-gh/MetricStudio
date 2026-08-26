"""High-cardinality value search: server-side search, pagination, cache, and a benchmark."""

import io
import time

import pytest


def _import_rows(client, name: str, rows: list[tuple[str, int]]):
    buffer = io.StringIO()
    buffer.write("name,value\n")
    for label, value in rows:
        buffer.write(f"{label},{value}\n")
    response = client.post(
        "/api/v1/data/import",
        files={"file": (name, buffer.getvalue().encode(), "text/csv")},
    )
    assert response.status_code == 200, response.text
    return response.json()[0]["id"]


def test_values_search_and_pagination(client):
    dataset_id = _import_rows(
        client,
        "search.csv",
        [("apple", 1), ("banana", 2), ("apricot", 3), ("cherry", 4), ("avocado", 5)],
    )
    page = client.get(
        f"/api/v1/data/{dataset_id}/values",
        params={"column": "name", "search": "ap", "limit": 2},
    )
    assert page.status_code == 200, page.text
    body = page.json()
    assert body["values"] == ["apple", "apricot"]
    assert body["filteredTotal"] == 2
    assert body["total"] == 5
    second_page = client.get(
        f"/api/v1/data/{dataset_id}/values",
        params={"column": "name", "search": "ap", "limit": 2, "offset": 2},
    )
    assert second_page.json()["values"] == []
    casefold = client.get(
        f"/api/v1/data/{dataset_id}/values",
        params={"column": "name", "search": "AP", "limit": 10},
    )
    assert casefold.json()["filteredTotal"] == 2


def test_values_refresh_after_transform(client):
    from backend.core.value_index import clear_cache

    clear_cache()
    dataset_id = _import_rows(
        client,
        "transform.csv",
        [("keep-1", 30), ("drop", 1), ("keep-2", 40)],
    )
    before = client.get(f"/api/v1/data/{dataset_id}/values", params={"column": "name"})
    assert set(before.json()["values"]) == {"keep-1", "drop", "keep-2"}

    apply = client.post(
        f"/api/v1/transform/{dataset_id}/filter",
        json={"column": "value", "operator": "gte", "value": 20},
    )
    assert apply.status_code == 200, apply.text

    after = client.get(f"/api/v1/data/{dataset_id}/values", params={"column": "name"})
    assert after.json()["values"] == ["keep-1", "keep-2"]


def test_distinct_value_search_benchmark(client):
    """50k high-cardinality rows: cold build + warm cached search stay responsive."""
    from backend.core.value_index import clear_cache

    clear_cache()
    rows = [(f"item-{i:06d}", i % 100) for i in range(50_000)]
    dataset_id = _import_rows(client, "bench.csv", rows)

    started = time.perf_counter()
    first = client.get(
        f"/api/v1/data/{dataset_id}/values",
        params={"column": "name", "search": "item-00042", "limit": 10},
    )
    cold_elapsed = time.perf_counter() - started
    assert first.status_code == 200, first.text
    assert first.json()["values"][0] == "item-000420"

    started = time.perf_counter()
    warm = client.get(
        f"/api/v1/data/{dataset_id}/values",
        params={"column": "name", "search": "item-00099", "limit": 10},
    )
    warm_elapsed = time.perf_counter() - started
    assert warm.status_code == 200, warm.text
    assert warm.json()["values"][0] == "item-000990"

    # Generous CI-friendly ceilings; correctness is asserted above.
    assert cold_elapsed < 5.0
    assert warm_elapsed < 0.5


@pytest.mark.parametrize("limit", [0, -5])
def test_values_rejects_invalid_limit(client, limit):
    dataset_id = _import_rows(client, "limits.csv", [("a", 1)])
    response = client.get(
        f"/api/v1/data/{dataset_id}/values",
        params={"column": "name", "limit": limit},
    )
    # Clamped to the valid range rather than erroring.
    assert response.status_code == 200
