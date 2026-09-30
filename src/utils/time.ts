/** Coarse relative-time bucket for notification timestamps (v1.12.0).
 *  Kept pure (no i18n) so labels can be composed and tested separately. */
export type RelativeBucket =
  | { kind: 'justNow' }
  | { kind: 'minutes'; count: number }
  | { kind: 'hours'; count: number }
  | { kind: 'days'; count: number }

export function relativeBucket(createdAt: number, now: number = Date.now()): RelativeBucket {
  const seconds = Math.max(0, Math.floor((now - createdAt) / 1000))
  if (seconds < 60) return { kind: 'justNow' }
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return { kind: 'minutes', count: minutes }
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return { kind: 'hours', count: hours }
  return { kind: 'days', count: Math.floor(hours / 24) }
}
