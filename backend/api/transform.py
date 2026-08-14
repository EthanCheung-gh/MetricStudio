from __future__ import annotations

from fastapi import APIRouter, HTTPException

from backend.core.session import session
from backend.models.data import DataPreview
from backend.models.transform import (
    FilterRequest,
    SortRequest,
    DropNaRequest,
    FillNaRequest,
    RenameRequest,
    DTypeRequest,
    ComputeRequest,
    PivotRequest,
    MeltRequest,
    JoinRequest,
    UndoRequest,
    BatchRequest,
)
from backend.core.recipes import recipe_steps_for_issue

router = APIRouter(prefix="/api/v1/transform", tags=["transform"])


@router.get("/global/history")
async def global_history():
    """Global undo/redo stacks (summary for UI display)."""
    return {
        "undo": [
            {"dataset_id": i["dataset_id"], "dataset_name": i["dataset_name"], "ops": i["ops"]}
            for i in session.global_history
        ],
        "redo": [
            {"dataset_id": i["dataset_id"], "dataset_name": i["dataset_name"], "ops": i["ops"]}
            for i in session.global_redo
        ],
    }


@router.post("/global/undo")
async def global_undo():
    try:
        return session.undo_global()
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.post("/global/redo")
async def global_redo():
    try:
        return session.redo_global()
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


def _apply(dataset_id: str, op_type: str, params: dict):
    try:
        dataset = session.apply_transform(dataset_id, {"type": op_type, "params": params})
        return DataPreview(**dataset.preview(100))
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/{dataset_id}/filter", response_model=DataPreview, response_model_by_alias=True)
async def filter_data(dataset_id: str, request: FilterRequest):
    return _apply(dataset_id, "filter", request.model_dump())


@router.post("/{dataset_id}/sort", response_model=DataPreview, response_model_by_alias=True)
async def sort_data(dataset_id: str, request: SortRequest):
    return _apply(dataset_id, "sort", request.model_dump())


@router.post("/{dataset_id}/dropna", response_model=DataPreview, response_model_by_alias=True)
async def drop_na(dataset_id: str, request: DropNaRequest):
    return _apply(dataset_id, "dropna", request.model_dump())


@router.post("/{dataset_id}/fillna", response_model=DataPreview, response_model_by_alias=True)
async def fill_na(dataset_id: str, request: FillNaRequest):
    return _apply(dataset_id, "fillna", request.model_dump())


@router.post("/{dataset_id}/rename", response_model=DataPreview, response_model_by_alias=True)
async def rename_columns(dataset_id: str, request: RenameRequest):
    return _apply(dataset_id, "rename", request.model_dump())


@router.post("/{dataset_id}/dtype", response_model=DataPreview, response_model_by_alias=True)
async def cast_dtypes(dataset_id: str, request: DTypeRequest):
    return _apply(dataset_id, "dtype", request.model_dump())


@router.post("/{dataset_id}/compute", response_model=DataPreview, response_model_by_alias=True)
async def compute_column(dataset_id: str, request: ComputeRequest):
    return _apply(dataset_id, "compute", request.model_dump())


@router.post("/{dataset_id}/compute/preview")
async def compute_preview(dataset_id: str, payload: dict):
    """Read-only eval preview: returns the first 20 result values without touching history."""
    try:
        dataset = session.get(dataset_id)
        expression = (payload.get("expression") or "").strip()
        if not expression:
            return {"values": []}
        df = dataset.df
        try:
            result = df.eval(expression)
        except Exception:
            result = df.eval(expression, engine="python")
        values = result.head(20).tolist()
        values = [None if (isinstance(v, float) and v != v) else v for v in values]
        return {"values": values}
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/{dataset_id}/pivot", response_model=DataPreview, response_model_by_alias=True)
async def pivot_data(dataset_id: str, request: PivotRequest):
    return _apply(dataset_id, "pivot", request.model_dump())


@router.post("/{dataset_id}/melt", response_model=DataPreview, response_model_by_alias=True)
async def melt_data(dataset_id: str, request: MeltRequest):
    return _apply(dataset_id, "melt", request.model_dump())


@router.post("/{dataset_id}/join", response_model=DataPreview, response_model_by_alias=True)
async def join_data(dataset_id: str, request: JoinRequest):
    if not request.on and not (request.left_on and request.right_on):
        raise HTTPException(status_code=400, detail="join requires 'on' or both 'left_on' and 'right_on'")
    return _apply(dataset_id, "join", request.model_dump())


@router.get("/{dataset_id}/history")
async def get_history(dataset_id: str):
    try:
        return session.get(dataset_id).history
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.post("/{dataset_id}/undo", response_model=DataPreview, response_model_by_alias=True)
async def undo(dataset_id: str, request: UndoRequest):
    try:
        dataset = session.undo(dataset_id, request.to_index)
        return DataPreview(**dataset.preview(100))
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.post("/{dataset_id}/batch", response_model=DataPreview, response_model_by_alias=True)
async def batch_transform(dataset_id: str, request: BatchRequest):
    try:
        dataset = session.apply_operations(dataset_id, request.operations)
        return DataPreview(**dataset.preview(100))
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/{dataset_id}/recipe/{recipe_id}", response_model=DataPreview, response_model_by_alias=True)
async def apply_recipe(dataset_id: str, recipe_id: str):
    """Apply one preset cleaning recipe; its generated steps are appended to history."""
    try:
        dataset = session.get(dataset_id)
        steps = recipe_steps_for_issue(dataset.df, recipe_id)
        if not steps:
            raise HTTPException(
                status_code=400,
                detail=f"Recipe '{recipe_id}' has no applicable steps for this dataset",
            )
        dataset = session.apply_operations(dataset_id, steps)
        return DataPreview(**dataset.preview(100))
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
