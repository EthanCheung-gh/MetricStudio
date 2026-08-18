from __future__ import annotations

from fastapi import APIRouter, HTTPException

from backend.api.data import _diff_frames
from backend.core.dataframe import Dataset
from backend.core.session import session
from backend.models.data import DataPreview

router = APIRouter(prefix="/api/v1", tags=["snapshots"])


@router.get("/data/{dataset_id}/snapshots")
async def list_snapshots(dataset_id: str):
    try:
        return session.list_snapshots(dataset_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.post("/data/{dataset_id}/snapshots")
async def create_snapshot(dataset_id: str, payload: dict):
    try:
        return session.create_snapshot(
            dataset_id,
            str(payload.get("name") or ""),
            str(payload.get("description") or ""),
            payload.get("step"),
        )
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except (TypeError, ValueError) as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.get("/snapshots/{snapshot_id}/preview", response_model=DataPreview, response_model_by_alias=True)
async def preview_snapshot(snapshot_id: str, limit: int = 20):
    try:
        snapshot = session.get_snapshot(snapshot_id)
        dataset = Dataset(session.snapshot_df(snapshot_id), name=snapshot["name"])
        return DataPreview(**dataset.preview(limit))
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/snapshots/{snapshot_id}/diff")
async def diff_snapshot(snapshot_id: str, payload: dict):
    try:
        left = session.snapshot_df(snapshot_id)
        other_snapshot_id = payload.get("other_snapshot_id")
        if other_snapshot_id:
            right = session.snapshot_df(str(other_snapshot_id))
        else:
            dataset_id = str(payload.get("dataset_id") or session.get_snapshot(snapshot_id)["dataset_id"])
            step = payload.get("step")
            right = session.get(dataset_id).df if step is None else session.df_at_step(dataset_id, int(step))
        return _diff_frames(left, right)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except (TypeError, ValueError) as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/snapshots/{snapshot_id}/restore")
async def restore_snapshot(snapshot_id: str, payload: dict | None = None):
    try:
        dataset = session.restore_snapshot(snapshot_id, (payload or {}).get("name"))
        return dataset.to_meta()
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.delete("/snapshots/{snapshot_id}")
async def delete_snapshot(snapshot_id: str):
    try:
        session.delete_snapshot(snapshot_id)
        return {"deleted": True}
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
