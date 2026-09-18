/**
 * SPA-side logger speaking the same JSONL protocol as the backend (v1.8.0).
 *
 * Protocol is the portable asset: identical field names so desktop files and
 * the future HarmonyOS (ArkWeb) sink join the same grep/jq workflow.
 *
 * - Records go to an in-memory ring buffer (last 500), mirrored to the
 *   console when debug level is requested.
 * - Errors (window.onerror / unhandledrejection) are captured automatically.
 * - Batches are flushed to POST /api/v1/logs/client on page hide and when
 *   the buffer crosses a threshold; failures are silently dropped.
 */

export type LogLevel = 'debug' | 'info' | 'warning' | 'error';

export interface LogEntry {
  ts: string;
  level: LogLevel;
  event: string;
  span: string;
  trace_id?: string;
  session_id?: string;
  turn_id?: string;
  msg?: string;
  [field: string]: unknown;
}

const RING_CAPACITY = 500;
const FLUSH_THRESHOLD = 50;

const ring: LogEntry[] = [];
let traceId: string | null = null;
let sessionId: string | null | undefined = null;
let turnId: string | null | undefined = null;
let consoleMirror = false;

/** New correlation id per app boot (overridden per QA turn by the caller). */
export function initLogger(): void {
  traceId = newId();
  if (typeof window !== 'undefined') {
    window.addEventListener('error', (event) => {
      error('window_error', 'global', event.message, {
        source: event.filename,
        line: event.lineno,
      });
    });
    window.addEventListener('unhandledrejection', (event) => {
      error('unhandled_rejection', 'global', String(event.reason));
    });
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') void flush();
    });
  }
}

export function newId(): string {
  const bytes = new Uint8Array(8);
  (globalThis.crypto ?? { getRandomValues: () => bytes }).getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

export function setConsoleMirror(enabled: boolean): void {
  consoleMirror = enabled;
}

export function getTraceId(): string | null {
  return traceId;
}

export function newTraceId(): string {
  traceId = newId();
  return traceId;
}

export function getSessionId(): string | null {
  return sessionId ?? null;
}

export function setSessionId(id: string | null): void {
  sessionId = id ?? undefined;
}

export function setTurnId(id: string | null): void {
  turnId = id ?? undefined;
}

export function entries(): readonly LogEntry[] {
  return ring;
}

export function log(
  level: LogLevel,
  event: string,
  span = 'app',
  msg?: string,
  fields?: Record<string, unknown>,
): void {
  const entry: LogEntry = {
    ts: new Date().toISOString(),
    level,
    event,
    span,
    ...(traceId ? { trace_id: traceId } : {}),
    ...(sessionId ? { session_id: sessionId } : {}),
    ...(turnId ? { turn_id: turnId } : {}),
    ...(msg !== undefined ? { msg } : {}),
    ...fields,
  };
  ring.push(entry);
  if (ring.length > RING_CAPACITY) ring.shift();
  if (consoleMirror) {
    const method = level === 'error' ? 'error' : level === 'warning' ? 'warn' : 'log';
    // eslint-disable-next-line no-console
    console[method](`[${span}] ${event}`, fields ?? '');
  }
  if (ring.length >= FLUSH_THRESHOLD) void flush();
}

export const debug = (event: string, span?: string, msg?: string, fields?: Record<string, unknown>) =>
  log('debug', event, span, msg, fields);
export const info = (event: string, span?: string, msg?: string, fields?: Record<string, unknown>) =>
  log('info', event, span, msg, fields);
export const warning = (event: string, span?: string, msg?: string, fields?: Record<string, unknown>) =>
  log('warning', event, span, msg, fields);
export const error = (event: string, span?: string, msg?: string, fields?: Record<string, unknown>) =>
  log('error', event, span, msg, fields);

/** Fire-and-forget batch upload; never throws into the caller's flow. */
export async function flush(baseUrl?: string): Promise<void> {
  if (ring.length === 0) return;
  const batch = ring.splice(0, ring.length);
  const root = baseUrl ?? (globalThis as { __MS_BASE__?: string }).__MS_BASE__ ?? '';
  try {
    await fetch(`${root}/api/v1/logs/client`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ entries: batch }),
      keepalive: true,
    });
  } catch {
    // Backend unreachable — drop the batch; the ring keeps recording.
  }
}
