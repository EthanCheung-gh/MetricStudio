/**
 * Core data model (web: src/types/data.ts). Row-major storage, <100k rows.
 * @Observed so DataState consumers re-render on mutation.
 */
export type CellValue = string | number | boolean | null;
export type DType = 'number' | 'string' | 'date' | 'boolean';
export type FieldType = 'quantitative' | 'nominal' | 'temporal';

@Observed
export class ColumnMeta {
  name: string;
  dtype: DType;
  inferredType: FieldType;
  nullable: boolean;

  constructor(name: string, dtype: DType, inferredType: FieldType, nullable: boolean = true) {
    this.name = name;
    this.dtype = dtype;
    this.inferredType = inferredType;
    this.nullable = nullable;
  }
}

@Observed
export class DataFrame {
  name: string;
  columns: ColumnMeta[];
  rows: CellValue[][];

  constructor(name: string, columns: ColumnMeta[], rows: CellValue[][]) {
    this.name = name;
    this.columns = columns;
    this.rows = rows;
  }

  get rowCount(): number {
    return this.rows.length;
  }

  get colCount(): number {
    return this.columns.length;
  }

  columnIndex(name: string): number {
    for (let i = 0; i < this.columns.length; i++) {
      if (this.columns[i].name === name) {
        return i;
      }
    }
    return -1;
  }

  columnValues(name: string): CellValue[] {
    const idx = this.columnIndex(name);
    if (idx < 0) {
      return [];
    }
    const out: CellValue[] = [];
    for (let r = 0; r < this.rows.length; r++) {
      out.push(this.rows[r][idx]);
    }
    return out;
  }

  /** Deep copy used as undo replay base and by transforms. */
  clone(): DataFrame {
    const cols: ColumnMeta[] = [];
    for (let i = 0; i < this.columns.length; i++) {
      const c = this.columns[i];
      cols.push(new ColumnMeta(c.name, c.dtype, c.inferredType, c.nullable));
    }
    const rows: CellValue[][] = [];
    for (let r = 0; r < this.rows.length; r++) {
      rows.push(this.rows[r].slice());
    }
    return new DataFrame(this.name, cols, rows);
  }
}

/** Transform operator union — semantic subset of web backend transforms. */
export class TransformOp {
  type: string;         // dedupe | fillMissing | convertType | sort | filter | rename | aggregate | compute | dropCol
  params: string;       // JSON-encoded params
  timestamp: string;

  constructor(type: string, params: string) {
    this.type = type;
    this.params = params;
    this.timestamp = new Date().toISOString();
  }
}

/** One lineage step: an applied op plus replay metadata (web LineageView subset). */
@Observed
export class TransformStep {
  op: TransformOp;
  enabled: boolean = true;
  error: string = '';      // replay failure note (step auto-disabled)
  rowsAfter: number = -1;  // -1 = not replayed yet / disabled
  colsAfter: number = -1;

  constructor(op: TransformOp) {
    this.op = op;
  }
}
