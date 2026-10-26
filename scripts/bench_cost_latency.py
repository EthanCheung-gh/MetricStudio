#!/usr/bin/env python3
"""Cost/latency bench for the AI + chart hot paths (no network).

Measures the four numbers the cost/latency plan optimizes:

1. ``_build_data_context`` (cold and warm) — blocks the first LLM token
2. ``_build_data_evidence`` — recomputes describe/insights before the loop
3. QA system prompt size — re-sent on every agent round
4. chart figure build time and JSON payload — O(rows) response body

Run with the backend venv (pandas/scipy required):

    backend/.venv/bin/python scripts/bench_cost_latency.py
    backend/.venv/bin/python scripts/bench_cost_latency.py --json

``--json`` prints one object on stdout (progress warnings are suppressed) so
before/after runs can be diffed mechanically.
"""

from __future__ import annotations

import argparse
import json
import statistics
import sys
import time
import warnings
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

warnings.filterwarnings("ignore")

import numpy as np  # noqa: E402
import pandas as pd  # noqa: E402

from backend.api import chart, nl  # noqa: E402
from backend.core import qa_agent, qa_tools  # noqa: E402
from backend.core.dataframe import Dataset  # noqa: E402
from backend.models.chart import ChartEncoding  # noqa: E402

QUESTION = "哪个地区销售额最高"


def _sample_frame(rows: int, cols: int) -> pd.DataFrame:
    """Deterministic wide frame: numeric + high-cardinality text + datetime."""
    rng = np.random.default_rng(0)
    data: dict[str, object] = {
        f"metric_{i}": rng.normal(100, 20, rows) for i in range(cols // 2)
    }
    data.update(
        {f"cat_{i}": rng.choice([f"值{j}" + "x" * 30 for j in range(40)], rows) for i in range(cols // 2 - 2)}
    )
    data["日期"] = pd.date_range("2024-01-01", periods=rows, freq="h").astype(str)
    data["备注"] = ["很长的文本" * 40] * rows
    return pd.DataFrame(data)


def _timeit(fn, repeats: int = 3) -> float:
    """Median wall time in ms."""
    samples = []
    for _ in range(repeats):
        started = time.perf_counter()
        fn()
        samples.append((time.perf_counter() - started) * 1000)
    return round(statistics.median(samples), 1)


def bench_context(label: str, df: pd.DataFrame) -> dict:
    dataset = Dataset(df, name=label)
    cold = _timeit(lambda: nl._build_data_context(dataset, df, QUESTION), repeats=1)
    warm = _timeit(lambda: nl._build_data_context(dataset, df, QUESTION), repeats=3)
    context = nl._build_data_context(dataset, df, QUESTION)
    system = qa_agent._SYSTEM_TEMPLATE.format(
        context=qa_agent._wrap_untrusted(context),
        tools_desc=qa_tools.TOOLS_DESC,
        max_calls=qa_agent.MAX_CALLS_PER_ROUND,
        begin=qa_agent.DATA_BEGIN,
        end=qa_agent.DATA_END,
    ) if "{context}" in qa_agent._SYSTEM_TEMPLATE else qa_agent._SYSTEM_TEMPLATE.format(
        tools_desc=qa_tools.TOOLS_DESC,
        max_calls=qa_agent.MAX_CALLS_PER_ROUND,
        begin=qa_agent.DATA_BEGIN,
        end=qa_agent.DATA_END,
    )
    evidence = _timeit(lambda: nl._build_data_evidence(dataset, df, None), repeats=3)
    return {
        "label": label,
        "rows": int(len(df)),
        "cols": int(len(df.columns)),
        "context_cold_ms": cold,
        "context_warm_ms": warm,
        "evidence_ms": evidence,
        "context_chars": len(context),
        "system_prompt_chars": len(system),
        "est_prompt_tokens": round(len(system) / 2.4),
    }


def bench_figure(rows: int) -> dict:
    rng = np.random.default_rng(0)
    df = pd.DataFrame(
        {
            "x": rng.normal(0, 1, rows),
            "y": rng.normal(0, 1, rows),
            "g": rng.choice(list("ABCDE"), rows),
        }
    )
    encoding = ChartEncoding.model_validate(
        {
            "chartType": "scatter",
            "x": {"field": "x", "type": "quantitative"},
            "yFields": [{"field": "y", "type": "quantitative"}],
        }
    )
    figures: list[dict] = []
    build_ms = _timeit(lambda: figures.append(chart._aggregate(df, encoding)), repeats=3)
    payload = len(json.dumps(figures[-1], default=str))
    points = len(figures[-1]["data"][0]["x"]) if figures[-1].get("data") else 0
    return {
        "rows": rows,
        "build_ms": build_ms,
        "payload_bytes": payload,
        "points": points,
        "meta_sampled": bool((figures[-1].get("layout") or {}).get("meta")),
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--json", action="store_true", help="emit one JSON object")
    parser.add_argument("--skip-large", action="store_true", help="skip the 100k-row figure case")
    args = parser.parse_args()

    sample = pd.read_csv(ROOT / "sample_data.csv")
    narrow = bench_context("sample_data.csv", sample)
    wide = bench_context("synthetic 20 cols", _sample_frame(2000, 20))
    figures = [bench_figure(rows) for rows in ((636, 20000) if args.skip_large else (636, 20000, 100000))]

    report = {"contexts": [narrow, wide], "figures": figures}

    if args.json:
        print(json.dumps(report, ensure_ascii=False))
        return 0

    print(f"{'dataset':<22}{'rows':>7}{'cols':>5}{'ctx cold':>10}{'ctx warm':>10}{'evidence':>10}{'sys chars':>11}{'~tok':>7}")
    for row in report["contexts"]:
        print(
            f"{row['label']:<22}{row['rows']:>7}{row['cols']:>5}"
            f"{row['context_cold_ms']:>9.1f}ms{row['context_warm_ms']:>9.1f}ms{row['evidence_ms']:>9.1f}ms"
            f"{row['system_prompt_chars']:>11}{row['est_prompt_tokens']:>7}"
        )
    print()
    print(f"{'chart rows':>10}{'build':>10}{'payload':>12}{'points':>9}{'sampled':>9}")
    for row in report["figures"]:
        print(
            f"{row['rows']:>10}{row['build_ms']:>9.1f}ms"
            f"{row['payload_bytes'] / 1024:>10.1f} KB{row['points']:>9}{str(row['meta_sampled']):>9}"
        )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
