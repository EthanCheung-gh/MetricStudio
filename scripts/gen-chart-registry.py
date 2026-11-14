#!/usr/bin/env python3
"""Generate src/utils/chartTypeRegistry.generated.ts from the Python registry.

Run from the repo root:

    backend/.venv/bin/python scripts/gen-chart-registry.py
    backend/.venv/bin/python scripts/gen-chart-registry.py --check

``--check`` regenerates in memory and compares with the committed file, so a
drift test can assert the frontend mirror still matches backend/core/chart_registry.py.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from backend.core.chart_registry import CHART_TYPES, ChartTypeDef

TARGET = ROOT / "src" / "utils" / "chartTypeRegistry.generated.ts"

HEADER = """// AUTO-GENERATED from backend/core/chart_registry.py — do not edit by hand.
// Regenerate: backend/.venv/bin/python scripts/gen-chart-registry.py

export interface GeneratedChartType {
  readonly id: string
  readonly label: string
  readonly group: string
  readonly yFields: 'multi' | 'first' | 'none'
  readonly channels: readonly string[]
  readonly options: readonly string[]
  readonly dimensions: 'dimensions' | 'columns' | null
  readonly path: boolean
  readonly samplable: boolean
  readonly relational: boolean
  readonly keywords: readonly string[]
}
"""

MAX_INLINE = 100


def _ts_string(value: str) -> str:
    return json.dumps(value, ensure_ascii=False)


def _ts_bool(value: bool) -> str:
    return "true" if value else "false"


def _ts_nullable(value: str | None) -> str:
    return "null" if value is None else _ts_string(value)


def _ts_array(values: tuple[str, ...], indent: str, key: str) -> str:
    array = "[" + ", ".join(_ts_string(v) for v in values) + "]"
    line = f"{indent}{key}: {array},"
    if len(array) <= MAX_INLINE and len(line) <= MAX_INLINE:
        return line
    inner = f"{indent}  "
    items = "".join(f"{inner}{_ts_string(v)},\n" for v in values)
    return f"{indent}{key}: [\n{items}{indent}],"


def _render_entry(spec: ChartTypeDef) -> str:
    indent = "    "
    fields = [
        f"{indent}id: {_ts_string(spec.id)},",
        f"{indent}label: {_ts_string(spec.label)},",
        f"{indent}group: {_ts_string(spec.group)},",
        f"{indent}yFields: {_ts_string(spec.y_fields)},",
        _ts_array(spec.channels, indent, "channels"),
        _ts_array(spec.options, indent, "options"),
        f"{indent}dimensions: {_ts_nullable(spec.dimensions)},",
        f"{indent}path: {_ts_bool(spec.path)},",
        f"{indent}samplable: {_ts_bool(spec.samplable)},",
        f"{indent}relational: {_ts_bool(spec.relational)},",
        _ts_array(spec.keywords, indent, "keywords"),
    ]
    return "  {\n" + "\n".join(fields) + "\n  },"


def render() -> str:
    entries = "\n".join(_render_entry(spec) for spec in CHART_TYPES)
    return (
        HEADER
        + "\nexport const GENERATED_CHART_TYPES: readonly GeneratedChartType[] = [\n"
        + entries
        + "\n]\n\nexport const GENERATED_CHART_TYPE_IDS: readonly string[] = "
        + "GENERATED_CHART_TYPES.map((t) => t.id)\n"
    )


def _diff_summary(expected: str, actual: str) -> str:
    exp = expected.splitlines()
    act = actual.splitlines()
    for index in range(max(len(exp), len(act))):
        want = exp[index] if index < len(exp) else "<missing>"
        have = act[index] if index < len(act) else "<missing>"
        if want != have:
            return (
                f"first difference at line {index + 1}:\n"
                f"  expected: {want}\n"
                f"  actual:   {have}\n"
                f"({len(exp)} expected lines, {len(act)} on disk)"
            )
    return "files differ"


def main(argv: list[str]) -> int:
    content = render()
    if "--check" in argv:
        if not TARGET.exists():
            print(f"missing {TARGET.relative_to(ROOT)}: chart registry TS is out of date")
            return 1
        actual = TARGET.read_text(encoding="utf-8")
        if actual == content:
            print("chart registry TS is up to date")
            return 0
        print(f"chart registry TS is out of date — {_diff_summary(content, actual)}")
        return 1
    TARGET.write_text(content, encoding="utf-8")
    print(f"wrote {TARGET.relative_to(ROOT)} ({len(CHART_TYPES)} chart types)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
