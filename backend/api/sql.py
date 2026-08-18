"""SQL import endpoints."""

from __future__ import annotations

import os
from pathlib import Path

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

import pandas as pd

from backend.core import sql
from backend.core.dataframe import Dataset
from backend.core.session import session

router = APIRouter(prefix="/api/v1/sql", tags=["sql"])


class TablesRequest(BaseModel):
    engine: str = "sqlite"
    path: str


class ImportRequest(BaseModel):
    engine: str = "sqlite"
    path: str
    table: str
    name: str | None = None


DB_EXTENSIONS = {".db", ".sqlite", ".sqlite3", ".db3"}


@router.get("/browse")
async def browse_dir(dir: str | None = None):
    """List subdirectories and SQLite database files in a server-side directory."""
    base = Path(dir).expanduser() if dir else Path.home()
    try:
        base = base.resolve(strict=True)
    except (OSError, RuntimeError) as exc:
        raise HTTPException(status_code=400, detail=f"目录不存在: {exc}") from exc
    if not base.is_dir():
        raise HTTPException(status_code=400, detail="不是目录")
    dirs: list[dict] = []
    files: list[dict] = []
    try:
        for entry in sorted(os.scandir(base), key=lambda e: e.name.lower()):
            if entry.name.startswith("."):
                continue
            try:
                if entry.is_dir(follow_symlinks=False):
                    dirs.append({"name": entry.name, "path": entry.path})
                elif entry.is_file() and Path(entry.name).suffix.lower() in DB_EXTENSIONS:
                    files.append({"name": entry.name, "path": entry.path})
            except OSError:
                continue
    except PermissionError as exc:
        raise HTTPException(status_code=400, detail="无权限访问该目录") from exc
    return {
        "dir": str(base),
        "parent": str(base.parent) if base.parent != base else None,
        "dirs": dirs[:100],
        "files": files[:200],
    }


@router.post("/tables")
async def list_tables(request: TablesRequest):
    try:
        return {"tables": sql.list_tables(request.engine, request.path)}
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/import")
async def import_table(request: ImportRequest):
    try:
        df = sql.read_table(request.engine, request.path, request.table)
        if not isinstance(df, pd.DataFrame):
            df = session._to_pandas(df)
        actual_engine = session.engine.auto_engine(df)
        dataset = Dataset(df, name=request.name or request.table, engine=actual_engine)
        session.datasets[dataset.id] = dataset
        stat = Path(request.path).stat()
        session.sources[dataset.id] = {
            "kind": "sqlite",
            "path": request.path,
            "original_path": request.path,
            "original_mtime_ns": stat.st_mtime_ns,
            "original_size": stat.st_size,
            "table": request.table,
        }
        session._persist(dataset)
        return dataset.to_meta()
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
