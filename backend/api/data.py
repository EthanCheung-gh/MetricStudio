from __future__ import annotations

import io
import json
import math
from pathlib import Path

import pandas as pd
from tempfile import NamedTemporaryFile
from fastapi import APIRouter, UploadFile, File, Form, HTTPException
from fastapi.responses import Response, StreamingResponse

from backend.core.privacy import sensitive_columns
from backend.core.session import session
from backend.models.data import DataFrameMeta, DataPreview, DescribeResponse, ColumnMeta

router = APIRouter(prefix="/api/v1/data", tags=["data"])


@router.post("/import-path", response_model=list[DataFrameMeta], response_model_by_alias=True)
async def import_path(payload: dict):
    """Import a server-local file while retaining its original path for change detection."""
    path = Path(str(payload.get("path") or "")).expanduser()
    if not path.is_file():
        raise HTTPException(status_code=400, detail="Source file does not exist")
    try:
        return [
            dataset.to_meta()
            for dataset in session.import_file(
                path,
                name=payload.get("name") or path.name,
                merge_sheets=bool(payload.get("merge_sheets", False)),
                original_path=path,
            )
        ]
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


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


@router.post("/sample", response_model=DataFrameMeta, response_model_by_alias=True)
async def import_sample():
    """Import the bundled sample once, returning the existing sample on repeated calls."""
    try:
        for dataset_id, source in session.sources.items():
            if source.get("kind") == "sample" and dataset_id in session.datasets:
                return session.get(dataset_id).to_meta()
        sample_path = Path(__file__).resolve().parents[2] / "sample_data.csv"
        if not sample_path.exists():
            # PyInstaller onefile extracts bundled data under sys._MEIPASS.
            import sys

            sample_path = Path(getattr(sys, "_MEIPASS", "")) / "sample_data.csv"
        dataset = session.import_file(sample_path, name="MetricStudio Sample")[0]
        session.sources[dataset.id]["kind"] = "sample"
        session._persist(dataset)
        return dataset.to_meta()
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


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


@router.get("/sources/status")
async def source_status():
    return session.source_status()


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
async def preview_dataframe(
    dataset_id: str,
    limit: int = 100,
    offset: int = 0,
    at: int | None = None,
    sort_by: str | None = None,
    sort_asc: bool = True,
    filters: str | None = None,
    search: str | None = None,
):
    try:
        column_filters = json.loads(filters) if filters else None
        if column_filters is not None and not isinstance(column_filters, dict):
            raise ValueError("filters must be a JSON object")
        dataset = session.get(dataset_id)
        if at is None or at >= len(dataset.history):
            preview = dataset.preview(limit, offset, sort_by, sort_asc, column_filters, search)
        else:
            # Historical previews intentionally remain small and unfiltered.
            preview = session.preview_at(dataset_id, at, limit)
        return DataPreview(**preview)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.get("/{dataset_id}/values")
async def distinct_values(
    dataset_id: str,
    column: str,
    search: str | None = None,
    limit: int = 1000,
    offset: int = 0,
):
    """Distinct values from the full derived dataset for filter controls.

    High-cardinality fields: server-side substring search + pagination over a
    cached sorted unique list (see backend.core.value_index).
    """
    from backend.core.value_index import sorted_unique_values

    try:
        dataset = session.get(dataset_id)
        if column not in dataset.df.columns:
            raise ValueError(f"Column not found: {column}")
        all_values = sorted_unique_values(dataset, column)
        total = len(all_values)
        if search:
            needle = search.casefold()
            all_values = [value for value in all_values if needle in value.casefold()]
        filtered_total = len(all_values)
        offset = min(max(0, offset), filtered_total)
        limit = min(max(1, limit), 5000)
        return {
            "values": all_values[offset : offset + limit],
            "total": total,
            "filteredTotal": filtered_total,
            "offset": offset,
            "limit": limit,
        }
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc



@router.get("/{dataset_id}/privacy")
async def dataset_privacy(dataset_id: str):
    try:
        dataset = session.get(dataset_id)
        return {"sensitive_columns": sensitive_columns(list(dataset.df.columns))}
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


