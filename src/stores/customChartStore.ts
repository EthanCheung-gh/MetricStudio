import { create } from 'zustand';
import { api } from '@/api/client';
import type {
  CustomChartInvalidEntry,
  CustomChartItem,
  CustomChartManifest,
} from '@/types/customChart';

/**
 * Declarative custom charts, as listed by the backend from
 * `~/.metricstudio/charts/`. Session-scoped (never persisted): the JSON files on
 * disk are the source of truth, so a reload simply re-fetches them.
 */

export type CustomChartSaveResult =
  | { ok: true; id: string; replaced: boolean }
  | { ok: false; message: string };

/**
 * How a workbench session was opened:
 * - `new`       — blank form;
 * - `edit`      — an existing manifest, its id locked;
 * - `duplicate` — an existing manifest with the id cleared, so saving writes a
 *                 new file; the workbench suggests `<id>-copy` as the new id.
 */
export type CustomChartWorkbenchMode = 'new' | 'edit' | 'duplicate';

export interface CustomChartWorkbenchSession {
  mode: CustomChartWorkbenchMode;
  /** Source manifest; `null` for a blank session. */
  seed: CustomChartManifest | null;
  /** Dialog instance that opened the session; only it renders the workbench. */
  owner: string;
  /** Monotonic per open (never reset), so a re-open always remounts the form. */
  serial: number;
}

/**
 * Bumped on every open and never reset: reusing a serial would let a re-opened
 * workbench keep the previous session's form. Session state is `null` while
 * closed, so `workbench !== null` is the single source of truth for "open".
 */
let workbenchSerial = 0;

interface CustomChartState {
  /** Valid manifests, each tagged with the file it came from. */
  items: CustomChartItem[];
  /** Manifest files the backend rejected, with its validation messages. */
  invalid: CustomChartInvalidEntry[];
  loading: boolean;
  /** Last load/save/delete failure, for inline display; never thrown. */
  error: string | null;
  /** True once a list fetch succeeded; `load()` then short-circuits. */
  loaded: boolean;
  /** Authoring session driven by the full-screen workbench; `null` when closed. */
  workbench: CustomChartWorkbenchSession | null;

  /** Idempotent list fetch: safe on mount, never throws, keeps `items` on failure. */
  load: (force?: boolean) => Promise<void>;
  /** POST a manifest and refresh the list so the new type is selectable at once. */
  save: (manifest: CustomChartManifest) => Promise<CustomChartSaveResult>;
  /** Delete a manifest and refresh the list. */
  remove: (id: string) => Promise<boolean>;
  byId: (id: string) => CustomChartItem | undefined;
  clearError: () => void;
  /** Open the workbench on a blank form, an existing manifest, or a copy of it. */
  openWorkbench: (
    owner: string,
    seed?: CustomChartManifest | null,
    mode?: CustomChartWorkbenchMode,
  ) => void;
  closeWorkbench: () => void;
}

/** Shared by every caller so concurrent mounts issue one request. */
let inFlight: Promise<void> | null = null;

function errorMessage(err: unknown): string {
  if (err instanceof Error && err.message.trim() !== '') return err.message;
  if (typeof err === 'string' && err.trim() !== '') return err;
  return 'Unknown error';
}

/** fetchJson prefixes failures with "<status> <text>: <path> — "; the backend's
 *  manifest problems live after that separator and are what the import UI shows. */
function backendDetail(err: unknown): string {
  const message = errorMessage(err);
  const separator = ' — ';
  const index = message.lastIndexOf(separator);
  return index >= 0 ? message.slice(index + separator.length) : message;
}

export const useCustomChartStore = create<CustomChartState>()((set, get) => ({
  items: [],
  invalid: [],
  loading: false,
  error: null,
  loaded: false,
  workbench: null,

  load: (force = false) => {
    if (inFlight) return inFlight;
    if (!force && get().loaded) return Promise.resolve();
    const request = (async () => {
      set({ loading: true });
      try {
        const response = await api.listCustomCharts();
        set({
          items: response?.items ?? [],
          invalid: response?.invalid ?? [],
          error: null,
          loaded: true,
        });
      } catch (err) {
        // A failed reload keeps the previous list: stale charts beat no charts.
        set({ error: errorMessage(err) });
      } finally {
        inFlight = null;
        set({ loading: false });
      }
    })();
    inFlight = request;
    return request;
  },

  save: async (manifest) => {
    try {
      const result = await api.saveCustomChart(manifest);
      set({ error: null });
      await get().load(true);
      return { ok: true, id: result.id, replaced: result.replaced };
    } catch (err) {
      const message = backendDetail(err);
      set({ error: message });
      return { ok: false, message };
    }
  },

  remove: async (id) => {
    try {
      await api.deleteCustomChart(id);
      set({ error: null });
      await get().load(true);
      return true;
    } catch (err) {
      set({ error: backendDetail(err) });
      return false;
    }
  },

  byId: (id) => get().items.find((item) => item.id === id),

  clearError: () => set({ error: null }),

  openWorkbench: (owner, seed = null, mode) => {
    workbenchSerial += 1;
    set({
      workbench: {
        mode: seed === null ? 'new' : (mode ?? 'edit'),
        seed,
        owner,
        serial: workbenchSerial,
      },
    });
  },

  closeWorkbench: () => set({ workbench: null }),
}));

/**
 * Subscribe to a single custom chart id. Returns undefined for built-in ids,
 * unknown ids and while the list is still loading — callers fall back to the
 * built-in registry spec in that case.
 */
export function useCustomChart(id: string): CustomChartItem | undefined {
  return useCustomChartStore((s) => s.items.find((item) => item.id === id));
}
