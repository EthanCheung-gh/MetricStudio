"""Structured logging for MetricStudio (v1.8.0).

One JSONL protocol shared by every producer (backend, SPA, and — after the
HarmonyOS port — hilog/sandbox sinks):

    {"ts": "...", "level": "info", "event": "...", "span": "...",
     "trace_id": "...", "session_id": "...", "turn_id": "...", "round": 1,
     "msg": "...", ...fields}

The protocol is the portable asset; only the sink (rotating files here)
is platform specific. Sensitive LLM prompt/response bodies never go through
this logger — they belong to backend.core.agent_trace.
"""

from __future__ import annotations

import contextvars
import json
import logging
import os
import sys
from datetime import datetime, timezone
from logging.handlers import RotatingFileHandler
from pathlib import Path
from typing import Any

# Request/agent correlation context. Set by the HTTP middleware (trace_id)
# and the NL endpoints (session/turn/round); read everywhere via current_ids().
trace_id_var: contextvars.ContextVar[str | None] = contextvars.ContextVar("trace_id", default=None)
session_id_var: contextvars.ContextVar[str | None] = contextvars.ContextVar("session_id", default=None)
turn_id_var: contextvars.ContextVar[str | None] = contextvars.ContextVar("turn_id", default=None)
round_var: contextvars.ContextVar[int | None] = contextvars.ContextVar("round", default=None)


def current_ids() -> dict[str, Any]:
    """Snapshot the correlation ids visible in the current context."""
    return {
        "trace_id": trace_id_var.get(),
        "session_id": session_id_var.get(),
        "turn_id": turn_id_var.get(),
        "round": round_var.get(),
    }


def logs_dir() -> Path:
    override = os.environ.get("METRICSTUDIO_LOG_DIR", "").strip()
    base = Path(override).expanduser() if override else _default_dir()
    base.mkdir(parents=True, exist_ok=True)
    return base


def _default_dir() -> Path:
    override = os.environ.get("METRICSTUDIO_CONFIG_DIR", "").strip()
    base = Path(override).expanduser() if override else Path.home() / ".metricstudio"
    return base / "logs"


def preview(text: Any, limit: int = 200) -> str:
    """First `limit` chars of a payload, for the metadata-only app log."""
    if text is None:
        return ""
    value = text if isinstance(text, str) else str(text)
    value = value.strip()
    return value if len(value) <= limit else value[:limit] + f"…(+{len(value) - limit})"


class JsonFormatter(logging.Formatter):
    """Render every record as one JSONL protocol line."""

    def format(self, record: logging.LogRecord) -> str:
        fields = getattr(record, "fields", None) or {}
        entry: dict[str, Any] = {
            "ts": datetime.now(timezone.utc).isoformat(timespec="milliseconds"),
            "level": record.levelname.lower(),
            "event": getattr(record, "event", None) or record.getMessage(),
            "span": getattr(record, "span", None) or record.name,
        }
        entry.update({k: v for k, v in current_ids().items() if v is not None})
        if isinstance(fields, dict) and fields:
            entry.update(fields)
        try:
            return json.dumps(entry, ensure_ascii=False, default=str)
        except (TypeError, ValueError):
            return json.dumps({"ts": entry["ts"], "level": entry["level"], "event": "unserializable_log_record"})


class EventLoggerAdapter:
    """Tiny adapter so call sites read as log.event("import_done", rows=3)."""

    def __init__(self, logger: logging.Logger) -> None:
        self._logger = logger

    def event(self, event: str, *, level: int = logging.INFO, span: str | None = None,
              exc: BaseException | None = None, **fields: Any) -> None:
        try:
            self._logger.log(
                level, event,
                extra={"event": event, "span": span or self._logger.name, "fields": fields},
                exc_info=exc if exc is not None else None,
            )
        except Exception:  # logging must never break the app
            pass


def get_logger(name: str) -> EventLoggerAdapter:
    return EventLoggerAdapter(logging.getLogger(name))


_CONFIGURED = False


def setup_logging() -> None:
    """Idempotently install the JSONL rotating-file sink + a console mirror."""
    global _CONFIGURED
    if _CONFIGURED:
        return
    root = logging.getLogger()
    root.setLevel(logging.INFO)
    formatter = JsonFormatter()

    app_handler = RotatingFileHandler(
        logs_dir() / "app.jsonl", maxBytes=5 * 1024 * 1024, backupCount=5, encoding="utf-8"
    )
    app_handler.setFormatter(formatter)
    root.addHandler(app_handler)

    console = logging.StreamHandler(sys.stderr)
    console.setFormatter(logging.Formatter("%(levelname)s %(name)s: %(message)s"))
    console.setLevel(logging.INFO)
    root.addHandler(console)

    # The agent-trace sink attaches to its own logger, not the root — its
    # records must not leak prompt bodies into app.jsonl or the console.
    trace_logger = logging.getLogger("agent.trace")
    trace_logger.setLevel(logging.INFO)
    trace_logger.propagate = False
    trace_handler = RotatingFileHandler(
        logs_dir() / "agent-trace.jsonl", maxBytes=20 * 1024 * 1024, backupCount=3, encoding="utf-8"
    )
    trace_handler.setFormatter(formatter)
    trace_logger.addHandler(trace_handler)

    # Third-party noise (httpx, uvicorn access) stays at WARNING.
    for noisy in ("httpx", "httpcore", "urllib3", "uvicorn.access"):
        logging.getLogger(noisy).setLevel(logging.WARNING)

    _CONFIGURED = True
