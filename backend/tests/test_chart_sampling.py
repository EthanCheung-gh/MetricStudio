"""Cost: raw-row chart payloads are O(rows) and must be capped.

The figure is built server-side and JSON-serialized to the SPA on every
encoding change, so an uncapped scatter of 100k rows ships ~4 MB per preview.
Sampling is deterministic and only ever applies to one-mark-per-row traces.
"""

from __future__ import annotations

import json

import numpy as np
import pandas as pd
import pytest

from backend.api import chart
from backend.models.chart import ChartEncoding


@pytest.fixture
def raw_frame() -> pd.DataFrame:
    rng = np.random.default_rng(0)
    rows = 30_000
    return pd.DataFrame(
        {
            "x": rng.normal(0, 1, rows),
            "y": rng.normal(0, 1, rows),
            "g": rng.choice(["A", "B", "C"], rows),
        }
    )


def _encoding(**overrides) -> ChartEncoding:
    payload = {
        "chartType": "scatter",
        "x": {"field": "x", "type": "quantitative"},
        "yFields": [{"field": "y", "type": "quantitative"}],
    }
    payload.update(overrides)
    return ChartEncoding.model_validate(payload)


def test_raw_scatter_is_downsampled(raw_frame, monkeypatch):
    monkeypatch.setenv("METRICSTUDIO_CHART_MAX_POINTS", "5000")
    figure = chart._aggregate(raw_frame, _encoding())

    points = len(figure["data"][0]["x"])
    assert points <= 5000
    assert figure["layout"]["meta"]["sampled"]["total"] == 30_000
    assert figure["layout"]["meta"]["sampled"]["shown"] == points


def test_sampling_is_deterministic(raw_frame, monkeypatch):
    monkeypatch.setenv("METRICSTUDIO_CHART_MAX_POINTS", "1000")
    first = chart._aggregate(raw_frame, _encoding())
    second = chart._aggregate(raw_frame, _encoding())
    assert first["data"][0]["x"] == second["data"][0]["x"]
    assert first["data"][0]["y"] == second["data"][0]["y"]


def test_sampling_keeps_first_and_last_row(raw_frame, monkeypatch):
    monkeypatch.setenv("METRICSTUDIO_CHART_MAX_POINTS", "500")
    figure = chart._aggregate(raw_frame, _encoding())
    # x is stringified for categorical-axis rendering.
    assert figure["data"][0]["x"][0] == str(raw_frame["x"].iloc[0])
    assert figure["data"][0]["x"][-1] == str(raw_frame["x"].iloc[-1])


def test_small_data_is_untouched(monkeypatch):
    monkeypatch.setenv("METRICSTUDIO_CHART_MAX_POINTS", "5000")
    frame = pd.DataFrame({"x": [1.0, 2.0, 3.0], "y": [4.0, 5.0, 6.0]})
    figure = chart._aggregate(frame, _encoding())

    assert len(figure["data"][0]["x"]) == 3
    assert "meta" not in figure["layout"]


def test_aggregate_path_is_not_sampled(raw_frame, monkeypatch):
    """Grouped totals change if rows are dropped — never sample this path."""
    monkeypatch.setenv("METRICSTUDIO_CHART_MAX_POINTS", "10")
    encoding = _encoding(
        chartType="bar",
        x={"field": "g", "type": "nominal"},
        yFields=[{"field": "y", "type": "quantitative", "aggregate": "sum"}],
    )
    figure = chart._aggregate(raw_frame, encoding)

    assert "meta" not in figure["layout"]
    assert len(figure["data"][0]["x"]) == 3  # one bar per category
    assert len(figure["data"][0]["y"]) == 3


def test_color_grouped_path_is_not_sampled(raw_frame, monkeypatch):
    monkeypatch.setenv("METRICSTUDIO_CHART_MAX_POINTS", "10")
    encoding = _encoding(
        chartType="line",
        color={"field": "g", "type": "nominal"},
    )
    figure = chart._aggregate(raw_frame, encoding)
    assert "meta" not in figure["layout"]


def test_histogram_is_not_sampled(raw_frame, monkeypatch):
    """Histogram counts are computed from the rows — sampling would distort them."""
    monkeypatch.setenv("METRICSTUDIO_CHART_MAX_POINTS", "10")
    encoding = _encoding(chartType="histogram", x=None, yFields=[{"field": "y", "type": "quantitative"}])
    figure = chart._aggregate(raw_frame, encoding)

    assert "meta" not in figure["layout"]
    assert len(figure["data"][0]["x"]) == 30_000


def test_payload_shrinks_with_sampling(raw_frame, monkeypatch):
    monkeypatch.setenv("METRICSTUDIO_CHART_MAX_POINTS", "0")
    uncapped = len(json.dumps(chart._aggregate(raw_frame, _encoding()), default=str))
    monkeypatch.setenv("METRICSTUDIO_CHART_MAX_POINTS", "5000")
    capped = len(json.dumps(chart._aggregate(raw_frame, _encoding()), default=str))

    assert capped < uncapped / 4
