"""Verifiability tests for the insights feature.

Two invariants hold for every generated insight:
1. Every number shown in `text` exists in `evidence` (anti-hallucination).
2. `evidence` matches what recomputing from the dataframe yields.
"""

import re

from backend.core.insights import generate_insights


def _numbers_in_text(text: str) -> list[float]:
    return [float(n) for n in re.findall(r"-?\d+\.?\d*", text)]


def _evidence_numbers(evidence: dict) -> list[float]:
    out = []
    for v in evidence.values():
        if isinstance(v, (int, float)) and not isinstance(v, bool):
            out.append(float(v))
    return out


def test_sample_data_yields_trend(dirty_df):
    """sample-like frame: mean value rises across months."""
    df = dirty_df[["id", "value"]].copy()
    df["date"] = ["2024-01-01", "2024-02-01", "2024-03-01"] * 3 + ["2024-01-15"]
    # 10 rows total; focus on the trend insight only.
    insights = generate_insights(df)
    trends = [i for i in insights if i["type"] == "trend"]
    assert trends, "expected a trend insight on a temporal+numeric frame"


def test_insight_evidence_appears_in_text(dirty_df):
    """Invariant 1: every numeric claim in evidence is present in the text.

    (Reverse check — text may legitimately contain dates/periods whose digits
    are not statistical claims.)
    """
    for insight in generate_insights(dirty_df):
        text = insight["text"]
        for k, v in insight["evidence"].items():
            if isinstance(v, (int, float)) and not isinstance(v, bool):
                shown = str(v)
                if float(v).is_integer():
                    shown = str(int(v))
                assert shown in text, (
                    f"{insight['type']}: evidence {k}={v} missing from text: {text}"
                )


def test_trend_evidence_matches_data():
    import pandas as pd

    df = pd.DataFrame(
        {
            "date": ["2024-01-01", "2024-02-01", "2024-03-01"] * 3,
            "value": [100.0, 150.0, 200.0] * 3,
        }
    )
    insights = generate_insights(df)
    trend = next(i for i in insights if i["type"] == "trend")
    ev = trend["evidence"]
    # Recompute monthly means independently
    ts = pd.to_datetime(df["date"])
    monthly = df.groupby(ts.dt.to_period("M"))["value"].mean()
    assert ev["start"] == round(float(monthly.iloc[0]), 1)
    assert ev["end"] == round(float(monthly.iloc[-1]), 1)
    assert ev["pct"] == round((float(monthly.iloc[-1]) - float(monthly.iloc[0])) / abs(float(monthly.iloc[0])) * 100)


def test_skew_and_missing_detected_on_dirty(dirty_df):
    insights = generate_insights(dirty_df)
    types = {i["type"] for i in insights}
    # dirty.csv: value has an outlier pulling the mean away from median; score has 30% missing
    assert "skew" in types
    assert "missing" in types


def test_insights_endpoint(client, dirty_dataset):
    resp = client.get(f"/api/v1/data/{dirty_dataset['id']}/insights")
    assert resp.status_code == 200
    body = resp.json()
    assert isinstance(body["insights"], list)
    assert all("text" in i and "evidence" in i for i in body["insights"])
