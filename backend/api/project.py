from __future__ import annotations

import io
import json
import zipfile
from pathlib import Path
from datetime import datetime
from fastapi import APIRouter, HTTPException, UploadFile, File

import pandas as pd

from backend.core.session import session

router = APIRouter(prefix="/api/v1/project", tags=["project"])


@router.post("/save")
async def save_project(payload: dict):
    path = Path(payload.get("path", "project.metricstudio"))
    name = payload.get("name", "Untitled")
    charts = payload.get("charts", [])
    try:
        with zipfile.ZipFile(path, "w", zipfile.ZIP_DEFLATED) as zf:
            manifest = {
                "name": name,
                "version": "0.2.0",
                "created_at": datetime.utcnow().isoformat(),
                "engine": "pandas",
                "data_sources": [],
                "charts": charts,
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
            zf.writestr("manifest.json", json.dumps(manifest, ensure_ascii=False, indent=2))
        return {"path": str(path), "datasets": len(manifest["data_sources"])}
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@router.post("/upload")
async def upload_project(file: UploadFile = File(...)):
    """Store an uploaded .metricstudio bundle under ~/.metricstudio/projects/ and return its path."""
    projects_dir = Path.home() / ".metricstudio" / "projects"
    projects_dir.mkdir(parents=True, exist_ok=True)
    filename = Path(file.filename or "project.metricstudio").name
    dest = projects_dir / filename
    contents = await file.read()
    dest.write_bytes(contents)
    return {"path": str(dest), "name": dest.stem}


@router.post("/load")
async def load_project(payload: dict):
    path = Path(payload.get("path", ""))
    if not path.exists():
        raise HTTPException(status_code=404, detail="Project file not found")
    try:
        with zipfile.ZipFile(path, "r") as zf:
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
        restored = []
        for src in manifest.get("data_sources", []):
            ds_id = src["id"]
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
        return {
            "project": manifest,
            "restored": restored,
            "datasets": [ds.to_meta() for ds in session.list_datasets()],
            "charts": manifest.get("charts", []),
        }
    except KeyError as exc:
        raise HTTPException(status_code=400, detail=f"Project file malformed: missing {exc}") from exc
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/export/html")
async def export_html(payload: dict):
    figure = payload.get("figure", {})
    html = f"""<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <script src="https://cdn.plot.ly/plotly-latest.min.js"></script>
</head>
<body>
    <div id="chart"></div>
    <script>
        var figure = {json.dumps(figure)};
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
