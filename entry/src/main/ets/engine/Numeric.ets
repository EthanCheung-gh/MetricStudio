import { CellValue } from '../model/DataFrame';

/** Coerce a cell to a number; null/''/NaN → null. */
export function toNumber(v: CellValue): number | null {
  if (v === null || v === undefined) {
    return null;
  }
  if (typeof v === 'number') {
    return Number.isNaN(v) ? null : v;
  }
  if (typeof v === 'boolean') {
    return v ? 1 : 0;
  }
  return parseNumericLike(String(v));
}

/** Align Web parse_numeric_series: strip spaces, thousands separators, % and $. */
export function parseNumericLike(v: string): number | null {
  const cleaned = v.trim().replace(/,/g, '').replace(/%/g, '').replace(/\$/g, '');
  if (cleaned === '') {
    return null;
  }
  const n = Number(cleaned);
  return Number.isNaN(n) ? null : n;
}
