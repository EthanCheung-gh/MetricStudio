import pandas as pd

from backend.api.chart import _filter_by_filters
from backend.models.chart import FilterSpec


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
