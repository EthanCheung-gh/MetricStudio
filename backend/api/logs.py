"""SPA log ingestion (v1.8.0): client ring-buffer batches -> client.jsonl.

Accepts the same JSONL protocol entries the SPA logger records. Written to a
dedicated rotating sink so frontend errors/actions survive page reloads and
ship with diagnostics. The endpoint is best-effort: invalid entries are
skipped, never fatal.
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone
from logging.handlers import RotatingFileHandler
from pathlib import Path
from typing import Any

from fastapi import APIRouter
from pydantic import BaseModel, Field

from backend.core.logging_setup import logs_dir

router = APIRouter(prefix="/api/v1/logs", tags=["logs"])

_client_logger = logging.getLogger("client")
_configured = False


def _ensure_client_sink() -> None:
    global _configured
    if _configured:
        return
    target: Path = logs_dir() / "client.jsonl"
    handler = RotatingFileHandler(target, maxBytes=5 * 1024 * 1024, backupCount=3, encoding="utf-8")
    handler.setFormatter(logging.Formatter("%(message)s"))
    _client_logger.addHandler(handler)
    _client_logger.setLevel(logging.INFO)
    _client_logger.propagate = False
    _configured = True


class ClientLogEntry(BaseModel):
    ts: str | None = None
    level: str = "info"
    event: str
    span: str = "spa"
    trace_id: str | None = None
    session_id: str | None = None
    turn_id: str | None = None
    msg: str | None = None
    extra: dict[str, Any] = Field(default_factory=dict)


class ClientLogBatch(BaseModel):
    entries: list[ClientLogEntry] = Field(default_factory=list)


@router.post("/client")
async def ingest_client_logs(batch: ClientLogBatch):
    """Store a batch of SPA log entries. Returns the accepted count."""
    _ensure_client_sink()
    accepted = 0
    for entry in batch.entries[:500]:
        record: dict[str, Any] = {
            "ts": entry.ts or datetime.now(timezone.utc).isoformat(timespec="milliseconds"),
            "level": entry.level,
            "event": entry.event,
            "span": entry.span,
        }
        if entry.trace_id:
            record["trace_id"] = entry.trace_id
        if entry.session_id:
            record["session_id"] = entry.session_id
        if entry.turn_id:
            record["turn_id"] = entry.turn_id
        if entry.msg:
            record["msg"] = entry.msg
        if entry.extra:
            record.update(entry.extra)
        try:
            import json as _json

            _client_logger.info(_json.dumps(record, ensure_ascii=False, default=str))
            accepted += 1
            # Privacy tombstones belong next to the full bodies they mark.
            if entry.event == "qa_session_deleted" and entry.session_id:
                from backend.core.agent_trace import tombstone_session

                tombstone_session(entry.session_id)
        except Exception:
            continue
    return {"accepted": accepted}
