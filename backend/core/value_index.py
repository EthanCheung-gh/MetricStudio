"""Cached sorted distinct values used by filter controls on large datasets."""

from __future__ import annotations

import threading
from collections import OrderedDict
from typing import Any

import pandas as pd

_CACHE_MAX_ENTRIES = 64
_cache: OrderedDict[tuple[str, int, int, str], list[str]] = OrderedDict()
_lock = threading.Lock()


def cache_key(dataset: Any, column: str) -> tuple[str, int, int, str]:
    """Invalidate whenever the dataset's derived frame changes.

    Every transform operation assigns a new DataFrame to ``Dataset._df``, so the
    ``id()`` of the current frame plus the chain length form a cheap generation token.
    """
    return (dataset.id, len(dataset.history), id(dataset.df), column)


def sorted_unique_values(dataset: Any, column: str) -> list[str]:
    """Return all non-null values of ``column`` as sorted unique strings (cached)."""
    key = cache_key(dataset, column)
    with _lock:
        cached = _cache.get(key)
        if cached is not None:
            _cache.move_to_end(key)
            return cached
    series: pd.Series = dataset.df[column].dropna().astype(str).drop_duplicates().sort_values()
    values = series.tolist()
    with _lock:
        _cache[key] = values
        while len(_cache) > _CACHE_MAX_ENTRIES:
            _cache.popitem(last=False)
    return values


def clear_cache() -> None:
    with _lock:
        _cache.clear()
