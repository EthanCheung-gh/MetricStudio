from __future__ import annotations

import os
import sys
import time
import uuid
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any

# Allow running `python backend/main.py` directly by adding the project root to sys.path.
ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from backend.api import data, transform, chart, project, report, recipes, nl, sql, snapshots
from backend.core.logging_setup import get_logger, setup_logging, trace_id_var

log = get_logger("main")


@asynccontextmanager
async def lifespan(app: FastAPI):
    setup_logging()
    # Startup: rebuild datasets + operation chains persisted from a previous run (spec §3.3)
    from backend.core.session import session

    restored = session.restore()
    if restored:
        log.event("session_restored", datasets=restored)
    yield
    # Shutdown: session state is already persisted incrementally


class TraceMiddleware:
    """v1.8.0: one JSONL line per request in app.jsonl.

    Pure ASGI (not BaseHTTPMiddleware) so SSE responses are timed to their
    last byte, not to the first chunk. The trace id comes from the SPA
    (X-Trace-Id) or is generated here; it is echoed back in the response
    header and pinned to the logging context for the whole request.
    """

    def __init__(self, app: Any) -> None:
        self.app = app

    async def __call__(self, scope: Any, receive: Any, send: Any) -> None:
        if scope["type"] != "http" or scope.get("method") == "OPTIONS":
            await self.app(scope, receive, send)
            return
        path = scope.get("path", "")
        if path in ("/health", "/"):
            await self.app(scope, receive, send)
            return

        headers = {k.decode("latin-1").lower(): v.decode("latin-1") for k, v in scope.get("headers", [])}
        trace_id = headers.get("x-trace-id") or uuid.uuid4().hex[:16]
        token = trace_id_var.set(trace_id)
        started = time.monotonic()
        status_holder = {"status": 0}

        async def send_wrapper(message: Any) -> None:
            if message["type"] == "http.response.start":
                status_holder["status"] = message["status"]
                raw_headers = list(message.get("headers", []))
                raw_headers.append((b"x-trace-id", trace_id.encode("latin-1")))
                message = {**message, "headers": raw_headers}
            await send(message)

        try:
            await self.app(scope, receive, send_wrapper)
            # Logged while trace_id is still pinned (reset happens in finally).
            log.event("request", span="http", method=scope.get("method"), path=path,
                      status=status_holder["status"],
                      elapsed_ms=round((time.monotonic() - started) * 1000, 1),
                      client_generated=bool(headers.get("x-trace-id")))
        except Exception as exc:
            log.event("request_error", span="http", method=scope.get("method"), path=path,
                      trace_id=trace_id, elapsed_ms=round((time.monotonic() - started) * 1000, 1),
                      exc=exc)
            raise
        finally:
            trace_id_var.reset(token)


app = FastAPI(
    title="MetricStudio Backend",
    version="1.8.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    # Local personal tool: allow any origin so browser dev works over
    # localhost, LAN IPs (e.g. 172.x:5174) and Tauri webview origins alike.
    # allow_credentials stays False, so the wildcard is valid.
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)
app.add_middleware(TraceMiddleware)


@app.get("/", include_in_schema=False)
async def root():
    return {
        "message": "MetricStudio backend API — this is not the web app. Open the Vite dev server (http://localhost:5173) instead.",
        "docs": "/docs",
        "health": "/health",
    }


@app.get("/health")
async def health():
    return {"status": "ok"}


# Packages validated at startup per spec §11 (dtale is optional — wrapper falls back to pandas)
REQUIRED_PACKAGES = ["pandas", "polars", "fastapi", "uvicorn", "pyarrow", "openpyxl"]
OPTIONAL_PACKAGES = ["dtale"]


@app.get("/api/v1/system/deps")
async def dependency_check():
    import importlib.metadata as md

    def pkg_info(name: str) -> dict:
        try:
            return {"available": True, "version": md.version(name)}
        except md.PackageNotFoundError:
            return {"available": False, "version": None}

    packages = {name: pkg_info(name) for name in REQUIRED_PACKAGES + OPTIONAL_PACKAGES}
    missing_required = [name for name in REQUIRED_PACKAGES if not packages[name]["available"]]
    missing_optional = [name for name in OPTIONAL_PACKAGES if not packages[name]["available"]]
    return {
        "python": sys.version.split()[0],
        "pythonOk": sys.version_info >= (3, 10),
        "packages": packages,
        "missingRequired": missing_required,
        "missingOptional": missing_optional,
        "ok": sys.version_info >= (3, 10) and not missing_required,
    }


app.include_router(data.router)
app.include_router(transform.router)
app.include_router(chart.router)
app.include_router(project.router)
app.include_router(report.router)
app.include_router(recipes.router)
app.include_router(nl.router)
app.include_router(sql.router)
app.include_router(snapshots.router)


if __name__ == "__main__":
    import uvicorn

    port = int(os.environ.get("METRICSTUDIO_PORT", "8123"))
    # Pass the app object directly (not "backend.main:app" string) so the same
    # entry works under PyInstaller, where this module is __main__, not backend.main.
    uvicorn.run(app, host="127.0.0.1", port=port, reload=False)
