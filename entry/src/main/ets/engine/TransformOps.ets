import { CellValue, ColumnMeta, DataFrame, TransformOp } from '../model/DataFrame';
import { parseNumericLike, toNumber } from './Numeric';

/** JSON param shapes for each transform op (parsed from TransformOp.params). */
export interface DedupeParams {
  columns: string[] | null;
}
export interface FillMissingParams {
  column: string;
  value: string;
}
export interface ConvertTypeParams {
  column: string;
  target: string;
}
export interface SortParams {
  column: string;
  ascending: boolean;
}
export interface FilterParams {
  column: string;
  operator: string;
  value: string;
}
export interface RenameParams {
  oldName: string;
  newName: string;
}
export interface AggregateParams {
  groupBy: string;
  column: string;
  agg: string; // sum | mean | count | min | max
}
export interface ComputeParams {
  name: string;
  sourceColumn: string;
  operation: string; // abs | neg | sqrt | square
}
export interface DropColParams {
  columns: string[];
}
export interface StrCleanParams {
  column: string;
  action: string; // trim | lower | upper
  newColumn?: string;
}
export interface SampleParams {
  n: number;
}
export interface PivotParams {
  index: string;
  columns: string;
  values: string;
  agg: string;
}
export interface MeltParams {
  idVars: string[];
}

export function parseParams<T>(op: TransformOp): T {
  return JSON.parse(op.params) as T;
}

function compareCell(a: CellValue, b: CellValue): number {
  const na = toNumber(a);
  const nb = toNumber(b);
  if (na !== null && nb !== null) {
    return na < nb ? -1 : (na > nb ? 1 : 0);
  }
  const sa = a === null ? '' : String(a);
  const sb = b === null ? '' : String(b);
  return sa < sb ? -1 : (sa > sb ? 1 : 0);
}

function matchesFilter(cell: CellValue, operator: string, value: string): boolean {
  const tv = toNumber(value);
  const cv = toNumber(cell);
  switch (operator) {
    case 'eq':
      if (cv !== null && tv !== null) {
        return cv === tv;
      }
      return cell !== null && String(cell) === value;
    case 'ne':
      return !matchesFilter(cell, 'eq', value);
    case 'gt':
      return cv !== null && tv !== null && cv > tv;
    case 'gte':
      return cv !== null && tv !== null && cv >= tv;
    case 'lt':
      return cv !== null && tv !== null && cv < tv;
    case 'lte':
      return cv !== null && tv !== null && cv <= tv;
    case 'contains':
      return cell !== null && String(cell).indexOf(value) >= 0;
    case 'startswith':
      return cell !== null && String(cell).startsWith(value);
    case 'endswith':
      return cell !== null && String(cell).endsWith(value);
    default:
      return false;
  }
}

/**
 * Apply one transform op immutably. Throws on invalid params so DataState can
 * surface the message to the user.
 */
