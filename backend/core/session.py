from __future__ import annotations

import json
import logging
import shutil
import uuid
from datetime import datetime
from typing import Any
from pathlib import Path

import pandas as pd

from backend.core.dataframe import Dataset
from backend.core.engine import DataEngine

logger = logging.getLogger("session")

# Session persistence: raw data as parquet + metadata/history as JSON,
# so a sidecar restart can rebuild datasets and replay operation chains (spec §3.3/§7.3)
STORAGE_DIR = Path.home() / ".metricstudio" / "session"
SOURCES_DIR = Path.home() / ".metricstudio" / "sources"


class SessionManager:
    """内存中的 DataFrame 会话管理器，落盘持久化以支持崩溃恢复。"""

    def __init__(self):
        self.datasets: dict[str, Dataset] = {}
        self.engine: DataEngine = DataEngine("auto")
        # Global undo/redo stacks: one entry per user-facing operation batch.
        self.global_history: list[dict[str, Any]] = []
        self.global_redo: list[dict[str, Any]] = []
        # Data source metadata: dataset_id -> {path, original_name, ext, sheet_name}
        self.sources: dict[str, dict[str, Any]] = {}

    # ---- persistence ----

    def _persist(self, dataset: Dataset) -> None:
        try:
            STORAGE_DIR.mkdir(parents=True, exist_ok=True)
            dataset.raw_df.to_parquet(STORAGE_DIR / f"{dataset.id}.parquet")
            meta = {
                "id": dataset.id,
                "name": dataset.name,
                "engine": dataset.engine,
                "created_at": dataset.created_at,
                "history": dataset.history,
                "source": self.sources.get(dataset.id),
            }
            (STORAGE_DIR / f"{dataset.id}.json").write_text(
                json.dumps(meta, ensure_ascii=False, default=str), encoding="utf-8"
            )
        except Exception as exc:
            logger.warning("failed to persist dataset %s: %s", dataset.id, exc)

    def _remove_persisted(self, dataset_id: str) -> None:
        for suffix in (".parquet", ".json"):
            try:
                (STORAGE_DIR / f"{dataset_id}{suffix}").unlink(missing_ok=True)
            except Exception as exc:
                logger.warning("failed to remove persisted %s%s: %s", dataset_id, suffix, exc)

    def restore(self) -> int:
        """Rebuild datasets from disk after a (re)start. Returns restored count."""
        if not STORAGE_DIR.exists():
            return 0
        restored = 0
        for meta_file in sorted(STORAGE_DIR.glob("*.json")):
            try:
                meta = json.loads(meta_file.read_text(encoding="utf-8"))
                dataset_id = meta["id"]
                if dataset_id in self.datasets:
                    continue
                raw_df = pd.read_parquet(STORAGE_DIR / f"{dataset_id}.parquet")
                dataset = Dataset(raw_df, name=meta["name"], engine=meta["engine"], dataset_id=dataset_id)
                self.datasets[dataset.id] = dataset  # register first: join replay may reference it
                if meta.get("source"):
                    self.sources[dataset_id] = meta["source"]
                # Replay the operation chain to rebuild the derived state
                self._replay(dataset, meta.get("history", []))
                restored += 1
            except Exception as exc:
                logger.warning("failed to restore dataset from %s: %s", meta_file, exc)
        if restored:
            logger.info("restored %d dataset(s) from %s", restored, STORAGE_DIR)
        return restored

    # ---- dataset operations ----

    def import_dataframe(self, df: Any, name: str) -> Dataset:
        """Register a dataset directly from an in-memory DataFrame.

        Used for clipboard / pasted-text imports that have no refreshable source
        file. The raw data is still persisted, so the dataset survives restarts.
        """
        if not isinstance(df, pd.DataFrame):
            df = self._to_pandas(df)
        actual_engine = self.engine.auto_engine(df)
        dataset = Dataset(df, name=name, engine=actual_engine)
        self.datasets[dataset.id] = dataset
        self._persist(dataset)
        return dataset

    def import_file(
        self,
        path: str | Path,
        name: str | None = None,
        sheet_name: str | None = None,
        merge_sheets: bool = False,
        original_path: str | Path | None = None,
    ) -> list[Dataset]:
        """Import a file. Returns a list of Dataset objects (one per sheet for Excel)."""
        path = Path(path)
        name = name or path.stem
        ext = path.suffix.lower()
        datasets: list[Dataset] = []

        # Persist the source file so the dataset can be refreshed later.
        SOURCES_DIR.mkdir(parents=True, exist_ok=True)
        source_id = str(uuid.uuid4())
        source_path = SOURCES_DIR / f"{source_id}{ext}"
        shutil.copyfile(path, source_path)
        original = Path(original_path).expanduser().resolve() if original_path else None
        stat = original.stat() if original and original.exists() else None
        source_meta = {
            "path": str(source_path),
            "original_name": name,
            "ext": ext,
            "kind": "file",
            "original_path": str(original) if original else None,
            "original_mtime_ns": stat.st_mtime_ns if stat else None,
            "original_size": stat.st_size if stat else None,
        }

        if ext in (".xlsx", ".xls"):
            sheet_names = self.engine.get_excel_sheet_names(path)
            if sheet_name:
                sheet_names = [s for s in sheet_names if s == sheet_name]
            if merge_sheets and len(sheet_names) > 1:
                frames: list[pd.DataFrame] = []
                for sn in sheet_names:
                    frame = self.engine.read_excel(path, sheet_name=sn)
                    if not isinstance(frame, pd.DataFrame):
                        frame = self._to_pandas(frame)
                    frames.append(frame)
                df = pd.concat(frames, ignore_index=True)
                actual_engine = self.engine.auto_engine(df)
                dataset = Dataset(df, name=name, engine=actual_engine)
                self.datasets[dataset.id] = dataset
                self.sources[dataset.id] = {**source_meta, "sheet_name": None, "merged_sheets": sheet_names}
                self._persist(dataset)
                datasets.append(dataset)
                return datasets
            for sn in sheet_names:
                df = self.engine.read_excel(path, sheet_name=sn)
                if not isinstance(df, pd.DataFrame):
                    df = self._to_pandas(df)
                actual_engine = self.engine.auto_engine(df)
                dataset = Dataset(df, name=f"{name} - {sn}", engine=actual_engine)
                self.datasets[dataset.id] = dataset
                self.sources[dataset.id] = {**source_meta, "sheet_name": sn}
                self._persist(dataset)
                datasets.append(dataset)
        else:
            if ext == ".csv":
                df = self.engine.read_csv(path)
            elif ext == ".parquet":
                df = self.engine.read_parquet(path)
            elif ext == ".json":
                df = self.engine.read_json(path)
            else:
                raise ValueError(f"Unsupported file format: {ext}")
            if not isinstance(df, pd.DataFrame):
                df = self._to_pandas(df)
            actual_engine = self.engine.auto_engine(df)
            dataset = Dataset(df, name=name, engine=actual_engine)
            self.datasets[dataset.id] = dataset
            self.sources[dataset.id] = {**source_meta, "sheet_name": None}
            self._persist(dataset)
            datasets.append(dataset)

        return datasets

    def refresh_dataset(self, dataset_id: str) -> Dataset:
        """Re-read the source file and replay the transform history."""
        dataset = self.get(dataset_id)
        source = self.sources.get(dataset_id)
        if not source:
            raise ValueError("No data source for this dataset")
        source_path = Path(source["path"])
        if source.get("kind") == "sqlite":
            from backend.core.sql import read_table

            if not source_path.exists():
                raise ValueError("Original SQLite source file is missing")
            df = read_table("sqlite", str(source_path), source["table"])
            if not isinstance(df, pd.DataFrame):
                df = self._to_pandas(df)
            history = list(dataset.history)
            candidate = Dataset(df.copy(), name=dataset.name, engine=dataset.engine)
            self._replay(candidate, history)
            if len(candidate.history) != len(history):
                raise ValueError("Could not replay all transforms against the refreshed SQLite source")
            dataset.raw_df = candidate.raw_df
            dataset._df = candidate.df
            dataset.history = candidate.history
            source_stat = source_path.stat()
            source["original_mtime_ns"] = source_stat.st_mtime_ns
            source["original_size"] = source_stat.st_size
            dataset._build_meta()
            self._persist(dataset)
            return dataset
        original_path = Path(source["original_path"]) if source.get("original_path") else None
        if original_path is not None:
            if not original_path.exists():
                raise ValueError("Original source file is missing")
            temp_source = source_path.with_suffix(source_path.suffix + ".refreshing")
            shutil.copyfile(original_path, temp_source)
            temp_source.replace(source_path)
            stat = original_path.stat()
        if not source_path.exists():
            raise ValueError("Source file is missing")

        ext = source.get("ext") or source_path.suffix.lower()
        sheet_name = source.get("sheet_name")
        if ext in (".xlsx", ".xls") and source.get("merged_sheets"):
            frames = [self.engine.read_excel(source_path, sheet_name=sheet) for sheet in source["merged_sheets"]]
            df = pd.concat([frame if isinstance(frame, pd.DataFrame) else self._to_pandas(frame) for frame in frames], ignore_index=True)
        elif ext in (".xlsx", ".xls"):
            df = self.engine.read_excel(source_path, sheet_name=sheet_name)
        elif ext == ".csv":
            df = self.engine.read_csv(source_path)
        elif ext == ".parquet":
            df = self.engine.read_parquet(source_path)
        else:
            raise ValueError(f"Unsupported source format: {ext}")
        if not isinstance(df, pd.DataFrame):
            df = self._to_pandas(df)

        history = list(dataset.history)
        candidate = Dataset(df.copy(), name=dataset.name, engine=dataset.engine)
        self._replay(candidate, history)
        if len(candidate.history) != len(history):
            raise ValueError("Could not replay all transforms against the refreshed source")
        dataset.raw_df = candidate.raw_df
        dataset._df = candidate.df
        dataset.history = candidate.history
        if original_path is not None:
            source["original_mtime_ns"] = stat.st_mtime_ns
            source["original_size"] = stat.st_size
        dataset._build_meta()
        self._persist(dataset)
        return dataset

    def source_status(self) -> list[dict[str, Any]]:
        statuses = []
        for dataset_id, dataset in self.datasets.items():
            source = self.sources.get(dataset_id)
            original_path = Path(source["original_path"]) if source and source.get("original_path") else None
            exists = original_path.exists() if original_path else None
            changed = False
            if original_path and exists:
                stat = original_path.stat()
                known_mtime = source.get("original_mtime_ns")
                known_size = source.get("original_size")
                changed = (
                    known_mtime is not None
                    and known_size is not None
                    and (stat.st_mtime_ns != known_mtime or stat.st_size != known_size)
                )
            statuses.append({
                "dataset_id": dataset_id,
                "dataset_name": dataset.name,
                "refreshable": bool(source),
                "source_path": str(original_path) if original_path else (source.get("path") if source else None),
                "original_exists": exists,
                "changed": changed,
            })
        return statuses

    def _to_pandas(self, df: Any) -> Any:
        if hasattr(df, "to_pandas"):
            return df.to_pandas()
        return df

    def get(self, dataset_id: str) -> Dataset:
        if dataset_id not in self.datasets:
            raise KeyError(f"Dataset not found: {dataset_id}")
        return self.datasets[dataset_id]

    def list_datasets(self) -> list[Dataset]:
        return list(self.datasets.values())

    def delete_dataset(self, dataset_id: str) -> None:
        self.datasets.pop(dataset_id, None)
        source = self.sources.pop(dataset_id, None)
        if source and source.get("kind") != "sqlite":
            source_path = Path(source["path"])
            if not any(meta.get("path") == str(source_path) for meta in self.sources.values()):
                source_path.unlink(missing_ok=True)
        self._remove_persisted(dataset_id)

    def _apply_one(self, dataset: Dataset, operation: dict[str, Any]) -> None:
        """Apply a single op, resolving cross-dataset joins against loaded datasets."""
        if operation.get("type") == "join":
            params = operation.get("params", {})
            right_id = params.get("right_dataset_id")
            right = self.datasets.get(right_id)
            if right is None:
                # Right dataset gone (deleted or not restored): degrade gracefully
                logger.warning("join replay skipped: right dataset %s not loaded", right_id)
                return
            # Record the right table's completed step at join time so replays
            # (and the lineage DAG) stay deterministic regardless of restore order.
            if "right_step" not in params:
                params["right_step"] = len(right.history)
            dataset.apply_join(operation, self._right_df_at_step(right, params.get("right_step")))
        else:
            dataset.apply(operation)

    def _right_df_at_step(self, right: Dataset, step: Any) -> pd.DataFrame:
        """Reconstruct the right table as it was after `step` operations.

        Falls back to the current derived frame when the step is missing or
        already the latest state.
        """
        if step is None or not isinstance(step, int) or step >= len(right.history):
            return right.df
        if step <= 0:
            return right.raw_df.copy()
        tmp = Dataset(right.raw_df, name=right.name, engine=right.engine)
        self._replay(tmp, right.history[:step])
        return tmp.df

    def _replay(self, dataset: Dataset, operations: list[dict[str, Any]]) -> None:
        for op in operations:
            try:
                self._apply_one(dataset, op)
            except Exception as exc:
                logger.warning("replay of op %s failed for dataset %s: %s", op.get("type"), dataset.id, exc)

    def _apply_operations(self, dataset: Dataset, operations: list[dict[str, Any]]) -> Dataset:
        """Apply a user-facing batch of ops and record one global undo entry."""
        before = len(dataset.history)
        for op in operations:
            self._apply_one(dataset, op)
        if len(dataset.history) > before:
            self.global_history.append({
                "dataset_id": dataset.id,
                "dataset_name": dataset.name,
                "before_index": before,
                "ops": operations,
                "timestamp": datetime.utcnow().isoformat(),
            })
            self.global_redo.clear()
        self._persist(dataset)
        return dataset

    def apply_transform(self, dataset_id: str, operation: dict[str, Any]) -> Dataset:
        dataset = self.get(dataset_id)
        return self._apply_operations(dataset, [operation])

    def apply_operations(self, dataset_id: str, operations: list[dict[str, Any]]) -> Dataset:
        dataset = self.get(dataset_id)
        return self._apply_operations(dataset, operations)

    def undo_global(self) -> dict[str, Any]:
        """Undo the most recent user-facing operation on any dataset."""
        if not self.global_history:
            raise ValueError("Nothing to undo")
        item = self.global_history.pop()
        dataset = self.get(item["dataset_id"])
        self.undo(item["dataset_id"], item["before_index"])
        self.global_redo.append(item)
        return {"dataset_id": dataset.id, "preview": dataset.preview(100)}

    def redo_global(self) -> dict[str, Any]:
        """Redo the most recently undone operation."""
        if not self.global_redo:
            raise ValueError("Nothing to redo")
        item = self.global_redo.pop()
        dataset = self.get(item["dataset_id"])
        for op in item["ops"]:
            self._apply_one(dataset, op)
        self._persist(dataset)
        self.global_history.append(item)
        return {"dataset_id": dataset.id, "preview": dataset.preview(100)}

    def undo(self, dataset_id: str, to_index: int | None = None) -> Dataset:
        dataset = self.get(dataset_id)
        if to_index is None:
            to_index = max(0, len(dataset.history) - 1)
        history = dataset.history[:to_index]
        dataset.reset()
        self._replay(dataset, history)
        self._persist(dataset)
        return dataset

    def build_lineage(self) -> dict[str, Any]:
        """Build a lineage DAG over all datasets from their history chains.

        Node id is "{dataset_id}:{step}" where step=-1 is the import state and
        step=i is the state after the i-th operation. Join operations also emit
        a cross edge pointing at the right table's state at join time.
        """
        nodes: list[dict[str, Any]] = []
        edges: list[dict[str, Any]] = []
        for ds in self.datasets.values():
            nodes.append({
                "id": f"{ds.id}:init",
                "dataset_id": ds.id,
                "dataset_name": ds.name,
                "step": -1,
                "op": "import",
                "rows": len(ds.raw_df),
                "cols": len(ds.raw_df.columns),
                "params": {},
            })
            probe = Dataset(ds.raw_df.copy(), name=ds.name, engine=ds.engine)
            for i, op in enumerate(ds.history):
                prev_id = f"{ds.id}:{i - 1}"
                node_id = f"{ds.id}:{i}"
                params = op.get("params", {})
                op_type = op.get("type", "?")
                if op_type == "join":
                    # Joins need session context; row counts are unknown here.
                    op_rows, op_cols = None, None
                else:
                    try:
                        probe.apply(op)
                        op_rows, op_cols = len(probe.df), len(probe.df.columns)
                    except Exception:
                        op_rows, op_cols = None, None
                nodes.append({
                    "id": node_id,
                    "dataset_id": ds.id,
                    "dataset_name": ds.name,
                    "step": i,
                    "op": op_type,
                    "rows": op_rows,
                    "cols": op_cols,
                    "params": params,
                })
                edges.append({"source": prev_id, "target": node_id, "op": op_type, "cross": False})
                if op_type == "join":
                    right = self.datasets.get(params.get("right_dataset_id"))
                    if right is not None:
                        step = params.get("right_step")
                        if isinstance(step, int) and step > 0:
                            target = f"{right.id}:{step - 1}"
                        elif isinstance(step, int) and step == 0:
                            target = f"{right.id}:init"
                        elif right.history:
                            target = f"{right.id}:{len(right.history) - 1}"
                        else:
                            target = f"{right.id}:init"
                        edges.append({"source": prev_id, "target": target, "op": "join", "cross": True})
        return {"nodes": nodes, "edges": edges}

    def df_at_step(self, dataset_id: str, step: int) -> pd.DataFrame:
        """Rebuild a dataset after `step` operations without mutating session state (-1 = import)."""
        dataset = self.get(dataset_id)
        if step < -1 or step >= len(dataset.history):
            raise ValueError(f"step out of range: {step}")
        tmp = Dataset(dataset.raw_df, name=dataset.name, engine=dataset.engine)
        if step >= 0:
            operations = dataset.history[: step + 1]
            self._replay(tmp, operations)
            if len(tmp.history) != len(operations):
                raise ValueError(f"could not rebuild dataset at step: {step}")
        return tmp.df

    def preview_at(self, dataset_id: str, step: int, limit: int = 100) -> dict[str, Any]:
        """Read-only preview of a dataset as it was after `step` operations (-1 = import state)."""
        dataset = self.get(dataset_id)
        snapshot = Dataset(self.df_at_step(dataset_id, step), name=dataset.name, engine=dataset.engine)
        return snapshot.preview(limit)

    def restore_dataset(
        self,
        df: pd.DataFrame,
        name: str,
        dataset_id: str,
        history: list[dict[str, Any]],
    ) -> Dataset:
        """Register a dataset from external data (project load), then replay its history."""
        dataset = Dataset(df, name=name, dataset_id=dataset_id)
        self.datasets[dataset.id] = dataset
        self._replay(dataset, history)
        self._persist(dataset)
        return dataset


session = SessionManager()
