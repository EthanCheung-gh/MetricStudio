import { CellValue, DType, FieldType } from '../model/DataFrame';

/**
 * Column type inference (web: backend/core/dataframe.py infer_dtype_category).
 * number: ≥90% numeric; date: ≥90% ISO date; else string.
 */
export function inferDtype(values: CellValue[]): DType {
  if (values.length === 0) {
    return 'string';
  }
  let numeric = 0;
  let dateLike = 0;
  let total = 0;
  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    if (v === null || v === undefined || v === '') {
      continue;
    }
    total++;
    if (typeof v === 'number') {
      numeric++;
      continue;
    }
    const s = String(v).trim();
    if (isNumeric(s)) {
      numeric++;
    } else if (isIsoDate(s)) {
      dateLike++;
    }
  }
  if (total === 0) {
    return 'string';
  }
  if (numeric / total >= 0.9) {
    return 'number';
  }
  if (dateLike / total >= 0.9) {
    return 'date';
  }
  return 'string';
}

/** Map a DType to the encoding FieldType used by charts. */
export function fieldTypeFor(dtype: DType): FieldType {
  if (dtype === 'number') {
    return 'quantitative';
  }
  if (dtype === 'date') {
    return 'temporal';
  }
  return 'nominal';
}

export function isNumeric(s: string): boolean {
  if (s.length === 0) {
    return false;
  }
  // Number('') === 0 — guard empties; also reject Infinity/NaN strings
  if (s === 'Infinity' || s === '-Infinity' || s === 'NaN') {
    return false;
  }
  const n = Number(s);
  return !Number.isNaN(n) && isFinite(n);
}

export function isIsoDate(s: string): boolean {
  // ^\d{4}-\d{2}-\d{2} (optionally with time)
  if (!/^\d{4}-\d{2}-\d{2}/.test(s)) {
    return false;
  }
  const t = Date.parse(s);
  return !Number.isNaN(t);
}