export function applyTransformOp(df: DataFrame, op: TransformOp): DataFrame {
  const next = df.clone();
  switch (op.type) {
    case 'dedupe': {
      const p = parseParams<DedupeParams>(op);
      next.rows = dedupeRows(next, p.columns);
      break;
    }
    case 'fillMissing': {
      const p = parseParams<FillMissingParams>(op);
      fillColumn(next, p.column, p.value);
      break;
    }
    case 'convertType': {
      const p = parseParams<ConvertTypeParams>(op);
      castColumn(next, p.column, p.target);
      break;
    }
    case 'sort': {
      const p = parseParams<SortParams>(op);
      next.rows = sortRows(next, p.column, p.ascending);
      break;
    }
    case 'filter': {
      const p = parseParams<FilterParams>(op);
      next.rows = filterRows(next, p.column, p.operator, p.value);
      break;
    }
    case 'rename': {
      const p = parseParams<RenameParams>(op);
      renameColumn(next, p.oldName, p.newName);
      break;
    }
    case 'aggregate': {
      const p = parseParams<AggregateParams>(op);
      return aggregateRows(next, p.groupBy, p.column, p.agg);
    }
    case 'compute': {
      const p = parseParams<ComputeParams>(op);
      computeColumn(next, p.name, p.sourceColumn, p.operation);
      break;
    }
    case 'dropCol': {
      const p = parseParams<DropColParams>(op);
      dropColumns(next, p.columns);
      break;
    }
    case 'dropNa': {
      const p = parseParams<DedupeParams>(op);
      next.rows = dropNaRows(next, p.columns);
      break;
    }
    case 'strClean': {
      const p = parseParams<StrCleanParams>(op);
      strClean(next, p.column, p.action, p.newColumn);
      break;
    }
    case 'sample': {
      const p = parseParams<SampleParams>(op);
      next.rows = sampleRows(next, p.n);
      break;
    }
    case 'pivot': {
      const p = parseParams<PivotParams>(op);
      return pivotTable(next, p);
    }
    case 'melt': {
      const p = parseParams<MeltParams>(op);
      return meltTable(next, p.idVars);
    }
    default:
      throw new Error('Unknown transform op: ' + op.type);
  }
  return next;
}

function dedupeRows(df: DataFrame, columns: string[] | null): CellValue[][] {
  const idxs = columnIdxs(df, columns);
  const seen = new Set<string>();
  const out: CellValue[][] = [];
  for (let r = 0; r < df.rows.length; r++) {
    const parts: string[] = [];
    for (let k = 0; k < idxs.length; k++) {
      parts.push(String(df.rows[r][idxs[k]]));
    }
    const key = parts.join('\u0001');
    if (!seen.has(key)) {
      seen.add(key);
      out.push(df.rows[r]);
    }
  }
  return out;
}

function fillColumn(df: DataFrame, column: string, value: string): void {
  const idx = df.columnIndex(column);
  if (idx < 0) {
    throw new Error('Column not found: ' + column);
  }
  const dtype = df.columns[idx].dtype;
  const fillValue: CellValue = dtype === 'number' ? parseNumericLike(value) : value;
  for (let r = 0; r < df.rows.length; r++) {
    if (df.rows[r][idx] === null) {
      df.rows[r][idx] = fillValue;
    }
  }
}

function castColumn(df: DataFrame, column: string, target: string): void {
  const idx = df.columnIndex(column);
  if (idx < 0) {
    throw new Error('Column not found: ' + column);
  }
  if (target === 'number') {
    for (let r = 0; r < df.rows.length; r++) {
      const v = df.rows[r][idx];
      if (v !== null && typeof v !== 'number') {
        df.rows[r][idx] = parseNumericLike(String(v));
      }
    }
    df.columns[idx] = new ColumnMeta(column, 'number', 'quantitative', df.columns[idx].nullable);
  } else if (target === 'string') {
    for (let r = 0; r < df.rows.length; r++) {
      const v = df.rows[r][idx];
      if (v !== null) {
        df.rows[r][idx] = String(v);
      }
    }
    df.columns[idx] = new ColumnMeta(column, 'string', 'nominal', df.columns[idx].nullable);
  }
}

function sortRows(df: DataFrame, column: string, ascending: boolean): CellValue[][] {
  const idx = df.columnIndex(column);
  if (idx < 0) {
    throw new Error('Column not found: ' + column);
  }
  const rows = df.rows.slice();
  rows.sort((a: CellValue[], b: CellValue[]) => {
    const av = a[idx];
    const bv = b[idx];
    if (av === null && bv === null) {
      return 0;
    }
    if (av === null) {
      return 1;
    }
    if (bv === null) {
      return -1;
    }
    const c = compareCell(av, bv);
    return ascending ? c : -c;
  });
  return rows;
}

function filterRows(df: DataFrame, column: string, operator: string, value: string): CellValue[][] {
  const idx = df.columnIndex(column);
  if (idx < 0) {
    throw new Error('Column not found: ' + column);
  }
  const out: CellValue[][] = [];
  for (let r = 0; r < df.rows.length; r++) {
    if (matchesFilter(df.rows[r][idx], operator, value)) {
      out.push(df.rows[r]);
    }
  }
  return out;
}

