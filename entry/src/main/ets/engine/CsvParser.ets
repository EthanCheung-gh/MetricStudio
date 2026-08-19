import { CellValue, ColumnMeta, DataFrame } from '../model/DataFrame';
import { inferDtype, fieldTypeFor } from './InferType';

/**
 * RFC4180 CSV parser (web: backend/core/dataframe.py). Handles quoted fields,
 * escaped "" inside quotes, embedded newlines, empty values; first row = header.
 */
export class ParseResult {
  ok: boolean;
  error: string;
  dataFrame: DataFrame | null;

  constructor(ok: boolean, error: string, dataFrame: DataFrame | null) {
    this.ok = ok;
    this.error = error;
    this.dataFrame = dataFrame;
  }
}

export function parseCsvText(text: string, name: string): ParseResult {
  if (text.length === 0) {
    return new ParseResult(false, 'Empty text', null);
  }
  // Normalize \r\n and stray \r
  const norm = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const lines = splitCsvLines(norm);
  if (lines.length === 0 || lines[0].length === 0) {
    return new ParseResult(false, 'No rows', null);
  }
  const headerRow = parseLine(lines[0]);
  if (headerRow.length === 0) {
    return new ParseResult(false, 'No columns parsed', null);
  }
  const colCount = headerRow.length;
  const rows: CellValue[][] = [];
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (line.trim().length === 0) {
      continue;
    }
    const fields = parseLine(line);
    const row: CellValue[] = [];
    for (let c = 0; c < colCount; c++) {
      const raw = c < fields.length ? fields[c] : '';
      row.push(raw.length === 0 ? null : raw);
    }
    rows.push(row);
  }
  // Convert to typed values per inferred column dtype
  const columns: ColumnMeta[] = [];
  const converted: CellValue[][] = [];
  for (let c = 0; c < colCount; c++) {
    const rawCol: CellValue[] = [];
    for (let r = 0; r < rows.length; r++) {
      rawCol.push(rows[r][c]);
    }
    const dtype = inferDtype(rawCol);
    columns.push(new ColumnMeta(headerRow[c], dtype, fieldTypeFor(dtype), false));
    for (let r = 0; r < rows.length; r++) {
      if (converted.length <= r) {
        converted.push([]);
      }
      converted[r].push(convertValue(rows[r][c], dtype));
    }
  }
  const df = new DataFrame(name, columns, converted);
  return new ParseResult(true, '', df);
}

function splitCsvLines(text: string): string[] {
  const out: string[] = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      cur += ch;
      if (ch === '"') {
        // escaped "" inside quotes, or closing quote
        if (i + 1 < text.length && text[i + 1] === '"') {
          cur += '"';
          i++;
        } else {
          inQuotes = false;
        }
      }
    } else if (ch === '"') {
      inQuotes = true;
      cur += ch;
    } else if (ch === '\n') {
      out.push(cur);
      cur = '';
    } else {
      cur += ch;
    }
  }
  if (cur.length > 0 || out.length === 0) {
    out.push(cur);
  }
  return out;
}

function parseLine(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (i + 1 < line.length && line[i + 1] === '"') {
          cur += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        cur += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      out.push(cur);
      cur = '';
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out;
}

function convertValue(v: CellValue, dtype: string): CellValue {
  if (v === null || v === undefined) {
    return null;
  }
  const s = String(v).trim();
  if (dtype === 'number') {
    const n = Number(s);
    return Number.isNaN(n) ? null : n;
  }
  if (dtype === 'boolean') {
    if (s === 'true' || s === '1') {
      return true;
    }
    if (s === 'false' || s === '0') {
      return false;
    }
    return v;
  }
  if (dtype === 'date') {
    // Keep raw string; chart layer formats dates
    return s;
  }
  return v;
}
