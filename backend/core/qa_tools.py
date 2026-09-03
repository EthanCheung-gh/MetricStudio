"""Deterministic Q&A tools executed on the real DataFrame.

Every tool follows the same contract:
- Inputs are validated leniently (fuzzy column matching, numeric coercion).
- Any failure returns ``{"ok": False, "detail": "<error>"}`` instead of
  raising, so the agent loop can feed the error back to the LLM and let it
  correct its arguments on the next round.
- Output details are compact, formatted strings sized to stay inside a
  prompt budget (top-N rows, capped column lists, 4-decimal floats).

The tool protocol is intentionally JSON-in-prompt (no provider-native
function calling) so any OpenAI-compatible backend works, including local
Ollama models.
"""

from __future__ import annotations

import math
from typing import Any

import pandas as pd

TOP_N_DEFAULT = 5
TOP_N_MAX = 10
CANDIDATE_LIMIT = 8
FLOAT_PRECISION = 4

AGG_FUNCS = ("sum", "mean", "count", "min", "max", "median", "nunique")
FILTER_OPERATORS = ("eq", "ne", "gt", "gte", "lt", "lte", "contains", "startswith", "endswith")
TIME_FREQ_MAP = {"day": "D", "week": "W", "month": "M", "quarter": "Q", "year": "Y"}

TOOLS_DESC = """Available tools (deterministic, executed on the real data):
- {"name": "row_count", "args": {}}
- {"name": "column_stats", "args": {"column": "<numeric column>"}}  # count/missing/min/max/mean/median
- {"name": "distinct_count", "args": {"column": "<column>"}}
- {"name": "groupby_agg", "args": {"column": "<group by>", "agg_column": "<optional numeric>", "agg": "sum|mean|count|min|max|median|nunique", "top_n": 5, "sort": "desc"}}
- {"name": "filter_stats", "args": {"conditions": [{"column": "...", "operator": "eq|ne|gt|gte|lt|lte|contains|startswith|endswith", "value": "..."}], "agg_column": "<optional>", "agg": "count|sum|mean|min|max"}}
- {"name": "value_counts_top", "args": {"column": "<column>", "top_n": 5}}  # distribution with shares
- {"name": "corr", "args": {"column_a": "<numeric>", "column_b": "<numeric>"}}  # pearson
- {"name": "time_agg", "args": {"column": "<datetime column>", "freq": "day|week|month|quarter|year", "agg_column": "<optional>", "agg": "count|sum|mean", "last_n": 12}}
- {"name": "quantile", "args": {"column": "<numeric>", "q": 0.25}}  # number or list
- {"name": "crosstab", "args": {"column_a": "<column>", "column_b": "<column>", "agg_column": "<optional>", "agg": "count|sum|mean"}}
- {"name": "range_info", "args": {"column": "<numeric or datetime column>"}}
Column names are matched case-insensitively; partial matches work when unambiguous."""


def _fmt(value: Any) -> str:
    """Compact, locale-stable formatting for prompt output."""
    if value is None or (isinstance(value, float) and math.isnan(value)):
        return "NA"
    if isinstance(value, bool):
        return str(value)
    if isinstance(value, float):
        text = f"{value:,.{FLOAT_PRECISION}f}".rstrip("0").rstrip(".")
        return text if text not in ("", "-") else "0"
    if isinstance(value, (int,)) and not isinstance(value, bool):
        return f"{value:,}"
    if hasattr(value, "isoformat"):
        return str(value)
    return str(value)


def _fmt_pair(column: str, value: Any) -> str:
    return f"{column}={_fmt(value)}"