function renameColumn(df: DataFrame, oldName: string, newName: string): void {
  const idx = df.columnIndex(oldName);
  if (idx < 0) {
    throw new Error('Column not found: ' + oldName);
  }
  if (newName.length === 0) {
    throw new Error('New name must not be empty');
  }
  df.columns[idx] = new ColumnMeta(newName, df.columns[idx].dtype, df.columns[idx].inferredType,
    df.columns[idx].nullable);
}

function aggregateRows(df: DataFrame, groupBy: string, column: string, agg: string): DataFrame {
  const gIdx = df.columnIndex(groupBy);
  const cIdx = df.columnIndex(column);
  if (gIdx < 0) {
    throw new Error('Group column not found: ' + groupBy);
  }
  if (cIdx < 0) {
    throw new Error('Column not found: ' + column);
  }
  // group key -> values
  const groups = new Map<string, number[]>();
  const groupOrder: string[] = [];
  for (let r = 0; r < df.rows.length; r++) {
    const key = df.rows[r][gIdx] === null ? '' : String(df.rows[r][gIdx]);
    const n = toNumber(df.rows[r][cIdx]);
    let arr = groups.get(key);
    if (arr === undefined) {
      arr = [];
      groups.set(key, arr);
      groupOrder.push(key);
    }
    if (n !== null) {
      arr.push(n);
    }
  }
  const cols: ColumnMeta[] = [
    new ColumnMeta(groupBy, 'string', 'nominal', false),
    new ColumnMeta(agg + '_' + column, 'number', 'quantitative', false),
  ];
  const rows: CellValue[][] = [];
  for (let i = 0; i < groupOrder.length; i++) {
    const key = groupOrder[i];
    const vals = groups.get(key);
    const arr = vals !== undefined ? vals : [];
    rows.push([key, aggregateValue(arr, agg)]);
  }
  return new DataFrame(df.name + ' (agg)', cols, rows);
}

function aggregateValue(values: number[], agg: string): number {
  if (values.length === 0) {
    return 0;
  }
  switch (agg) {
    case 'sum': {
      let s = 0;
      for (let i = 0; i < values.length; i++) {
        s += values[i];
      }
      return s;
    }
    case 'mean': {
      let s = 0;
      for (let i = 0; i < values.length; i++) {
        s += values[i];
      }
      return s / values.length;
    }
    case 'count':
      return values.length;
    case 'min': {
      let m = values[0];
      for (let i = 1; i < values.length; i++) {
        if (values[i] < m) {
          m = values[i];
        }
      }
      return m;
    }
    case 'max': {
      let m = values[0];
      for (let i = 1; i < values.length; i++) {
        if (values[i] > m) {
          m = values[i];
        }
      }
      return m;
    }
    default:
      throw new Error('Unknown aggregate: ' + agg);
  }
}

function computeColumn(df: DataFrame, name: string, sourceColumn: string, operation: string): void {
  const idx = df.columnIndex(sourceColumn);
  if (idx < 0) {
    throw new Error('Column not found: ' + sourceColumn);
  }
  if (name.length === 0) {
    throw new Error('New column name must not be empty');
  }
  if (df.columnIndex(name) >= 0) {
    throw new Error('Column already exists: ' + name);
  }
  const values: number[] = [];
  for (let r = 0; r < df.rows.length; r++) {
    const n = toNumber(df.rows[r][idx]);
    let out: number | null = null;
    if (n !== null) {
      switch (operation) {
        case 'abs':
          out = Math.abs(n);
          break;
        case 'neg':
          out = -n;
          break;
        case 'sqrt':
          out = n >= 0 ? Math.sqrt(n) : null;
          break;
        case 'square':
          out = n * n;
          break;
        default:
          throw new Error('Unknown operation: ' + operation);
      }
    }
    values.push(out !== null ? out : Number.NaN);
  }
  df.columns.push(new ColumnMeta(name, 'number', 'quantitative', false));
  for (let r = 0; r < df.rows.length; r++) {
    df.rows[r].push(Number.isNaN(values[r]) ? null : values[r]);
  }
}

