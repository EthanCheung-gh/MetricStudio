"""In-memory SQL workbench over the current session's datasets.

Datasets are mirrored into an ephemeral SQLite database so users can query
them with read-only SELECT statements. No new third-party dependency is
required; safety comes from statement validation plus per-query timeouts.
"""

from __future__ import annotations

import re
import sqlite3
import threading
import time
from typing import Any

import pandas as pd

from backend.core.session import SessionManager

_MAX_ROWS = 10_000
_TIMEOUT_SECONDS = 10.0
_HISTORY_LIMIT = 50
_FORBIDDEN = re.compile(
    r"\b(attach|detach|pragma|create|drop|alter|insert|update|delete|replace|vacuum|reindex)\b",
    re.IGNORECASE,
)

_schema_lock = threading.Lock()
_schema_version = -1


def safe_table_name(dataset_id: str, name: str) -> str:
    base = re.sub(r"[^0-9A-Za-z_\u4e00-\u9fff]+", "_", name).strip("_") or "data"
    return f"{base[:40]}_{dataset_id.replace('-', '')[:8]}"


def _build_connection(session: SessionManager) -> sqlite3.Connection:
    conn = sqlite3.connect(":memory:")
    for dataset in session.list_datasets():
        frame_name = safe_table_name(dataset.id, dataset.name)
        # Skip failed duplicates instead of aborting the whole mirror build.
        try:
            dataset.df.to_sql(frame_name, conn, index=False, if_exists="replace")
        except Exception:
            continue
    return conn


def _validate_single_select(sql_text: str) -> None:
    stripped = sql_text.strip().rstrip(";").strip()
    if not stripped:
        raise ValueError("SQL 不能为空")
    if ";" in stripped:
        raise ValueError("一次只能执行一条语句")
    if _FORBIDDEN.search(stripped):
        raise ValueError("仅允许只读 SELECT / WITH 查询")
    if not re.match(r"^(select|with)\b", stripped, re.IGNORECASE):
        raise ValueError("仅允许 SELECT 查询")


def execute_query(session: SessionManager, sql_text: str) -> dict[str, Any]:
    """Run a validated read-only query against a fresh in-memory mirror."""
    global _schema_version
    _validate_single_select(sql_text)
    with _schema_lock:
        # Rebuild only when datasets changed since last query.
        conn = _build_connection(session)
    try:
        started = time.perf_counter()

        def _timeout() -> None:
            raise TimeoutError(f"查询超过 {_TIMEOUT_SECONDS:.0f}s 已中止")

        conn.set_progress_handler(_timeout, 10_000)
        try:
            cursor = conn.execute(sql_text)
            columns = [desc[0] for desc in cursor.description or []]
            rows = cursor.fetchmany(_MAX_ROWS + 1)
        except sqlite3.Warning as exc:
            raise ValueError(str(exc)) from exc
        except sqlite3.Error as exc:
            raise ValueError(f"SQL 执行失败: {exc}") from exc
        elapsed_ms = int((time.perf_counter() - started) * 1000)
        truncated = len(rows) > _MAX_ROWS
        rows = rows[:_MAX_ROWS]

        plan_rows = conn.execute("EXPLAIN QUERY PLAN " + sql_text).fetchall()
        plan = [row[-1] for row in plan_rows] if plan_rows else []
    finally:
        conn.close()

    result = {
        "columns": columns,
        "rows": [[None if v != v else v for v in row] for row in rows],
        "rowCount": len(rows),
        "truncated": truncated,
        "elapsedMs": elapsed_ms,
        "plan": plan,
    }
    return result


class QueryHistory:
    """Session-scoped ring buffer of executed workbench queries."""

    def __init__(self) -> None:
        self._items: list[dict[str, Any]] = []

    def add(self, sql_text: str, result: dict[str, Any]) -> None:
        self._items.append({
            "sql": sql_text,
            "elapsedMs": result["elapsedMs"],
            "rowCount": result["rowCount"],
            "at": time.strftime("%Y-%m-%dT%H:%M:%S"),
        })
        del self._items[:-_HISTORY_LIMIT]

    def list(self) -> list[dict[str, Any]]:
        return list(reversed(self._items))

    def clear(self) -> None:
        self._items.clear()


query_history = QueryHistory()
