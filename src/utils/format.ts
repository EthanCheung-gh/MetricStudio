/**
 * Safely format a number for display.
 * Returns "0" for null, undefined, or non-number values.
 */
export function fmt(n: unknown): string {
  if (typeof n !== 'number') return '0'
  return n.toLocaleString()
}