def _resolve_column(df: pd.DataFrame, name: Any) -> tuple[str | None, str | None]:
    """Fuzzy-match a column name: exact, case-insensitive, then substring."""
    if not isinstance(name, str) or not name.strip():
        return None, "missing or empty 'column' argument"
    key = name.strip()
    columns = [str(c) for c in df.columns]
    if key in columns:
        return key, None
    lowered = key.casefold()
    exact = [c for c in columns if c.casefold() == lowered]
    if len(exact) == 1:
        return exact[0], None
    if len(exact) > 1:
        return None, f"ambiguous column '{key}', candidates: {', '.join(exact[:CANDIDATE_LIMIT])}"
    partial = [c for c in columns if lowered in c.casefold()]
    if len(partial) == 1:
        return partial[0], None
    if len(partial) > 1:
        return None, f"ambiguous column '{key}', candidates: {', '.join(partial[:CANDIDATE_LIMIT])}"
    return None, f"column '{key}' not found; available columns: {', '.join(columns[:CANDIDATE_LIMIT])}"


def _coerce_int(value: Any, label: str, default: int, minimum: int, maximum: int) -> tuple[int, str | None]:
    if value is None:
        return default, None
    try:
        number = int(value)
    except (TypeError, ValueError):
        return default, f"'{label}' must be an integer"
    return max(minimum, min(number, maximum)), None


def _numeric_columns(df: pd.DataFrame) -> list[str]:
    return [str(c) for c in df.select_dtypes(include="number").columns]


def _series_contains(series: pd.Series, value: Any, method: str) -> pd.Series:
    text = str(value)
    strings = series.astype("string")
    if method == "contains":
        return strings.str.contains(text, regex=False, case=False)
    lowered = strings.str.lower()
    if method == "startswith":
        return lowered.str.startswith(text.lower())
    return lowered.str.endswith(text.lower())


def _row_count(df: pd.DataFrame, args: dict[str, Any]) -> tuple[bool, str]:
    return True, f"row_count = {len(df)}"


def _column_stats(df: pd.DataFrame, args: dict[str, Any]) -> tuple[bool, str]:
    column, error = _resolve_column(df, args.get("column"))
    if error:
        return False, error
    series = df[column]
    if not pd.api.types.is_numeric_dtype(series):
        return False, f"column '{column}' is not numeric; use value_counts_top or distinct_count for it"
    dropna = series.dropna()
    if dropna.empty:
        return True, f"column_stats({column}): all {len(series)} values missing"
    return True, (
        f"column_stats({column}): count={len(dropna)}, missing={int(series.isna().sum())}, "
        f"min={_fmt(dropna.min())}, max={_fmt(dropna.max())}, "
        f"mean={_fmt(dropna.mean())}, median={_fmt(dropna.median())}"
    )


def _distinct_count(df: pd.DataFrame, args: dict[str, Any]) -> tuple[bool, str]:
    column, error = _resolve_column(df, args.get("column"))
    if error:
        return False, error
    return True, f"distinct_count({column}) = {int(df[column].nunique(dropna=True))}"


def _groupby_agg(df: pd.DataFrame, args: dict[str, Any]) -> tuple[bool, str]:
    group_column, error = _resolve_column(df, args.get("column"))
    if error:
        return False, error
    agg = str(args.get("agg", "count")).lower()
    if agg not in AGG_FUNCS:
        return False, f"invalid agg '{agg}'; use one of {', '.join(AGG_FUNCS)}"
    needs_agg_column = agg not in ("count", "nunique")
    agg_column = args.get("agg_column")
    if needs_agg_column:
        agg_column, error = _resolve_column(df, agg_column)
        if error:
            return False, f"agg '{agg}' requires a numeric agg_column: {error}"
    else:
        agg_column = _resolve_column(df, agg_column)[0] if agg_column else None
    top_n, error = _coerce_int(args.get("top_n"), "top_n", TOP_N_DEFAULT, 1, TOP_N_MAX)
    if error:
        return False, error
    ascending = str(args.get("sort", "desc")).lower() != "desc"
    if df.empty:
        return True, f"groupby_agg({group_column}): no rows"
    grouped = df.groupby(df[group_column].astype("string"), dropna=False)
    if agg_column is not None:
        result = grouped[agg_column].agg(agg)
        label = f"{agg}({agg_column}) by {group_column}"
    else:
        result = grouped.size()
        label = f"count by {group_column}"
    result = result.sort_values(ascending=ascending).head(top_n)
    pairs = ", ".join(_fmt_pair(str(index), value) for index, value in result.items())
    return True, f"{label} (top {len(result)}, {'asc' if ascending else 'desc'}): {pairs}"


