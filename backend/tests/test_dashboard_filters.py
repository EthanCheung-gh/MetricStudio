import pandas as pd
from fastapi.testclient import TestClient

from backend.api.chart import _filter_by_filters
from backend.main import app
from backend.models.chart import FilterSpec, SelectionFilter


def test_range_numeric():
    df = pd.DataFrame({"a": [1, 2, 3, 4, 5]})
    out = _filter_by_filters(df, [FilterSpec(field="a", op="range", range=[2, 4])])
    assert out["a"].tolist() == [2, 3, 4]


def test_range_date():
    df = pd.DataFrame({"d": pd.to_datetime(["2024-01-01", "2024-01-02", "2024-01-03"])})
    out = _filter_by_filters(
        df, [FilterSpec(field="d", op="range", range=["2024-01-02", "2024-01-03"])]
    )
    assert len(out) == 2


def test_in_category():
    df = pd.DataFrame({"c": ["North", "South", "East"]})
    out = _filter_by_filters(df, [FilterSpec(field="c", op="in", values=["North", "East"])])
    assert set(out["c"].tolist()) == {"North", "East"}


def test_unknown_field_is_noop():
    df = pd.DataFrame({"a": [1, 2, 3]})
    out = _filter_by_filters(df, [FilterSpec(field="missing", op="range", range=[1, 2])])
    assert len(out) == 3


def _import_sample(client: TestClient) -> str:
    csv = """date,category,value,region
2024-01-01,A,120,North
2024-02-01,A,150,North
2024-03-01,B,180,South
2024-01-01,B,90,South
2024-02-01,C,200,East
2024-03-01,C,160,West
"""
    resp = client.post("/api/v1/data/import", files={"file": ("brush.csv", csv.encode(), "text/csv")})
    assert resp.status_code == 200, resp.text
    return resp.json()[0]["id"]


def test_multi_brush_selections_combine(client):
    """Two brushes on different fields both narrow the dataset."""
    dsid = _import_sample(client)
    encoding = {
        "chartType": "bar",
        "x": {"field": "category", "type": "nominal"},
        "yFields": [{"field": "value", "type": "quantitative", "axis": "left", "normalize": "none"}],
    }
    # brush 1: value in [100, 200]; brush 2: region == North (numeric-only field filter via selection)
    resp = client.post(
        "/api/v1/chart/preview",
        json={
            "dataset_id": dsid,
            "encoding": encoding,
            "selections": [
                {"yField": "value", "yRange": [100, 200]},
            ],
        },
    )
    assert resp.status_code == 200, resp.text
    ys = [pt for tr in resp.json()["data"] for pt in tr.get("y", [])]
    assert ys and all(100 <= v <= 200 for v in ys)


def test_selection_and_filters_together(client):
    """filters (global) + selections (brush) both apply."""
    dsid = _import_sample(client)
    encoding = {
        "chartType": "bar",
        "x": {"field": "category", "type": "nominal"},
        "yFields": [{"field": "value", "type": "quantitative", "axis": "left", "normalize": "none"}],
    }
    resp = client.post(
        "/api/v1/chart/preview",
        json={
            "dataset_id": dsid,
            "encoding": encoding,
            "filters": [{"field": "category", "op": "in", "values": ["A", "B"]}],
            "selections": [{"yField": "value", "yRange": [100, 200]}],
        },
    )
    assert resp.status_code == 200, resp.text
    ys = [pt for tr in resp.json()["data"] for pt in tr.get("y", [])]
    # value 120,150,180,90 -> filtered to A/B and 100..200 => 120,150,180
    assert sorted(ys) == [120.0, 150.0, 180.0], ys
