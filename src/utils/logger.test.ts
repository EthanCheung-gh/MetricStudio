import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  entries,
  error,
  flush,
  info,
  initLogger,
  newId,
  newTraceId,
  setSessionId,
  setTurnId,
} from './logger';

describe('SPA logger (v1.8.0)', () => {
  beforeEach(() => {
    entries().slice(0, entries().length); // clear via splice below
    (entries() as unknown as unknown[]).length = 0;
    vi.restoreAllMocks();
    initLogger();
  });

  it('records protocol-shaped entries', () => {
    setSessionId('sess-1');
    setTurnId('turn-9');
    newTraceId();
    info('ask_submitted', 'qa', undefined, { question: '多少行' });
    const last = entries()[entries().length - 1];
    expect(last.event).toBe('ask_submitted');
    expect(last.span).toBe('qa');
    expect(last.level).toBe('info');
    expect(last.session_id).toBe('sess-1');
    expect(last.turn_id).toBe('turn-9');
    expect(last.trace_id).toMatch(/^[0-9a-f]{16}$/);
    expect(typeof last.ts).toBe('string');
  });

  it('caps the ring buffer at 500 entries', () => {
    for (let i = 0; i < 520; i += 1) info('bulk_event', 'test');
    expect(entries().length).toBeLessThanOrEqual(500);
    expect(entries()[entries().length - 1].event).toBe('bulk_event');
  });

  // Node test env has no `window`; initLogger's listeners are exercised in the
  // real browser build (window_error capture is verified there).
  const itInBrowser = typeof window !== 'undefined' ? it : it.skip;

  itInBrowser('captures window errors automatically', () => {
    const event = new ErrorEvent('error', { message: 'boom at line 1' });
    window.dispatchEvent(event);
    const last = entries()[entries().length - 1];
    expect(last.event).toBe('window_error');
    expect(last.level).toBe('error');
  });

  it('initLogger is safe without a window (node env)', () => {
    expect(() => initLogger()).not.toThrow();
    expect(entries().length).toBeGreaterThanOrEqual(0);
  });

  it('flush posts the batch and clears the ring', async () => {
    const post = vi.fn(() => Promise.resolve(new Response(JSON.stringify({ accepted: 1 }), { status: 200 })));
    vi.stubGlobal('fetch', post);
    info('flush_me', 'test');
    expect(entries().length).toBeGreaterThan(0);
    await flush('');
    expect(post).toHaveBeenCalled();
    expect(entries().length).toBe(0);
    vi.unstubAllGlobals();
  });

  it('flush swallows network failures', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('down'))));
    error('will_be_dropped', 'test');
    await expect(flush('')).resolves.toBeUndefined();
    vi.unstubAllGlobals();
  });

  it('newId yields 16 hex chars', () => {
    expect(newId()).toMatch(/^[0-9a-f]{16}$/);
  });
});