function dropColumns(df: DataFrame, columns: string[]): void {
  const dropSet = new Set<string>(columns);
  const keepIdxs: number[] = [];
  const keepCols: ColumnMeta[] = [];
  for (let i = 0; i < df.columns.length; i++) {
    if (!dropSet.has(df.columns[i].name)) {
      keepIdxs.push(i);
      keepCols.push(df.columns[i]);
    }
  }
  if (keepIdxs.length === df.colCount) {
    throw new Error('No columns to drop');
  }
  df.columns = keepCols;
  const rows: CellValue[][] = [];
  for (let r = 0; r < df.rows.length; r++) {
    const row: CellValue[] = [];
    for (let k = 0; k < keepIdxs.length; k++) {
      row.push(df.rows[r][keepIdxs[k]]);
    }
    rows.push(row);
  }
  df.rows = rows;
}

function columnIdxs(df: DataFrame, columns: string[] | null): number[] {
  if (columns === null) {
    const out: number[] = [];
    for (let i = 0; i < df.columns.length; i++) {
      out.push(i);
    }
    return out;
  }
  const out: number[] = [];
  for (let k = 0; k < columns.length; k++) {
    const i = df.columnIndex(columns[k]);
    if (i >= 0) {
      out.push(i);
    }
  }
  return out;
}

function dropNaRows(df: DataFrame, columns: string[] | null): CellValue[][] {
  const idxs = columnIdxs(df, columns);
  const out: CellValue[][] = [];
  for (let r = 0; r < df.rows.length; r++) {
    let hasNull = false;
    for (let k = 0; k < idxs.length; k++) {
      if (df.rows[r][idxs[k]] === null || df.rows[r][idxs[k]] === undefined) {
        hasNull = true;
        break;
      }
    }
    if (!hasNull) {
      out.push(df.rows[r]);
    }
  }
  return out;
}

function strClean(df: DataFrame, column: string, action: string, newColumn?: string): void {
  const idx = df.columnIndex(column);
  if (idx < 0) {
    throw new Error('Column not found: ' + column);
  }
  const outIdx = newColumn !== undefined && newColumn.length > 0 ? idx : -1;
  if (outIdx < 0 && newColumn !== undefined && newColumn.length > 0) {
    if (df.columnIndex(newColumn) >= 0) {
      throw new Error('Column already exists: ' + newColumn);
    }
    df.columns.push(new ColumnMeta(newColumn, 'string', 'nominal', false));
    for (let r = 0; r < df.rows.length; r++) {
      df.rows[r].push(null);
    }
  }
  const target = outIdx < 0 ? idx : df.columnIndex(newColumn !== undefined ? newColumn : column);
  for (let r = 0; r < df.rows.length; r++) {
    const v = df.rows[r][idx];
    if (v === null || v === undefined) {
      continue;
    }
    const s = String(v);
    if (action === 'trim') {
      df.rows[r][target] = s.trim();
    } else if (action === 'lower') {
      df.rows[r][target] = s.toLowerCase();
    } else if (action === 'upper') {
      df.rows[r][target] = s.toUpperCase();
    }
  }
}

function sampleRows(df: DataFrame, n: number): CellValue[][] {
  const count = Math.max(0, Math.min(n, df.rowCount));
  const out: CellValue[][] = [];
  for (let r = 0; r < count; r++) {
    out.push(df.rows[r]);
  }
  return out;
}

