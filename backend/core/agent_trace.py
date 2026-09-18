"""Agent-trace sink: the full-body, tuning-oriented log layer (v1.8.0).

Primary consumer scenario per design review: Agent behaviour tuning —
"this answer was wrong; pull the complete prompt / tool chain / response
for that turn". Every LLM prompt and response body is written here in
full, correlated by the shared protocol ids (trace/session/turn/round).

Privacy posture (agreed in review):
- This file is the designated FULL-BODY copy; the app log only carries
  metadata + 200-char previews.
- Deleting a QA session writes a tombstone (frontend calls /client-log
  with event=qa_session_deleted); a settings action can purge the file.
- The diagnostics bundle excludes this file unless explicitly requested.
"""

from __future__ import annotations

import json
import logging
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from backend.core.logging_setup import current_ids, logs_dir

TRACE_LOGGER = logging.getLogger("agent.trace")


def trace_path() -> Path:
    return logs_dir() / "agent-trace.jsonl"


def _write(entry: dict[str, Any]) -> None:
    """Append one trace line; logging must never break the request flow."""
    try:
        record = {"ts": datetime.now(timezone.utc).isoformat(timespec="milliseconds"), **entry}
        ids = {k: v for k, v in current_ids().items() if v is not None}
        for key, value in ids.items():
            record.setdefault(key, value)
        TRACE_LOGGER.info("", extra={"event": record.pop("event", "trace"), "span": record.pop("span", "agent"), "fields": record})
    except Exception:
        pass


def trace_event(event: str, span: str = "agent", **fields: Any) -> None:
    """Generic trace line (round boundaries, tool calls, degradation...)."""
    _write({"event": event, "span": span, **fields})


def trace_llm_call(
    *,
    span: str,
    messages: list[dict[str, str]],
    reply: str | None,
    model: str,
    elapsed_ms: float,
    ok: bool,
    error: str | None = None,
    stream: bool = False,
    **extra_ids: Any,
) -> None:
    """Full-body record of one LLM chat call (prompt + response + timing).

    extra_ids carries explicit correlation ids (session_id/turn_id/round)
    from sync-generator call sites whose ContextVar writes don't persist.
    """
    _write({
        "event": "llm_call",
        "span": span,
        "stream": stream,
        "ok": ok,
        "model": model,
        "elapsed_ms": round(elapsed_ms, 1),
        "prompt_messages": messages,
        "reply": reply,
        "error": error,
        **extra_ids,
    })


def tombstone_session(session_id: str, reason: str = "user_deleted") -> None:
    """Mark a deleted QA session so consumers know its trace bodies are stale."""
    _write({"event": "qa_session_deleted", "span": "privacy", "deleted_session_id": session_id, "reason": reason})


def purge_traces() -> int:
    """Truncate the live trace file through its own handler (offsets stay
    consistent) and delete rotated backups; returns the bytes reclaimed."""
    reclaimed = 0
    try:
        for handler in TRACE_LOGGER.handlers:
            stream = getattr(handler, "stream", None)
            if stream is None or stream.closed:
                continue
            try:
                pos = stream.tell()
                stream.seek(0)
                stream.truncate()
                stream.seek(0)
                reclaimed += pos
                # Rotated backups hold equally stale prompt bodies — remove them.
                base: Path = Path(handler.baseFilename)
                for backup in base.parent.glob(base.name + ".*"):
                    try:
                        reclaimed += backup.stat().st_size
                        backup.unlink()
                    except OSError:
                        continue
            except (OSError, ValueError):
                continue
    except Exception:
        pass
    _write({"event": "trace_purged", "span": "privacy", "reclaimed_bytes": reclaimed})
    return reclaimed
