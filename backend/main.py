from __future__ import annotations

import os
import sys
from contextlib import asynccontextmanager
from pathlib import Path

# Allow running `python backend/main.py` directly by adding the project root to sys.path.
ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from backend.api import data, transform, chart, project, report, recipes, nl, sql, snapshots


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup: rebuild datasets + operation chains persisted from a previous run (spec §3.3)
    from backend.core.session import session

    restored = session.restore()
    if restored:
        import logging

        logging.getLogger("main").info("session restored: %d dataset(s)", restored)
    yield
    # Shutdown: session state is already persisted incrementally


app = FastAPI(
    title="MetricStudio Backend",
    version="0.3.4",
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


@app.get("/", include_in_schema=False)
async def root():
    return {
        "message": "MetricStudio backend API — this is not the web app. Open the Vite dev server (http://localhost:5174) instead.",
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