def _filter_stats(df: pd.DataFrame, args: dict[str, Any]) -> tuple[bool, str]:
    conditions = args.get("conditions")
    if not isinstance(conditions, list) or not conditions:
        return False, "filter_stats requires a non-empty 'conditions' list"
    mask = pd.Series(True, index=df.index)
    descriptions: list[str] = []
    for condition in conditions[:6]:
        if not isinstance(condition, dict):
            return False, f"invalid condition: {condition!r}"
        column, error = _resolve_column(df, condition.get("column"))
        if error:
            return False, error
        operator = str(condition.get("operator", "eq")).lower()
        if operator not in FILTER_OPERATORS:
            return False, f"invalid operator '{operator}'; use one of {', '.join(FILTER_OPERATORS)}"
        value = condition.get("value")
        series = df[column]
        try:
            if operator in ("eq", "ne"):
                if pd.api.types.is_numeric_dtype(series) and value is not None and not isinstance(value, bool):
                    try:
                        value = float(value) if "." in str(value) else int(value)
                    except (TypeError, ValueError):
                        pass
                local = series.eq(value) if operator == "eq" else series.ne(value)
            elif operator == "gt":
                local = series.gt(value)
            elif operator == "gte":
                local = series.ge(value)
            elif operator == "lt":
                local = series.lt(value)
            elif operator == "lte":
                local = series.le(value)
            else:
                if pd.api.types.is_numeric_dtype(series):
                    return False, f"operator '{operator}' requires a text column, '{column}' is numeric"
                local = _series_contains(series, value, operator).fillna(False)
        except (TypeError, ValueError) as exc:
            return False, f"cannot compare {column} with {value!r} using '{operator}': {exc}"
        descriptions.append(f"{column} {operator} {value!r}")
        mask = mask & local.fillna(False)
    matched = df[mask]
    agg = str(args.get("agg", "count")).lower()
    agg_column = args.get("agg_column")
    if agg == "count":
        summary = f"matched_rows={len(matched)}"
    else:
        if not agg_column:
            return False, f"agg '{agg}' requires 'agg_column'"
        agg_column, error = _resolve_column(df, agg_column)
        if error:
            return False, error
        if matched.empty:
            summary = f"matched_rows=0, {agg}({agg_column})=NA"
        else:
            try:
                value = getattr(matched[agg_column], agg)()
            except (TypeError, ValueError) as exc:
                return False, f"agg '{agg}' failed on {agg_column}: {exc}"
            summary = f"matched_rows={len(matched)}, {agg}({agg_column})={_fmt(value)}"
    return True, f"filter [{'; '.join(descriptions)}]: {summary}"


def _value_counts_top(df: pd.DataFrame, args: dict[str, Any]) -> tuple[bool, str]:
    column, error = _resolve_column(df, args.get("column"))
    if error:
        return False, error
    top_n, error = _coerce_int(args.get("top_n"), "top_n", TOP_N_DEFAULT, 1, TOP_N_MAX)
    if error:
        return False, error
    counts = df[column].value_counts(dropna=True).head(top_n)
    total = int(df[column].notna().sum())
    if counts.empty:
        return True, f"value_counts({column}): no non-missing values"
    parts = [f"{index}={_fmt(value)}({value / total:.0%})" if total else f"{index}={_fmt(value)}" for index, value in counts.items()]
    missing = int(df[column].isna().sum())
    suffix = f", missing={missing}" if missing else ""
    return True, f"value_counts({column}) top {len(counts)}: {', '.join(parts)}{suffix}"


