"""Privacy controls applied before dataset content is sent to an LLM."""

from __future__ import annotations

import re
from typing import Any

import pandas as pd

_SENSITIVE_NAME = re.compile(
    r"(?:^|[_\-\s])(email|e-mail|mail|phone|mobile|tel|telephone|address|street|zip|postal|"
    r"name|full.?name|first.?name|last.?name|id|identifier|ssn|passport|tax|bank|account|"
    r"card|credit|password|token|secret|birth|dob)(?:$|[_\-\s])",
    re.IGNORECASE,
)


def sensitive_columns(columns: list[object]) -> list[str]:
    """Return column names that are likely to contain direct identifiers."""
    return [str(column) for column in columns if _SENSITIVE_NAME.search(str(column))]


def prepare_for_llm(df: pd.DataFrame, config: dict[str, Any]) -> tuple[pd.DataFrame, list[str]]:
    """Apply the configured field scope without changing the source dataframe."""
    sensitive = sensitive_columns(list(df.columns))
    scope = config.get("data_scope", "all")
    if scope == "exclude_sensitive":
        return df.drop(columns=sensitive, errors="ignore"), sensitive
    if scope == "redact_sensitive":
        protected = df.copy()
        for column in sensitive:
            protected[column] = "[REDACTED]"
        return protected, sensitive
    return df, sensitive
