/**
 * Formatting helpers (web: src/utils/format.ts fmt()).
 */

/** Thousands-separated integer / fixed decimals, e.g. 1234567 → "1,234,567". */
export function fmt(n: number): string {
  if (Number.isNaN(n)) {
    return 'NaN';
  }
  if (!Number.isFinite(n)) {
    return n > 0 ? '∞' : '-∞';
  }
  const neg = n < 0;
  const abs = Math.abs(n);
  let s: string;
  if (Number.isInteger(abs)) {
    s = String(abs);
  } else {
    s = abs.toFixed(2);
    // trim trailing zeros
    if (s.indexOf('.') >= 0) {
      s = s.replace(/0+$/, '').replace(/\.$/, '');
    }
  }
  // insert thousands separators
  const parts = s.split('.');
  let intPart = parts[0];
  const out: string[] = [];
  while (intPart.length > 3) {
    out.unshift(intPart.slice(intPart.length - 3));
    intPart = intPart.slice(0, intPart.length - 3);
  }
  out.unshift(intPart);
  const body = out.join(',') + (parts.length > 1 ? '.' + parts[1] : '');
  return neg ? '-' + body : body;
}

/** Short number: 1234567 → "1.2M", 2340 → "2.3k". */
export function fmtShort(n: number): string {
  if (!Number.isFinite(n)) {
    return fmt(n);
  }
  const abs = Math.abs(n);
  if (abs >= 1e9) {
    return trim1(n / 1e9) + 'B';
  }
  if (abs >= 1e6) {
    return trim1(n / 1e6) + 'M';
  }
  if (abs >= 1e3) {
    return trim1(n / 1e3) + 'k';
  }
  return fmt(n);
}

function trim1(v: number): string {
  const s = v.toFixed(1);
  return s.endsWith('.0') ? s.slice(0, -2) : s;
}

/** ISO date string → "YYYY-MM-DD" (strip time part if present). */
export function fmtDate(v: string): string {
  if (v.length >= 10) {
    return v.slice(0, 10);
  }
  return v;
}
