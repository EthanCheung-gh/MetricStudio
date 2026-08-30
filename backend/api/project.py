from __future__ import annotations

import io
import json
import re
import zipfile
from pathlib import Path
from datetime import datetime
from fastapi import APIRouter, HTTPException, UploadFile, File

import pandas as pd

from backend.core.session import session

router = APIRouter(prefix="/api/v1/project", tags=["project"])
_SAFE_ID = re.compile(r"^[A-Za-z0-9_-]{1,128}$")
_MAX_PROJECT_BYTES = 512 * 1024 * 1024
_MAX_PROJECT_MEMBERS = 10_000


def _safe_id(value: object, label: str) -> str:
    text = str(value or "")
    if not _SAFE_ID.fullmatch(text):
        raise ValueError(f"Invalid {label}")
    return text


def _validate_archive(zf: zipfile.ZipFile) -> None:
    infos = zf.infolist()
    if len(infos) > _MAX_PROJECT_MEMBERS:
        raise ValueError("Project archive contains too many files")
    if sum(info.file_size for info in infos) > _MAX_PROJECT_BYTES:
        raise ValueError("Project archive is too large")


@router.post("/save")
async def save_project(payload: dict):
    path = Path(payload.get("path", "project.metricstudio"))
    name = payload.get("name", "Untitled")
    charts = payload.get("charts", [])
    dashboards = payload.get("dashboards", [])
    qa_conversations = payload.get("qa_conversations", [])
    temp_path = path.with_suffix(path.suffix + ".tmp")
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        with zipfile.ZipFile(temp_path, "w", zipfile.ZIP_DEFLATED) as zf:
            manifest = {
                "name": name,
                "version": "1.1.6",
                "created_at": datetime.utcnow().isoformat(),
                "saved_at": datetime.utcnow().isoformat(),
                "engine": "pandas",
                "data_sources": [],
                "charts": charts,
                "dashboards": dashboards,
                "qa_conversations": qa_conversations,
                "snapshots": [session._snapshot_public(snapshot) for snapshot in session.snapshots.values()],
            }
            for ds in session.list_datasets():
                manifest["data_sources"].append({
                    "id": ds.id,
                    "name": ds.name,
                    "rows": ds.meta.rows,
                    "cols": ds.meta.cols,
                })
                # Store raw data + transform history so the project can be
                # fully rebuilt on load (mirrors session persistence).
                buf = io.BytesIO()
                ds.raw_df.to_parquet(buf)
                zf.writestr(f"data/{ds.id}.parquet", buf.getvalue())
                zf.writestr(
                    f"transforms/{ds.id}.json",
                    json.dumps(ds.history, ensure_ascii=False, indent=2),
                )
            for snapshot in session.snapshots.values():
                snapshot_path = Path(snapshot["path"])
                if snapshot_path.is_file():
                    zf.write(snapshot_path, f"snapshots/{snapshot['id']}.parquet")
            zf.writestr("manifest.json", json.dumps(manifest, ensure_ascii=False, indent=2))
        temp_path.replace(path)
        return {"path": str(path), "datasets": len(manifest["data_sources"])}
    except Exception as exc:
        temp_path.unlink(missing_ok=True)
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@router.post("/upload")
async def upload_project(file: UploadFile = File(...)):
    """Store an uploaded .metricstudio bundle under ~/.metricstudio/projects/ and return its path."""
    projects_dir = Path.home() / ".metricstudio" / "projects"
    projects_dir.mkdir(parents=True, exist_ok=True)
    filename = Path(file.filename or "project.metricstudio").name
    dest = projects_dir / filename
    contents = await file.read(_MAX_PROJECT_BYTES + 1)
    if len(contents) > _MAX_PROJECT_BYTES:
        raise HTTPException(status_code=413, detail="Project archive is too large")
    dest.write_bytes(contents)
    return {"path": str(dest), "name": dest.stem}


@router.post("/load")
async def load_project(payload: dict):
    path = Path(payload.get("path", ""))
    if not path.exists():
        raise HTTPException(status_code=404, detail="Project file not found")
    try:
        with zipfile.ZipFile(path, "r") as zf:
            _validate_archive(zf)
            manifest = json.loads(zf.read("manifest.json"))
            # Read all payloads inside the open archive; ZipFile is closed on exit.
            data_files = {
                name: zf.read(name)
                for name in zf.namelist()
                if name.startswith("data/") and name.endswith(".parquet")
            }
            transform_files = {
                name: zf.read(name)
                for name in zf.namelist()
                if name.startswith("transforms/") and name.endswith(".json")
            }
            snapshot_files = {
                name: zf.read(name)
                for name in zf.namelist()
                if name.startswith("snapshots/") and name.endswith(".parquet")
            }
        restored = []
        for src in manifest.get("data_sources", []):
            ds_id = _safe_id(src["id"], "dataset id")
            if ds_id in session.datasets:
                continue
            parquet_bytes = data_files.get(f"data/{ds_id}.parquet")
            if parquet_bytes is None:
                continue
            df = pd.read_parquet(io.BytesIO(parquet_bytes))
            history = json.loads(
                transform_files.get(f"transforms/{ds_id}.json") or b"[]"
            )
            session.restore_dataset(
                df, name=src["name"], dataset_id=ds_id, history=history
            )
            restored.append(ds_id)
        from backend.core.session import SNAPSHOTS_DIR

        SNAPSHOTS_DIR.mkdir(parents=True, exist_ok=True)
        for snapshot in manifest.get("snapshots", []):
            snapshot_id = _safe_id(snapshot.get("id"), "snapshot id")
            dataset_id = _safe_id(snapshot.get("dataset_id"), "snapshot dataset id")
            if dataset_id not in session.datasets:
                continue
            if snapshot_id in session.snapshots:
                continue
            data = snapshot_files.get(f"snapshots/{snapshot_id}.parquet")
            if data is None:
                continue
            path = SNAPSHOTS_DIR / f"{snapshot_id}.parquet"
            temp_path = path.with_suffix(".parquet.tmp")
            temp_path.write_bytes(data)
            pd.read_parquet(temp_path)
            temp_path.replace(path)
            session.snapshots[snapshot_id] = {**snapshot, "id": snapshot_id, "dataset_id": dataset_id, "path": str(path)}
            session._persist(session.get(dataset_id))
        return {
            "project": manifest,
            "restored": restored,
            "datasets": [ds.to_meta() for ds in session.list_datasets()],
            "charts": manifest.get("charts", []),
            "dashboards": manifest.get("dashboards", []),
            "qa_conversations": manifest.get("qa_conversations", []),
        }
    except KeyError as exc:
        raise HTTPException(status_code=400, detail=f"Project file malformed: missing {exc}") from exc
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/export/html")
async def export_html(payload: dict):
    figure = payload.get("figure", {})
    figure_json = json.dumps(figure).replace("<", "\\u003c").replace(">", "\\u003e").replace("&", "\\u0026")
    html = f"""<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <script src="https://cdn.plot.ly/plotly-latest.min.js"></script>
</head>
<body>
    <div id="chart"></div>
    <script>
        var figure = {figure_json};
        Plotly.newPlot('chart', figure.data, figure.layout, {{responsive: true}});
    </script>
</body>
</html>"""
    return {"html": html}


@router.post("/export/png")
async def export_png(payload: dict):
    # PNG export is performed client-side via Plotly.toImage in MVP.
    # The backend endpoint accepts the figure and returns a placeholder.
    return {"png": "", "message": "Use Plotly.toImage on the client"}