function pivotTable(df: DataFrame, p: PivotParams): DataFrame {
  const iIdx = df.columnIndex(p.index);
  const cIdx = df.columnIndex(p.columns);
  const vIdx = df.columnIndex(p.values);
  if (iIdx < 0 || cIdx < 0 || vIdx < 0) {
    throw new Error('pivot 需要 index/columns/values 三个字段');
  }
  const cell = new Map<string, number[]>();
  const rowOrder: string[] = [];
  const colOrder: string[] = [];
  for (let r = 0; r < df.rows.length; r++) {
    const rk = df.rows[r][iIdx] === null ? '' : String(df.rows[r][iIdx]);
    const ck = df.rows[r][cIdx] === null ? '' : String(df.rows[r][cIdx]);
    const n = toNumber(df.rows[r][vIdx]);
    if (rowOrder.indexOf(rk) < 0) {
      rowOrder.push(rk);
    }
    if (colOrder.indexOf(ck) < 0) {
      colOrder.push(ck);
    }
    const key = rk + '\u0001' + ck;
    let arr = cell.get(key);
    if (arr === undefined) {
      arr = [];
      cell.set(key, arr);
    }
    if (n !== null) {
      arr.push(n);
    }
  }
  const cols: ColumnMeta[] = [new ColumnMeta(p.index, 'string', 'nominal', false)];
  for (let k = 0; k < colOrder.length; k++) {
    cols.push(new ColumnMeta(colOrder[k], 'number', 'quantitative', false));
  }
  const rows: CellValue[][] = [];
  for (let i = 0; i < rowOrder.length; i++) {
    const row: CellValue[] = [rowOrder[i]];
    for (let k = 0; k < colOrder.length; k++) {
      const arr = cell.get(rowOrder[i] + '\u0001' + colOrder[k]);
      row.push(arr !== undefined ? aggregateNumbers(arr, p.agg) : null);
    }
    rows.push(row);
  }
  return new DataFrame(df.name + ' (pivot)', cols, rows);
}

function meltTable(df: DataFrame, idVars: string[]): DataFrame {
  if (idVars.length === 0) {
    throw new Error('melt 需要至少一个 ID 列');
  }
  const idIdxs: number[] = [];
  for (let i = 0; i < df.columns.length; i++) {
    if (idVars.indexOf(df.columns[i].name) >= 0) {
      idIdxs.push(i);
    }
  }
  const cols: ColumnMeta[] = [];
  for (let k = 0; k < idIdxs.length; k++) {
    cols.push(new ColumnMeta(df.columns[idIdxs[k]].name, df.columns[idIdxs[k]].dtype,
      df.columns[idIdxs[k]].inferredType, df.columns[idIdxs[k]].nullable));
  }
  cols.push(new ColumnMeta('variable', 'string', 'nominal', false));
  cols.push(new ColumnMeta('value', 'string', 'nominal', true));
  const rows: CellValue[][] = [];
  for (let r = 0; r < df.rows.length; r++) {
    for (let c = 0; c < df.columns.length; c++) {
      if (idIdxs.indexOf(c) >= 0) {
        continue;
      }
      const row: CellValue[] = [];
      for (let k = 0; k < idIdxs.length; k++) {
        row.push(df.rows[r][idIdxs[k]]);
      }
      row.push(df.columns[c].name);
      row.push(df.rows[r][c]);
      rows.push(row);
    }
  }
  return new DataFrame(df.name + ' (melt)', cols, rows);
}

function aggregateNumbers(values: number[], agg: string): number {
  if (values.length === 0) {
    return 0;
  }
  switch (agg) {
    case 'mean': {
      let s = 0;
      for (let i = 0; i < values.length; i++) {
        s += values[i];
      }
      return s / values.length;
    }
    case 'count':
      return values.length;
    case 'min': {
      let m = values[0];
      for (let i = 1; i < values.length; i++) {
        if (values[i] < m) {
          m = values[i];
        }
      }
      return m;
    }
    case 'max': {
      let m = values[0];
      for (let i = 1; i < values.length; i++) {
        if (values[i] > m) {
          m = values[i];
        }
      }
      return m;
    }
    case 'sum':
    default: {
      let s = 0;
      for (let i = 0; i < values.length; i++) {
        s += values[i];
      }
      return s;
    }
  }
}
