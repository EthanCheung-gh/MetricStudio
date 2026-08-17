from __future__ import annotations

import io
from pathlib import Path

import pandas as pd
from tempfile import NamedTemporaryFile
from fastapi import APIRouter, UploadFile, File, Form, HTTPException
from fastapi.responses import Response, StreamingResponse

from backend.core.session import session
from backend.models.data import DataFrameMeta, DataPreview, DescribeResponse, ColumnMeta

router = APIRouter(prefix="/api/v1/data", tags=["data"])


@router.post("/import", response_model=list[DataFrameMeta], response_model_by_alias=True)
async def import_file(file: UploadFile = File(...), merge_sheets: bool = Form(False)):
    suffix = Path(file.filename or "data.csv").suffix
    try:
        contents = await file.read()
        with NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
            tmp.write(contents)
            tmp_path = tmp.name
        datasets = session.import_file(tmp_path, name=file.filename, merge_sheets=merge_sheets)
        Path(tmp_path).unlink(missing_ok=True)
        return [ds.to_meta() for ds in datasets]
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


def _parse_pasted_text(text: str) -> pd.DataFrame:
    """Parse pasted text: a JSON array/object, or delimited text (comma/tab/semicolon)."""
    s = text.strip()
    if s.startswith("[") or s.startswith("{"):
        import json as _json

        try:
            data = _json.loads(s)
        except _json.JSONDecodeError:
            # NDJSON: one JSON object per line
            return pd.read_json(io.StringIO(s), lines=True)
        if isinstance(data, list):
            return pd.json_normalize(data)
        return pd.json_normalize([data])
    # Delimited text: let pandas sniff the separator (tab for Excel copies, comma, etc.)
    return pd.read_csv(io.StringIO(s), sep=None, engine="python")


@router.post("/import-text", response_model=list[DataFrameMeta], response_model_by_alias=True)
async def import_text(payload: dict):
    """Import pasted text (CSV / TSV / JSON records) as a new dataset (no source file)."""
    name = str(payload.get("name") or "Pasted data")
    text = str(payload.get("text") or "")
    if not text.strip():
        raise HTTPException(status_code=400, detail="No text provided")
    try:
        df = _parse_pasted_text(text)
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Could not parse pasted text: {exc}") from exc
    if df.empty:
        raise HTTPException(status_code=400, detail="Pasted text produced no rows")
    dataset = session.import_dataframe(df, name=name)
    return [dataset.to_meta()]


@router.get("/list", response_model=list[DataFrameMeta], response_model_by_alias=True)
async def list_dataframes():
    return [ds.to_meta() for ds in session.list_datasets()]


@router.get("/lineage")
async def get_lineage():
    """Lineage DAG over all datasets: state nodes + operation edges (joins cross datasets)."""
    return session.build_lineage()


@router.get("/{dataset_id}", response_model=DataFrameMeta, response_model_by_alias=True)
async def get_dataframe(dataset_id: str):
    try:
        return session.get(dataset_id).to_meta()
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.get("/{dataset_id}/preview", response_model=DataPreview, response_model_by_alias=True)
async def preview_dataframe(dataset_id: str, limit: int = 100, at: int | None = None):
    try:
        dataset = session.get(dataset_id)
        if at is None or at >= len(dataset.history):
            preview = dataset.preview(limit)
        else:
            # Read-only snapshot of the state after `at` operations (-1 = import).
            preview = session.preview_at(dataset_id, at, limit)
        return DataPreview(**preview)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.get("/{dataset_id}/columns", response_model=list[ColumnMeta], response_model_by_alias=True)
