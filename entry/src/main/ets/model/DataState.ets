import { CellValue, DataFrame, TransformOp, TransformStep } from './DataFrame';
import { applyTransformOp } from '../engine/TransformOps';

/**
 * Data-layer state (web: stores/dataStore.ts, local-engine variant).
 * Owns the dataset list, the active dataset, the lineage chain (base snapshot
 * + applied steps), snapshots and the preview page. All consumers observe via
 * @Consume('dataState').
 */
/** Immutable snapshot of a DataFrame at a point in time (web DataSnapshot). */
@Observed
export class DataSnapshot {
  id: string;
  name: string;
  description: string;
  frame: DataFrame;
  createdAt: string;

  constructor(name: string, description: string, frame: DataFrame) {
    this.id = 'snap_' + Date.now().toString();
    this.name = name;
    this.description = description;
    this.frame = frame;
    this.createdAt = new Date().toISOString();
  }
}

/** Snapshot vs current diff result (web DataDiffResult subset). */
export class DiffResult {
  leftRows: number = 0;
  rightRows: number = 0;
  leftCols: number = 0;
  rightCols: number = 0;
  onlyLeft: string[] = [];
  onlyRight: string[] = [];
  numericDiff: DiffColumn[] = [];
}

export class DiffColumn {
  column: string = '';
  leftMean: number | null = null;
  rightMean: number | null = null;
}

/** Row-key diff between any two frames (web diff-steps / snapshot diff). */
export function diffFrames(left: DataFrame, right: DataFrame): DiffResult {
  const result = new DiffResult();
  result.leftRows = left.rowCount;
  result.leftCols = left.colCount;
  result.rightRows = right.rowCount;
  result.rightCols = right.colCount;
  const leftKeys = new Set<string>();
  for (let r = 0; r < left.rows.length; r++) {
    leftKeys.add(rowKey(left, r));
  }
  const rightKeys = new Set<string>();
  for (let r = 0; r < right.rows.length; r++) {
    rightKeys.add(rowKey(right, r));
  }
  rightKeys.forEach((k: string) => {
    if (!leftKeys.has(k)) {
      result.onlyRight.push(k);
    }
  });
  leftKeys.forEach((k: string) => {
    if (!rightKeys.has(k)) {
      result.onlyLeft.push(k);
    }
  });
  // numeric column mean comparison
  const nCols = Math.min(left.colCount, right.colCount);
  for (let c = 0; c < nCols; c++) {
    const col = left.columns[c];
    if (col.dtype !== 'number') {
      continue;
    }
    const d = new DiffColumn();
    d.column = col.name;
    d.leftMean = columnMean(left, c);
    d.rightMean = columnMean(right, c);
    if (d.leftMean !== d.rightMean) {
      result.numericDiff.push(d);
    }
  }
  return result;
}

@Observed
export class DataState {
  dataFrames: DataFrame[] = [];
  activeIndex: number = -1;
  // Lineage chain of the active dataset: base snapshot + applied steps.
  baseFrame: DataFrame | null = null;
  transformHistory: TransformStep[] = [];
  lineageTick: number = 0;
  lastError: string = '';
  snapshots: DataSnapshot[] = [];

  get activeDataFrame(): DataFrame | null {
    if (this.activeIndex < 0 || this.activeIndex >= this.dataFrames.length) {
      return null;
    }
    return this.dataFrames[this.activeIndex];
  }

  get rowCount(): number {
    const df = this.activeDataFrame;
    return df !== null ? df.rowCount : 0;
  }

  get colCount(): number {
    const df = this.activeDataFrame;
    return df !== null ? df.colCount : 0;
  }

  get hasData(): boolean {
    return this.dataFrames.length > 0;
  }

  importDataFrame(df: DataFrame): void {
    this.dataFrames.push(df);
    this.activeIndex = this.dataFrames.length - 1;
    this.baseFrame = df.clone();
    this.transformHistory = [];
    this.lastError = '';
    this.bumpLineage();
  }

  removeDataFrame(index: number): void {
    if (index < 0 || index >= this.dataFrames.length) {
      return;
    }
    this.dataFrames.splice(index, 1);
    if (this.dataFrames.length === 0) {
      this.activeIndex = -1;
    } else if (this.activeIndex >= this.dataFrames.length) {
      this.activeIndex = this.dataFrames.length - 1;
    }
    this.baseFrame = null;
    this.transformHistory = [];
    this.bumpLineage();
  }

  setActive(index: number): void {
    if (index >= 0 && index < this.dataFrames.length) {
      this.activeIndex = index;
      this.baseFrame = null;
      this.transformHistory = [];
      this.lastError = '';
      this.bumpLineage();
    }
  }

  /** Apply a transform to the active dataframe (mutates + appends a step). */
  applyTransform(op: TransformOp): boolean {
    const df = this.activeDataFrame;
    if (df === null) {
      this.lastError = 'No active dataset';
      return false;
    }
    // A chain already exists only when a base snapshot is tracked; without it
    // (e.g. dataset chosen before this feature) start tracking from here.
    if (this.baseFrame === null) {
      this.baseFrame = df.clone();
    }
    try {
      const result = applyTransformOp(df, op);
      this.dataFrames[this.activeIndex] = result;
      const step = new TransformStep(op);
      step.rowsAfter = result.rowCount;
      step.colsAfter = result.colCount;
      this.transformHistory.push(step);
      this.lastError = '';
      this.bumpLineage();
      return true;
    } catch (e) {
      this.lastError = e instanceof Error ? e.message : String(e);
      return false;
    }
  }

