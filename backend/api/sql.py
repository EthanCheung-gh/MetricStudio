"""SQL import endpoints + interactive query workbench."""

from __future__ import annotations

import os
import secrets
from pathlib import Path

from fastapi import APIRouter, HTTPException, UploadFile, File
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
_MAX_UPLOAD_BYTES = 512 * 1024 * 1024
_UPLOAD_DIR = Path.home() / ".metricstudio" / "uploads"


@router.post("/upload")
async def upload_database(file: UploadFile = File(...)):
    filename = Path(file.filename or "database.sqlite").name
    if Path(filename).suffix.lower() not in DB_EXTENSIONS:
        raise HTTPException(status_code=400, detail="请选择 SQLite 数据库文件（.db、.sqlite、.sqlite3 或 .db3）")
    contents = await file.read(_MAX_UPLOAD_BYTES + 1)
    if len(contents) > _MAX_UPLOAD_BYTES:
        raise HTTPException(status_code=413, detail="SQLite 文件不能超过 512 MB")
    if not contents.startswith(b"SQLite format 3\x00"):
        raise HTTPException(status_code=400, detail="文件不是有效的 SQLite 数据库")
    _UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
    target = _UPLOAD_DIR / f"{secrets.token_hex(8)}-{filename}"
    temp = target.with_suffix(target.suffix + ".tmp")
    try:
        temp.write_bytes(contents)
        temp.replace(target)
    except OSError as exc:
        temp.unlink(missing_ok=True)
        raise HTTPException(status_code=500, detail=f"无法保存 SQLite 文件: {exc}") from exc
    return {"path": str(target), "name": filename}


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


class QueryRequest(BaseModel):
    sql: str


class SnapshotRequest(BaseModel):
    name: str | None = None


@router.get("/workbench/schema")
async def workbench_schema():
    """Datasets (mirrored table names) available to the SQL workbench."""
    from backend.core.query_engine import safe_table_name

    return {
        "tables": [
            {"table": safe_table_name(ds.id, ds.name), "dataset": ds.name, "rows": ds.meta.rows,
             "columns": [c["name"] for c in ds.to_meta().model_dump(by_alias=True)["columns"]]}
            for ds in session.list_datasets()
        ]
    }


@router.post("/workbench/query")
async def workbench_query(request: QueryRequest):
    """Execute a validated read-only SELECT against the session datasets mirror."""
    from backend.core.query_engine import execute_query, query_history

    try:
        result = execute_query(session, request.sql)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except TimeoutError as exc:
        raise HTTPException(status_code=408, detail=str(exc)) from exc
    query_history.add(request.sql.strip(), result)
    _latest_result["columns"] = result["columns"]
    _latest_result["rows"] = result["rows"]
    return result


@router.get("/workbench/history")
async def workbench_history():
    from backend.core.query_engine import query_history

    return {"history": query_history.list()}


@router.delete("/workbench/history")
async def clear_workbench_history():
    from backend.core.query_engine import query_history

    query_history.clear()
    return {"cleared": True}


# Latest successful workbench result kept in-process for snapshotting.
_latest_result: dict[str, list | None] = {"columns": None, "rows": None}


@router.post("/workbench/import-result", response_model=None)
async def import_workbench_result(request: SnapshotRequest):
    """Import the latest workbench result as a new dataset."""
    columns = _latest_result.get("columns")
    rows = _latest_result.get("rows")
    if not columns or rows is None:
        raise HTTPException(status_code=409, detail="尚无可用的查询结果，请先执行一次查询")
    df = pd.DataFrame(rows, columns=[str(c) for c in columns])
    if df.empty:
        raise HTTPException(status_code=400, detail="查询结果为空，无法保存为数据集")
    actual_engine = session.engine.auto_engine(df)
    dataset = Dataset(df, name=request.name or "SQL Result", engine=actual_engine)
    session.datasets[dataset.id] = dataset
    session._persist(dataset)
    _latest_result["columns"] = None
    _latest_result["rows"] = None
    return dataset.to_meta()