def _corr(df: pd.DataFrame, args: dict[str, Any]) -> tuple[bool, str]:
    column_a, error = _resolve_column(df, args.get("column_a"))
    if error:
        return False, f"column_a: {error}"
    column_b, error = _resolve_column(df, args.get("column_b"))
    if error:
        return False, f"column_b: {error}"
    for column in (column_a, column_b):
        if not pd.api.types.is_numeric_dtype(df[column]):
            return False, f"column '{column}' is not numeric"
    pair = pd.concat([df[column_a], df[column_b]], axis=1).dropna()
    if len(pair) < 2:
        return False, "not enough non-missing rows to compute correlation"
    coefficient = pair.iloc[:, 0].corr(pair.iloc[:, 1])
    if coefficient is None or pd.isna(coefficient):
        return False, "correlation is undefined (zero variance)"
    return True, f"corr({column_a}, {column_b}) = {_fmt(float(coefficient))} (pearson, n={len(pair)})"


def _time_agg(df: pd.DataFrame, args: dict[str, Any]) -> tuple[bool, str]:
    column, error = _resolve_column(df, args.get("column"))
    if error:
        return False, error
    freq_key = str(args.get("freq", "month")).lower()
    if freq_key not in TIME_FREQ_MAP:
        return False, f"invalid freq '{freq_key}'; use one of {', '.join(TIME_FREQ_MAP)}"
    parsed = pd.to_datetime(df[column], errors="coerce")
    if parsed.notna().sum() == 0:
        return False, f"column '{column}' could not be parsed as datetime"
    agg = str(args.get("agg", "count")).lower()
    agg_column = args.get("agg_column")
    if agg != "count":
        if not agg_column:
            return False, f"agg '{agg}' requires 'agg_column'"
        agg_column, error = _resolve_column(df, agg_column)
        if error:
            return False, error
    last_n, error = _coerce_int(args.get("last_n"), "last_n", 12, 1, 60)
    if error:
        return False, error
    periods = parsed.dt.to_period(TIME_FREQ_MAP[freq_key]).astype("string")
    if agg_column is not None:
        grouped = df.assign(__period=periods).groupby("__period")[agg_column].agg(agg)
        label = f"{agg}({agg_column})"
    else:
        grouped = periods.value_counts(sort=False).sort_index()
        label = "count"
    grouped = grouped.sort_index().tail(last_n)
    pairs = ", ".join(f"{index}={_fmt(value)}" for index, value in grouped.items())
    missing = int(parsed.isna().sum())
    suffix = f"; unparseable/missing={missing}" if missing else ""
    return True, f"time_agg: {label} per {freq_key} ({len(grouped)} periods, chronological): {pairs}{suffix}"


def _quantile(df: pd.DataFrame, args: dict[str, Any]) -> tuple[bool, str]:
    column, error = _resolve_column(df, args.get("column"))
    if error:
        return False, error
    if not pd.api.types.is_numeric_dtype(df[column]):
        return False, f"column '{column}' is not numeric"
    raw_q = args.get("q", 0.5)
    if isinstance(raw_q, str):
        raw_q = [part.strip() for part in raw_q.split(",") if part.strip()]
    if isinstance(raw_q, (int, float)):
        quantiles = [float(raw_q)]
    elif isinstance(raw_q, list):
        try:
            quantiles = [float(item) for item in raw_q]
        except (TypeError, ValueError):
            return False, "'q' must be a number or list of numbers"
    else:
        return False, "'q' must be a number or list of numbers"
    if not quantiles or any(q < 0 or q > 1 for q in quantiles):
        return False, "'q' values must be between 0 and 1"
    dropna = df[column].dropna()
    if dropna.empty:
        return False, f"column '{column}' has no non-missing values"
    values = dropna.quantile(quantiles)
    if isinstance(values, pd.Series):
        pairs = ", ".join(f"p{_fmt(float(q * 100))}={_fmt(v)}" for q, v in values.items())
        return True, f"quantile({column}): {pairs}"
    return True, f"quantile({column}): p{_fmt(float(quantiles[0] * 100))}={_fmt(float(values))}"