  /**
   * Undo the last step: drop it from the chain and replay the remaining
   * enabled steps from the base snapshot (web globalUndo semantics — fixes
   * the old replay-on-current-frame bug for non-idempotent ops).
   */
  undo(): boolean {
    if (this.transformHistory.length === 0 || this.baseFrame === null) {
      return false;
    }
    this.transformHistory = this.transformHistory.slice(0, this.transformHistory.length - 1);
    const frame = this.replayTo(-1);
    if (frame !== null) {
      this.dataFrames[this.activeIndex] = frame;
    }
    this.lastError = '';
    this.bumpLineage();
    return true;
  }

  /** Enable/disable a step and rebuild the active frame from base. */
  toggleStep(index: number): boolean {
    if (index < 0 || index >= this.transformHistory.length || this.baseFrame === null) {
      return false;
    }
    const step = this.transformHistory[index];
    step.enabled = !step.enabled;
    const frame = this.replayTo(-1);
    if (frame !== null) {
      this.dataFrames[this.activeIndex] = frame;
    }
    this.bumpLineage();
    return true;
  }

  /**
   * Frame state after replaying enabled steps 0..index from base (web
   * preview?at=step). Does not touch the active frame.
   */
  previewAtStep(index: number): DataFrame | null {
    if (this.baseFrame === null || index < 0 || index >= this.transformHistory.length) {
      return null;
    }
    return this.replayTo(index);
  }

  /**
   * Replay the chain from the base snapshot. upTo = -1 replays every enabled
   * step; otherwise replay stops after step `upTo` (inclusive). Steps that
   * throw (e.g. renamed-away columns) are auto-disabled and skipped. Also
   * refreshes each applied step's rows/cols metadata.
   */
  private replayTo(upTo: number): DataFrame | null {
    const base = this.baseFrame;
    if (base === null || this.activeIndex < 0) {
      return null;
    }
    let cur = base.clone();
    for (let i = 0; i < this.transformHistory.length; i++) {
      const step = this.transformHistory[i];
      const within = upTo < 0 || i <= upTo;
      if (!step.enabled || !within) {
        continue;
      }
      try {
        cur = applyTransformOp(cur, step.op);
        step.error = '';
      } catch (e) {
        step.enabled = false;
        step.error = e instanceof Error ? e.message : String(e);
      }
      step.rowsAfter = cur.rowCount;
      step.colsAfter = cur.colCount;
    }
    return cur;
  }

  private bumpLineage(): void {
    this.lineageTick++;
    AppStorage.setOrCreate('lineageTick', this.lineageTick);
  }

  previewPage(page: number, pageSize: number): CellValue[][] {
    const df = this.activeDataFrame;
    if (df === null) {
      return [];
    }
    const start = page * pageSize;
    const end = Math.min(start + pageSize, df.rowCount);
    const out: CellValue[][] = [];
    for (let r = start; r < end; r++) {
      out.push(df.rows[r]);
    }
    return out;
  }

  // ---- Snapshots (web SnapshotView) ----

  createSnapshot(name: string, description: string): boolean {
    const df = this.activeDataFrame;
    if (df === null || name.trim().length === 0) {
      return false;
    }
    this.snapshots.unshift(new DataSnapshot(name.trim(), description.trim(), df.clone()));
    return true;
  }

  deleteSnapshot(id: string): void {
    const next: DataSnapshot[] = [];
    for (let i = 0; i < this.snapshots.length; i++) {
      if (this.snapshots[i].id !== id) {
        next.push(this.snapshots[i]);
      }
    }
    this.snapshots = next;
  }

  /** Replace the active dataframe content with the snapshot's frame. */
  restoreSnapshot(id: string): boolean {
    const snap = this.findSnapshot(id);
    if (snap === null || this.activeIndex < 0) {
      return false;
    }
    const restored = snap.frame.clone();
    this.dataFrames[this.activeIndex] = restored;
    this.baseFrame = restored.clone();
    this.transformHistory = [];
    this.bumpLineage();
    return true;
  }

  findSnapshot(id: string): DataSnapshot | null {
    for (let i = 0; i < this.snapshots.length; i++) {
      if (this.snapshots[i].id === id) {
        return this.snapshots[i];
      }
    }
    return null;
  }

  /** Row-key diff between a snapshot and the current active dataframe. */
  diffWithCurrent(snapshot: DataSnapshot): DiffResult {
    const cur = this.activeDataFrame;
    if (cur === null) {
      return diffFrames(snapshot.frame, snapshot.frame);
    }
    return diffFrames(snapshot.frame, cur);
  }
}

function rowKey(df: DataFrame, r: number): string {
  const parts: string[] = [];
  for (let c = 0; c < df.columns.length; c++) {
    const v = df.rows[r][c];
    parts.push(v === null || v === undefined ? '' : String(v));
  }
  return parts.join('\u0001');
}

function columnMean(df: DataFrame, c: number): number | null {
  let s = 0;
  let n = 0;
  for (let r = 0; r < df.rows.length; r++) {
    const v = df.rows[r][c];
    if (v !== null && v !== undefined) {
      const num = Number(v);
      if (!Number.isNaN(num)) {
        s += num;
        n++;
      }
    }
  }
  return n > 0 ? s / n : null;
}