def _diff_frames(left: pd.DataFrame, right: pd.DataFrame) -> dict:
    left_cols = set(left.columns)
    right_cols = set(right.columns)
    common = [c for c in left.columns if c in right.columns]
    numeric_diff = []
    for c in common:
        if pd.api.types.is_numeric_dtype(left[c]) and pd.api.types.is_numeric_dtype(right[c]):
            left_mean = float(left[c].mean())
            right_mean = float(right[c].mean())
            numeric_diff.append({
                "column": c,
                "left_mean": round(left_mean, 2) if math.isfinite(left_mean) else None,
                "right_mean": round(right_mean, 2) if math.isfinite(right_mean) else None,
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
    return _diff_frames(left, right)


@router.post("/{dataset_id}/diff-steps")
async def diff_steps(dataset_id: str, payload: dict):
    """Compare two immutable operation-chain states of the same dataset."""
    step_a = payload.get("step_a")
    step_b = payload.get("step_b")
    if type(step_a) is not int or type(step_b) is not int:
        raise HTTPException(status_code=400, detail="step_a and step_b must be integers")
    try:
        left = session.df_at_step(dataset_id, step_a)
        right = session.df_at_step(dataset_id, step_b)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {"left_step": step_a, "right_step": step_b, **_diff_frames(left, right)}


@router.get("/{dataset_id}/timeseries")
async def timeseries(dataset_id: str, column: str):
    """Monthly aggregation + period-over-period change for a numeric column."""
    from backend.core.timeseries import analyze_timeseries

    try:
        dataset = session.get(dataset_id)
        return analyze_timeseries(dataset.df, column)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.get("/{dataset_id}/correlation")
async def correlation(dataset_id: str, min_abs: float = 0.5):
    """Pearson correlation matrix + notable pairs for the numeric columns."""
    from backend.core.stats import correlation_matrix

    try:
        dataset = session.get(dataset_id)
        return correlation_matrix(dataset.df, min_abs=min_abs)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.get("/{dataset_id}/regression")
async def regression(dataset_id: str, x: str, y: str):
    """OLS linear regression y ~ x with R², p-value and an interpretation."""
    from backend.core.stats import linear_regression

    try:
        dataset = session.get(dataset_id)
        return linear_regression(dataset.df, x, y)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.get("/{dataset_id}/difference-test")
async def difference_test_endpoint(
    dataset_id: str,
    column_a: str,
    column_b: str | None = None,
    group_column: str | None = None,
    group_a: str | None = None,
    group_b: str | None = None,
    paired: bool = False,
):
    """Welch t / paired t / Mann-Whitney comparison between two samples."""
    from backend.core.stats import difference_test

    try:
        dataset = session.get(dataset_id)
        return difference_test(
            dataset.df,
            column_a,
            column_b=column_b,
            group_column=group_column,
            group_a=group_a,
            group_b=group_b,
            paired=paired,
        )
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.get("/{dataset_id}/ci-mean")
async def ci_mean(dataset_id: str, column: str, level: float = 0.95):
    """Two-sided confidence interval for a column mean."""
    from backend.core.stats import confidence_interval_mean

    try:
        dataset = session.get(dataset_id)
        return confidence_interval_mean(dataset.df, column, level=level)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


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
async def data_insights(dataset_id: str, locale: str = "zh"):
    """Rule-based data insights; each item carries data evidence for verification."""
    from backend.core.insights import generate_insights

    try:
        dataset = session.get(dataset_id)
        return {"insights": generate_insights(dataset.df, locale="en" if locale == "en" else "zh")}
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


def _aggregate_value(dataset_id: str, field: str, agg: str, filters: list | None = None):
    """Compute a single aggregate value after applying dashboard filters."""
    from backend.api.chart import _filter_by_filters
    try:
        dataset = session.get(dataset_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    df = _filter_by_filters(dataset.df, filters or [])
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


@router.get("/{dataset_id}/aggregate")
async def aggregate_value_legacy(dataset_id: str, field: str, agg: str = "sum"):
    """Backward-compatible unfiltered KPI aggregate."""
    return _aggregate_value(dataset_id, field, agg)


@router.post("/{dataset_id}/aggregate")
async def aggregate_value(dataset_id: str, payload: dict):
    """KPI aggregate with Dashboard filter support."""
    from backend.models.chart import FilterSpec

    field = str(payload.get("field") or "")
    agg = str(payload.get("agg") or "sum")
    if not field:
        raise HTTPException(status_code=400, detail="field is required")
    try:
        filters = [FilterSpec.model_validate(item) for item in (payload.get("filters") or [])]
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Invalid filters: {exc}") from exc
    return _aggregate_value(dataset_id, field, agg, filters)


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
