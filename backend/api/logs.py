"""SPA log ingestion (v1.8.0): client ring-buffer batches -> client.jsonl.

Accepts the same JSONL protocol entries the SPA logger records. Written to a
dedicated rotating sink so frontend errors/actions survive page reloads and
ship with diagnostics. The endpoint is best-effort: invalid entries are
skipped, never fatal.
"""

from __future__ import annotations

import io
import json
import logging
import platform
import sys
import zipfile
from datetime import datetime, timezone
from logging.handlers import RotatingFileHandler
from pathlib import Path
from typing import Any

from fastapi import APIRouter, Query
from fastapi.responses import Response
from pydantic import BaseModel, Field

from backend.core.agent_trace import purge_traces
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


@router.get("/diagnostics/export")
def export_diagnostics(include_trace: bool = Query(False, description="Include the full-body agent trace")):
    """One-click diagnostics bundle (v1.8.0).

    A zip with system metadata plus the rotating app/client logs. The
    agent-trace file (full LLM prompts/responses) is EXCLUDED by default —
    it is the sensitive second copy and must be an explicit opt-in.
    """
    base = logs_dir()
    manifest = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "app": "MetricStudio",
        "version": _app_version(),
        "python": sys.version.split()[0],
        "platform": platform.platform(),
        "includes_agent_trace": include_trace,
    }
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED) as zf:
        zf.writestr("manifest.json", json.dumps(manifest, indent=2))
        for name in ("app.jsonl", "client.jsonl"):
            path = base / name
            if path.exists():
                zf.write(path, name)
        if include_trace:
            trace = base / "agent-trace.jsonl"
            if trace.exists():
                zf.write(trace, "agent-trace.jsonl")
    filename = f"metricstudio-diagnostics-{datetime.now(timezone.utc).strftime('%Y%m%d-%H%M%S')}.zip"
    return Response(
        content=buffer.getvalue(),
        media_type="application/zip",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.post("/purge-trace")
def purge_agent_trace():
    """Wipe the full-body agent trace (live file truncated, rotations removed)."""
    reclaimed = purge_traces()
    return {"purged": True, "reclaimed_bytes": reclaimed}


def _app_version() -> str:
    try:
        from backend.main import app as fastapi_app

        return getattr(fastapi_app, "version", "unknown")
    except Exception:
        return "unknown"
