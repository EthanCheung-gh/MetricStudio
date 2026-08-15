"""SQL import endpoints."""

from __future__ import annotations

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
        session._persist(dataset)
        return dataset.to_meta()
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
