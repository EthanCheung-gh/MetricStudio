import { CellValue, DataFrame, TransformOp } from './DataFrame';
import { applyTransformOp } from '../engine/TransformOps';

/**
 * Data-layer state (web: stores/dataStore.ts, local-engine variant).
 * Owns the dataset list, the active dataset, the undo stack and the preview
 * page. All consumers observe via @Consume('dataState').
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

@Observed
export class DataState {
  dataFrames: DataFrame[] = [];
  activeIndex: number = -1;
  transformHistory: TransformOp[] = [];
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
    this.transformHistory = [];
    this.lastError = '';
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
    this.transformHistory = [];
  }

  setActive(index: number): void {
    if (index >= 0 && index < this.dataFrames.length) {
      this.activeIndex = index;
      this.transformHistory = [];
      this.lastError = '';
    }
  }

  /** Apply a transform to the active dataframe (mutates + pushes history). */
  applyTransform(op: TransformOp): boolean {
    const df = this.activeDataFrame;
    if (df === null) {
      this.lastError = 'No active dataset';
      return false;
    }
    try {
      const result = applyTransformOp(df, op);
      this.dataFrames[this.activeIndex] = result;
      this.transformHistory.push(op);
      this.lastError = '';
      return true;
    } catch (e) {
      this.lastError = e instanceof Error ? e.message : String(e);
      return false;
    }
  }

  /** Undo the last transform by replaying history from the original frame. */
  undo(): boolean {
    if (this.transformHistory.length === 0) {
      return false;
    }
    const df = this.activeDataFrame;
    if (df === null) {
      return false;
    }
    // Replay all ops except the last one on a clone of the current frame's
    // pristine base. TransformOps keeps an original snapshot per frame.
    const ops = this.transformHistory.slice(0, this.transformHistory.length - 1);
    let base: DataFrame | null = df.clone();
    for (let i = 0; i < ops.length; i++) {
      base = applyTransformOp(base, ops[i]);
    }
    if (base !== null) {
      this.dataFrames[this.activeIndex] = base;
    }
    this.transformHistory = ops;
    return true;
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
    this.dataFrames[this.activeIndex] = snap.frame.clone();
    this.transformHistory = [];
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
    const result = new DiffResult();
    const cur = this.activeDataFrame;
    result.leftRows = snapshot.frame.rowCount;
    result.leftCols = snapshot.frame.colCount;
    if (cur !== null) {
      result.rightRows = cur.rowCount;
      result.rightCols = cur.colCount;
    }
    const leftKeys = new Set<string>();
    for (let r = 0; r < snapshot.frame.rows.length; r++) {
      leftKeys.add(rowKey(snapshot.frame, r));
    }
    const rightKeys = new Set<string>();
    if (cur !== null) {
      for (let r = 0; r < cur.rows.length; r++) {
        rightKeys.add(rowKey(cur, r));
      }
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
    if (cur !== null) {
      const nCols = Math.min(snapshot.frame.colCount, cur.colCount);
      for (let c = 0; c < nCols; c++) {
        const col = snapshot.frame.columns[c];
        if (col.dtype !== 'number') {
          continue;
        }
        const d = new DiffColumn();
        d.column = col.name;
        d.leftMean = columnMean(snapshot.frame, c);
        d.rightMean = columnMean(cur, c);
        if (d.leftMean !== d.rightMean) {
          result.numericDiff.push(d);
        }
      }
    }
    return result;
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