def _crosstab(df: pd.DataFrame, args: dict[str, Any]) -> tuple[bool, str]:
    column_a, error = _resolve_column(df, args.get("column_a"))
    if error:
        return False, f"column_a: {error}"
    column_b, error = _resolve_column(df, args.get("column_b"))
    if error:
        return False, f"column_b: {error}"
    agg = str(args.get("agg", "count")).lower()
    agg_column = args.get("agg_column")
    if df.empty:
        return True, f"crosstab({column_a}, {column_b}): no rows"
    if agg_column:
        agg_column, error = _resolve_column(df, agg_column)
        if error:
            return False, error
        try:
            table = pd.pivot_table(df, values=agg_column, index=df[column_a].astype("string"),
                                   columns=df[column_b].astype("string"), aggfunc=agg, dropna=True)
        except (TypeError, ValueError) as exc:
            return False, f"crosstab agg '{agg}' failed: {exc}"
        label = f"{agg}({agg_column})"
    else:
        if agg != "count":
            return False, "crosstab without agg_column only supports count; pass agg_column"
        table = pd.crosstab(df[column_a].astype("string"), df[column_b].astype("string"))
        label = "count"
    top_rows = table.loc[table.sum(axis=1).sort_values(ascending=False).head(TOP_N_DEFAULT).index]
    top_columns = list(table.sum(axis=0).sort_values(ascending=False).head(TOP_N_DEFAULT).index)
    top_rows = top_rows[top_columns]
    lines = [f"crosstab {label}: rows={column_a} (top {len(top_rows)}), columns={column_b} (top {len(top_columns)})"]
    header = " | ".join(str(c) for c in top_rows.columns)
    lines.append(f"{str(top_rows.index.name or column_a)} | {header}")
    for index, row in top_rows.iterrows():
        lines.append(f"{index} | " + " | ".join(_fmt(v) for v in row))
    return True, "\n".join(lines)


def _range_info(df: pd.DataFrame, args: dict[str, Any]) -> tuple[bool, str]:
    column, error = _resolve_column(df, args.get("column"))
    if error:
        return False, error
    series = df[column].dropna()
    if series.empty:
        return False, f"column '{column}' has no non-missing values"
    if pd.api.types.is_numeric_dtype(series):
        return True, f"range({column}): min={_fmt(series.min())}, max={_fmt(series.max())}, median={_fmt(series.median())}"
    parsed = pd.to_datetime(series, errors="coerce").dropna()
    if parsed.empty:
        return False, f"column '{column}' is neither numeric nor datetime-parseable"
    return True, f"range({column}): from={parsed.min()}, to={parsed.max()}"


_TOOLS = {
    "row_count": _row_count,
    "column_stats": _column_stats,
    "distinct_count": _distinct_count,
    "groupby_agg": _groupby_agg,
    "filter_stats": _filter_stats,
    "value_counts_top": _value_counts_top,
    "corr": _corr,
    "time_agg": _time_agg,
    "quantile": _quantile,
    "crosstab": _crosstab,
    "range_info": _range_info,
}


def run(df: pd.DataFrame, name: str, args: dict[str, Any]) -> dict[str, Any]:
    """Execute one tool; never raises. Returns {'ok', 'detail'}."""
    handler = _TOOLS.get(str(name))
    if handler is None:
        return {"ok": False, "detail": f"unknown tool '{name}'; available: {', '.join(_TOOLS)}"}
    if not isinstance(args, dict):
        args = {}
    try:
        ok, detail = handler(df, args)
    except Exception as exc:  # noqa: BLE001 - tool failures must reach the LLM as text
        return {"ok": False, "detail": f"{name} failed: {exc}"}
    return {"ok": bool(ok), "detail": str(detail)}
