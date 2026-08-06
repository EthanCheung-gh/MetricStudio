"""Tests for rule-based chart recommendations.

Two invariants:
1. Deterministic — same dataframe yields the same recommendations.
2. Executable — every recommended encoding runs through /chart/preview.
"""

from backend.core.recommend import recommend_charts
from backend.core.engine import DataEngine


def test_recommends_line_bar_histogram_for_sample(dirty_df):
    recs = recommend_charts(dirty_df)
    types = [r["chart_type"] for r in recs]
    assert "histogram" in types  # id/value numeric
    assert all(r["encoding"]["chartType"] == r["chart_type"] for r in recs)
    assert all(r["reason"] for r in recs)


def test_recommendations_deterministic(dirty_df):
    a = recommend_charts(dirty_df)
    b = recommend_charts(dirty_df.copy())
    assert a == b


def test_temporal_numeric_yields_trend():
    recs = recommend_charts(sample_like_df())
    line = next((r for r in recs if r["chart_type"] == "line"), None)
    assert line, "expected a line (trend) recommendation"
    assert line["encoding"]["x"]["field"] == "date"
    assert line["encoding"]["yFields"][0]["field"] == "value"


def test_pie_only_for_low_cardinality(dirty_df):
    recs = [r["chart_type"] for r in recommend_charts(dirty_df)]
    # dirty.csv category has 5 unique values (2..6) -> pie recommended
    assert "pie" in recs


def test_no_pie_for_high_cardinality():
    import pandas as pd

    df = pd.DataFrame({"cat": [f"c{i}" for i in range(20)], "val": range(20)})
    recs = [r["chart_type"] for r in recommend_charts(df)]
    assert "pie" not in recs


def test_heatmap_only_for_3_plus_numerics():
    import pandas as pd

    df = pd.DataFrame(
        {
            "date": ["2024-01-01", "2024-02-01", "2024-03-01"] * 3,
            "value": [1.0, 2.0, 3.0] * 3,
            "score": [4.0, 5.0, 6.0] * 3,
            "ratio": [0.1, 0.2, 0.3] * 3,
        }
    )
    types = [r["chart_type"] for r in recommend_charts(df)]
    assert "heatmap" in types


def test_recommendations_executable(client, dirty_dataset):
    """Every recommended encoding must produce a chart through the preview API."""
    from backend.core.recommend import recommend_charts
    from backend.core.session import session

    ds = session.get(dirty_dataset["id"])
    recs = recommend_charts(ds.df)
    assert recs, "expected at least one recommendation"
    for rec in recs:
        resp = client.post(
            "/api/v1/chart/preview",
            json={"dataset_id": dirty_dataset["id"], "encoding": rec["encoding"]},
        )
        assert resp.status_code == 200, (rec["chart_type"], resp.text)
        assert len(resp.json().get("data", [])) > 0, rec["chart_type"]


# --- fixtures ----------------------------------------------------------

def sample_like_df():
    import io

    import pandas as pd

    csv = """date,category,value,region
2024-01-01,A,120,North
2024-02-01,A,150,North
2024-03-01,A,180,South
2024-01-01,B,90,South
2024-02-01,B,110,East
2024-03-01,B,130,East
2024-01-01,C,200,North
2024-02-01,C,170,West
2024-03-01,C,160,West
"""
    return pd.read_csv(io.StringIO(csv))