async def get_columns(dataset_id: str):
    try:
        return session.get(dataset_id).to_meta().columns
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.post("/{dataset_id}/refresh", response_model=DataFrameMeta, response_model_by_alias=True)
async def refresh_dataset(dataset_id: str):
    """Re-read the persisted source file and replay the transform history."""
    try:
        dataset = session.refresh_dataset(dataset_id)
        return dataset.to_meta()
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.get("/{dataset_id}/quality")
async def data_quality(dataset_id: str):
    """Rule-based data quality report + available cleaning recipes."""
    from backend.core.quality import detect_quality
    from backend.core.recipes import list_recipes

    try:
        dataset = session.get(dataset_id)
        report = detect_quality(dataset.df)
        report["recipes"] = list_recipes()
        return report
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.post("/diff")
async def diff_datasets(payload: dict):
    """Compare two datasets: rows/cols, column-set difference, numeric mean delta."""
    left_id = payload.get("left_id")
    right_id = payload.get("right_id")
    try:
        left = session.get(left_id).df
        right = session.get(right_id).df
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc

    left_cols = set(left.columns)
    right_cols = set(right.columns)
    common = [c for c in left.columns if c in right.columns]
    numeric_diff = []
    for c in common:
        if pd.api.types.is_numeric_dtype(left[c]) and pd.api.types.is_numeric_dtype(right[c]):
            numeric_diff.append({
                "column": c,
                "left_mean": round(float(left[c].mean()), 2),
                "right_mean": round(float(right[c].mean()), 2),
            })

    return {
        "left_rows": len(left),
        "right_rows": len(right),
        "left_cols": len(left.columns),
        "right_cols": len(right.columns),
        "only_left": sorted(left_cols - right_cols),
        "only_right": sorted(right_cols - left_cols),
        "numeric_diff": numeric_diff,
    }


@router.get("/{dataset_id}/timeseries")
async def timeseries(dataset_id: str, column: str):
    """Monthly aggregation + period-over-period change for a numeric column."""
    from backend.core.timeseries import analyze_timeseries

    try:
        dataset = session.get(dataset_id)
        return analyze_timeseries(dataset.df, column)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.get("/{dataset_id}/chart-recommendations")
async def chart_recommendations(dataset_id: str):
    """Rule-based chart type + encoding recommendations for a dataset."""
    from backend.core.recommend import recommend_charts

    try:
        dataset = session.get(dataset_id)
        return {"recommendations": recommend_charts(dataset.df)}
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.get("/{dataset_id}/insights")
async def data_insights(dataset_id: str):
    """Rule-based data insights; each item carries data evidence for verification."""
    from backend.core.insights import generate_insights

    try:
        dataset = session.get(dataset_id)
        return {"insights": generate_insights(dataset.df)}
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.get("/{dataset_id}/describe", response_model=DescribeResponse, response_model_by_alias=True)
async def describe_dataframe(dataset_id: str):
    try:
        dataset = session.get(dataset_id)
        return DescribeResponse(**dataset.describe())
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.delete("/{dataset_id}")
async def delete_dataframe(dataset_id: str):
    session.delete_dataset(dataset_id)
    return {"ok": True}


@router.get("/{dataset_id}/aggregate")
async def aggregate_value(dataset_id: str, field: str, agg: str = "sum"):
    """Single aggregate value for a field (drives dashboard KPI cards)."""
    try:
        dataset = session.get(dataset_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    df = dataset.df
    if field not in df.columns:
        raise HTTPException(status_code=404, detail=f"Column not found: {field}")
    series = df[field]
    try:
        if agg == "sum":
            val = series.sum()
        elif agg == "mean":
            val = series.mean()
        elif agg == "count":
            val = int(series.count())
        elif agg == "min":
            val = series.min()
        elif agg == "max":
            val = series.max()
        elif agg == "nunique":
            val = int(series.nunique())
        else:
            raise HTTPException(status_code=400, detail=f"Unsupported agg: {agg}")
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Aggregation failed: {exc}") from exc
    if val is None or (isinstance(val, float) and val != val):  # None or NaN
        return {"value": None}
    return {"value": float(val)}


@router.get("/{dataset_id}/export")
async def export_dataframe(dataset_id: str, format: str = "csv"):
    """Download the current derived state as CSV or Parquet."""
    try:
        dataset = session.get(dataset_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc

    df = dataset.df
    if format == "csv":
        buf = io.StringIO()
        df.to_csv(buf, index=False)
        filename = f"{dataset.name}.csv"
        return StreamingResponse(
            iter([buf.getvalue()]),
            media_type="text/csv",
            headers={"Content-Disposition": f'attachment; filename="{filename}"'},
        )
    if format == "parquet":
        buf = io.BytesIO()
        df.to_parquet(buf, index=False)
        filename = f"{dataset.name}.parquet"
        return Response(
            content=buf.getvalue(),
            media_type="application/octet-stream",
            headers={"Content-Disposition": f'attachment; filename="{filename}"'},
        )
    raise HTTPException(status_code=400, detail=f"Unsupported format: {format}")
