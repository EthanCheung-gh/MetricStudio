"""SQL data source access (SQLite first; Postgres/MySQL later)."""

from __future__ import annotations

from pathlib import Path
from typing import Any

import pandas as pd


def list_tables(engine: str, path: str) -> list[str]:
    """List table names for the given connection."""
    if engine != "sqlite":
        raise ValueError(f"Unsupported engine: {engine}")
    import sqlite3

    conn = sqlite3.connect(path)
    try:
        rows = conn.execute("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
        return [r[0] for r in rows.fetchall()]
    finally:
        conn.close()


def read_table(engine: str, path: str, table: str) -> pd.DataFrame:
    """Read a table into a DataFrame."""
    if engine != "sqlite":
        raise ValueError(f"Unsupported engine: {engine}")
    import sqlite3

    conn = sqlite3.connect(path)
    try:
        return pd.read_sql_query(f'SELECT * FROM "{table}"', conn)
    finally:
        conn.close()
