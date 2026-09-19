#!/usr/bin/env python3
"""QA evaluation runner (v1.11.0).

Two modes over the same golden set and the same assertion engine:

- ``--mode replay`` (default, deterministic, CI-safe): canned LLM replies from
  each case drive the REAL agent loop, tools and citation wiring in-process.
  No network, no model — this verifies plumbing, not model quality.
- ``--mode live [--profile NAME]``: runs every case against a real provider
  and checks that the model calls the right tools, computes the right numbers
  and cites them. This is the actual quality gate; run it manually and compare
  against ``backend/tests/eval/baseline.json``.

Examples:
    python scripts/eval_qa.py --mode replay
    python scripts/eval_qa.py --mode live --profile deepseek --baseline backend/tests/eval/baseline.json
    python scripts/eval_qa.py --mode replay --write-baseline
"""

from __future__ import annotations

import argparse
import json
import logging
import os
import sys
import tempfile
import warnings
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(Path(__file__).resolve().parent))

import eval_engine  # noqa: E402  (local module)

GOLDEN = ROOT / "backend" / "tests" / "eval" / "qa_golden.json"
BASELINE = ROOT / "backend" / "tests" / "eval" / "baseline.json"


def _prepare_environment(mode: str, profile: str | None) -> None:
    """Pin the config dir so runs never scatter state into ~/.metricstudio."""
    if mode == "live":
        if profile:
            import backend.core.llm as llm

            store = llm.list_profiles()
            match = next((p for p in store["profiles"] if p["name"] == profile), None)
            if match is None:
                sys.exit(f"ERROR: profile not found: {profile}")
            tmp = tempfile.mkdtemp(prefix="ms-eval-")
            (Path(tmp) / "llm-profiles.json").write_text(json.dumps(
                {"version": 2, "active": match["id"], "profiles": [match]}, ensure_ascii=False,
            ), encoding="utf-8")
            os.environ["METRICSTUDIO_CONFIG_DIR"] = tmp
        return
    # replay: isolate config so the host's profiles can't affect the run
    tmp = tempfile.mkdtemp(prefix="ms-eval-replay-")
    os.environ.setdefault("METRICSTUDIO_CONFIG_DIR", tmp)


def _run_case(case: dict[str, Any], mode: str) -> dict[str, Any]:
    import backend.api.nl as nl_module
    import backend.core.qa_agent as qa_agent
    from backend.tests.eval import fixtures

    df = fixtures.get(case["fixture"])
    context = nl_module._build_data_context(None, df, case["question"])

    if mode == "replay":
        rounds = list(case.get("replay", []))
        if not rounds:
            sys.exit(f"ERROR: case '{case['id']}' has no replay rounds")

        def replay_chat(messages, **kwargs):  # noqa: ANN001, ANN003
            index = min(len(messages) - 2, len(rounds) - 1)
            return rounds[index]

        qa_agent.chat = replay_chat  # type: ignore[assignment]
        result = qa_agent.run_agent(case["question"], df, context)
    else:
        result = qa_agent.run_agent(case["question"], df, context)

    checks = eval_engine.evaluate(case, result)
    return {
        "id": case["id"],
        "passed": all(ok for _, ok, _ in checks),
        "checks": [{"check": cid, "passed": ok, "detail": detail} for cid, ok, detail in checks],
        "answer": (result.get("answer") or "")[:400],
        "tool_calls": result.get("tool_call_count"),
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="MetricStudio QA evaluation runner")
    parser.add_argument("--mode", choices=["replay", "live"], default="replay")
    parser.add_argument("--profile", help="profile NAME for live mode (activated in an isolated config dir)")
    parser.add_argument("--baseline", action="store_true", help="compare pass rate against the stored baseline")
    parser.add_argument("--write-baseline", action="store_true", help="store this run's pass rate as the baseline")
    parser.add_argument("--min-pass", type=float, default=1.0, help="fail below this pass rate (default 1.0)")
    args = parser.parse_args()

    _prepare_environment(args.mode, args.profile)
    # Standalone UX: keep trace lines and pandas parse warnings out of the report view.
    logging.getLogger("agent.trace").propagate = False
    warnings.filterwarnings("ignore", category=UserWarning, module="insights")

    cases = json.loads(GOLDEN.read_text(encoding="utf-8"))["cases"]
    import backend.core.qa_agent as qa_agent

    results = []
    for case in cases:
        try:
            results.append(_run_case(case, args.mode))
        except Exception as exc:  # noqa: BLE001 - report and continue
            results.append({"id": case["id"], "passed": False, "checks": [],
                            "error": f"{exc.__class__.__name__}: {exc}"})

    report = {
        "mode": args.mode,
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "prompt_version": qa_agent.PROMPT_VERSION,
        **eval_engine.summarize(results),
        "results": results,
    }

    print(f"mode={args.mode} prompt_version={report['prompt_version']}")
    for r in results:
        mark = "PASS" if r["passed"] else "FAIL"
        failed = [c["check"] for c in r["checks"] if not c["passed"]]
        suffix = f" failed: {failed}" if failed else ""
        print(f"  [{mark}] {r['id']}{suffix}")
    print(f"pass_rate={report['pass_rate']} ({report['passed_cases']}/{report['cases']} cases, "
          f"{report['passed_checks']}/{report['checks']} checks)")

    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    report_path = Path(f"eval-report-{args.mode}-{stamp}.json")
    report_path.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"report: {report_path}")

    exit_code = 0
    if report["pass_rate"] < args.min_pass:
        print(f"FAILED: pass rate {report['pass_rate']} < threshold {args.min_pass}")
        exit_code = 1
    if args.write_baseline:
        BASELINE.write_text(json.dumps({
            "mode": args.mode,
            "prompt_version": report["prompt_version"],
            "pass_rate": report["pass_rate"],
            "updated_at": report["generated_at"],
        }, indent=2) + "\n", encoding="utf-8")
        print(f"baseline written: {BASELINE}")
    if args.baseline and BASELINE.exists():
        baseline = json.loads(BASELINE.read_text(encoding="utf-8"))
        if report["pass_rate"] < baseline.get("pass_rate", 0.0):
            print(f"REGRESSION: pass rate {report['pass_rate']} < baseline {baseline['pass_rate']} "
                  f"(prompt {baseline.get('prompt_version', '?')} -> {report['prompt_version']})")
            exit_code = 1
    return exit_code


if __name__ == "__main__":
    sys.exit(main())
