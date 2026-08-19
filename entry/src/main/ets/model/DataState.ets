import { CellValue, DataFrame, TransformOp } from './DataFrame';
import { applyTransformOp } from '../engine/TransformOps';

/**
 * Data-layer state (web: stores/dataStore.ts, local-engine variant).
 * Owns the dataset list, the active dataset, the undo stack and the preview
 * page. All consumers observe via @Consume('dataState').
 */
@Observed
export class DataState {
  dataFrames: DataFrame[] = [];
  activeIndex: number = -1;
  transformHistory: TransformOp[] = [];
  lastError: string = '';

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
}
