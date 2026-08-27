import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { DashboardConfig, DashboardFilter, DashboardItem, KpiItemConfig, LayoutTemplate } from '@/types/dashboard'
import type { SelectionFilter } from '@/types/encoding'
import { generateId } from '@/utils/id'

interface DashboardSnapshot {
  dashboardId: string
  items: DashboardItem[]
  filters: DashboardFilter[]
}

type MutateDashboard = (d: DashboardConfig) => DashboardConfig

interface DashboardState {
  dashboards: DashboardConfig[]
  activeDashboardId: string | null
  /** false = view mode: grid interactions and editing chrome are hidden. */
  editMode: boolean
  /** Per-session undo/redo stacks over items+filters of each dashboard. */
  undoStack: DashboardSnapshot[]
  redoStack: DashboardSnapshot[]
  /** Internal helper capturing a snapshot before applying a mutation. */
  __recordAndApply: (dashboardId: string, mutate: MutateDashboard) => void

  setEditMode: (open: boolean) => void
  undoDashboard: (dashboardId: string) => void
  redoDashboard: (dashboardId: string) => void
  createDashboard: () => DashboardConfig
  duplicateDashboard: (id: string) => DashboardConfig | null
  removeDashboard: (id: string) => void
  renameDashboard: (id: string, name: string) => void
  setActiveDashboard: (id: string | null) => void
  addItem: (dashboardId: string, chartId: string) => void
  addKpiItem: (dashboardId: string, kpi: KpiItemConfig) => void
  addTextItem: (dashboardId: string, text?: string) => void
  updateItemText: (dashboardId: string, itemId: string, text: string) => void
  updateItemKpi: (dashboardId: string, itemId: string, kpi: Partial<KpiItemConfig>) => void
  toggleItemLock: (dashboardId: string, itemId: string) => void
  removeItem: (dashboardId: string, chartId: string) => void
  moveItem: (dashboardId: string, chartId: string, x: number, y: number) => void
  resizeItem: (dashboardId: string, chartId: string, w: number, h: number) => void
  /** Batch layout ops: left/top alignment and even horizontal/vertical spacing. */
  alignItems: (dashboardId: string, direction: 'left' | 'top') => void
  spaceItemsEvenly: (dashboardId: string, axis: 'x' | 'y') => void
  addFilter: (dashboardId: string, filter: Omit<DashboardFilter, 'id'>) => void
  updateFilter: (dashboardId: string, filterId: string, patch: Partial<DashboardFilter>) => void
  removeFilter: (dashboardId: string, filterId: string) => void
  clearAllFilters: (dashboardId: string) => void
  loadDashboards: (dashboards: DashboardConfig[]) => void
  brushSelections: Record<string, Record<string, SelectionFilter>>
  setBrushSelection: (dashboardId: string, chartId: string, sel: SelectionFilter) => void
  clearBrushSelection: (dashboardId: string, chartId: string) => void
  clearAllBrushes: (dashboardId: string) => void
  layoutTemplates: LayoutTemplate[]
  saveLayoutTemplate: (dashboardId: string, name: string) => void
  applyLayoutTemplate: (dashboardId: string, templateId: string) => void
  removeLayoutTemplate: (templateId: string) => void
}

function touch(
  list: DashboardConfig[],
  id: string,
  fn: (d: DashboardConfig) => DashboardConfig,
): DashboardConfig[] {
  return list.map((d) => (d.id === id ? fn(d) : d))
}

const UNDO_LIMIT = 50

export const useDashboardStore = create<DashboardState>()(
  persist(
    (set, get) => ({
      dashboards: [],
      activeDashboardId: null,
      editMode: true,
      undoStack: [],
      redoStack: [],

      setEditMode: (open) => set({ editMode: open }),

      // Every mutating action runs through this helper: snapshot the current
      // items+filters, apply the change, and push the snapshot for undo.
      __recordAndApply: (dashboardId, mutate) => {
        const source = get().dashboards.find((d) => d.id === dashboardId)
        if (!source) return
        const snapshot: DashboardSnapshot = {
          dashboardId,
          items: source.items.map((i) => ({ ...i })),
          filters: source.filters.map((f) => ({ ...f })),
        }
        set((s) => ({
          dashboards: touch(s.dashboards, dashboardId, (d) => {
            const next = mutate(d)
            return { ...next, updatedAt: new Date().toISOString() }
          }),
          undoStack: [...s.undoStack.slice(-UNDO_LIMIT + 1), snapshot],
          redoStack: [],
        }))
      },

      undoDashboard: (dashboardId) => {
        const stack = get().undoStack
        const last = stack[stack.length - 1]
        if (!last || last.dashboardId !== dashboardId) return
        const current = get().dashboards.find((d) => d.id === dashboardId)
        if (!current) return
        const redoSnapshot: DashboardSnapshot = {
          dashboardId,
          items: current.items.map((i) => ({ ...i })),
          filters: current.filters.map((f) => ({ ...f })),
        }
        set((s) => ({
          dashboards: touch(s.dashboards, dashboardId, (d) => ({
            ...d,
            items: last.items.map((i) => ({ ...i })),
            filters: last.filters,
            updatedAt: new Date().toISOString(),
          })),
          undoStack: s.undoStack.slice(0, -1),
          redoStack: [...s.redoStack, redoSnapshot],
        }))
      },

      redoDashboard: (dashboardId) => {
        const stack = get().redoStack
        const nextSnap = stack[stack.length - 1]
        if (!nextSnap || nextSnap.dashboardId !== dashboardId) return
        const current = get().dashboards.find((d) => d.id === dashboardId)
        if (!current) return
        const undoSnapshot: DashboardSnapshot = {
          dashboardId,
          items: current.items.map((i) => ({ ...i })),
          filters: current.filters.map((f) => ({ ...f })),
        }
        set((s) => ({
          dashboards: touch(s.dashboards, dashboardId, (d) => ({
            ...d,
            items: nextSnap.items.map((i) => ({ ...i })),
            filters: nextSnap.filters,
            updatedAt: new Date().toISOString(),
          })),
          redoStack: s.redoStack.slice(0, -1),
          undoStack: [...s.undoStack, undoSnapshot],
        }))
      },

      createDashboard: () => {
        const now = new Date().toISOString()
        const dashboard: DashboardConfig = {
          id: generateId(),
          name: `Dashboard ${get().dashboards.length + 1}`,
          items: [],
          filters: [],
          cols: 12,
          rowHeight: 80,
          createdAt: now,
          updatedAt: now,
        }
        set((s) => ({ dashboards: [...s.dashboards, dashboard], activeDashboardId: dashboard.id }))
        return dashboard
      },

      duplicateDashboard: (id) => {
        const source = get().dashboards.find((d) => d.id === id)
        if (!source) return null
        const now = new Date().toISOString()
        // Text and KPI cards are deep-copied with new ids so both dashboards
        // stay independent; chart items keep their chartId (charts are global).
        const copySuffix = () => (item: DashboardItem): DashboardItem => {
          if (item.kind === undefined) return { ...item }
          return { ...item, chartId: generateId() }
        }
        const copiedName = `${source.name} ${get().dashboards.filter((d) => d.name.startsWith(source.name)).length + 1}`
        const dashboard: DashboardConfig = {
          ...source,
          id: generateId(),
          name: copiedName.slice(0, 120),
          items: source.items.map((item) => copySuffix()(item)),
          createdAt: now,
          updatedAt: now,
        }
        set((s) => ({ dashboards: [...s.dashboards, dashboard], activeDashboardId: dashboard.id }))
        return dashboard
      },

      removeDashboard: (id) =>
        set((s) => {
          const dashboards = s.dashboards.filter((d) => d.id !== id)
          return {
            dashboards,
            activeDashboardId: s.activeDashboardId === id ? (dashboards[0]?.id ?? null) : s.activeDashboardId,
            brushSelections: Object.fromEntries(
              Object.entries(s.brushSelections).filter(([dashboardId]) => dashboardId !== id),
            ),
          }
        }),

      renameDashboard: (id, name) =>
        set((s) => ({
          dashboards: touch(s.dashboards, id, (d) => ({ ...d, name, updatedAt: new Date().toISOString() })),
        })),

      setActiveDashboard: (id) => set({ activeDashboardId: id }),

      addItem: (dashboardId, chartId) =>
        get().__recordAndApply(dashboardId, (d) => {
          if (d.items.some((i) => i.chartId === chartId)) return d
          const item: DashboardItem = { chartId, x: 0, y: 0, w: 6, h: 4 }
          return { ...d, items: [...d.items, item] }
        }),

      addKpiItem: (dashboardId, kpi) =>
        get().__recordAndApply(dashboardId, (d) => ({
          ...d,
          items: [...d.items, { chartId: generateId(), kind: 'kpi', kpi, x: 0, y: 0, w: 3, h: 2 }],
        })),

      addTextItem: (dashboardId, text = '') =>
        get().__recordAndApply(dashboardId, (d) => ({
          ...d,
          items: [...d.items, { chartId: generateId(), kind: 'text', text, x: 0, y: 0, w: 4, h: 2 }],
        })),

      updateItemText: (dashboardId, itemId, text) =>
        get().__recordAndApply(dashboardId, (d) => ({
          ...d,
          items: d.items.map((i) => (i.chartId === itemId ? { ...i, text } : i)),
        })),

      updateItemKpi: (dashboardId, itemId, kpi) =>
        get().__recordAndApply(dashboardId, (d) => ({
          ...d,
          items: d.items.map((i) =>
            i.chartId === itemId && i.kpi ? { ...i, kpi: { ...i.kpi, ...kpi } } : i,
          ),
        })),

      toggleItemLock: (dashboardId, itemId) =>
        get().__recordAndApply(dashboardId, (d) => ({
          ...d,
          items: d.items.map((i) => (i.chartId === itemId ? { ...i, locked: !i.locked } : i)),
        })),

      removeItem: (dashboardId, chartId) =>
        get().__recordAndApply(dashboardId, (d) => ({
          ...d,
          items: d.items.filter((i) => i.chartId !== chartId),
        })),

      moveItem: (dashboardId, chartId, x, y) =>
        set((s) => ({
          // Continuous drag updates: mutate without flooding the undo stack;
          // the drag end is finalized via batch actions / explicit snapshots.
          dashboards: touch(s.dashboards, dashboardId, (d) => ({
            ...d,
            items: d.items.map((i) => (i.chartId === chartId ? { ...i, x, y } : i)),
            updatedAt: new Date().toISOString(),
          })),
        })),

      resizeItem: (dashboardId, chartId, w, h) =>
        set((s) => ({
          dashboards: touch(s.dashboards, dashboardId, (d) => ({
            ...d,
            items: d.items.map((i) => (i.chartId === chartId ? { ...i, w, h } : i)),
            updatedAt: new Date().toISOString(),
          })),
        })),

      alignItems: (dashboardId, direction) =>
        get().__recordAndApply(dashboardId, (d) => {
          const unlocked = d.items.filter((i) => !i.locked)
          if (unlocked.length < 2) return d
          const target = Math.min(...unlocked.map((i) => (direction === 'left' ? i.x : i.y)))
          return {
            ...d,
            items: d.items.map((i) =>
              !i.locked ? (direction === 'left' ? { ...i, x: target } : { ...i, y: target }) : i,
            ),
          }
        }),

      spaceItemsEvenly: (dashboardId, axis) =>
        get().__recordAndApply(dashboardId, (d) => {
          const unlocked = d.items.filter((i) => !i.locked)
          if (unlocked.length < 3) return d
          const sorted = [...unlocked].sort((a, b) => (axis === 'x' ? a.x - b.x : a.y - b.y))
          const first = sorted[0]
          const lastItem = sorted[sorted.length - 1]
          const start = axis === 'x' ? first.x : first.y
          const end = axis === 'x' ? lastItem.x : lastItem.y
          const gap = (end - start) / (sorted.length - 1)
          const positions = new Map<string, number>()
          sorted.forEach((item, index) => positions.set(item.chartId, Math.round(start + gap * index)))
          return {
            ...d,
            items: d.items.map((i) =>
              positions.has(i.chartId)
                ? axis === 'x'
                  ? { ...i, x: positions.get(i.chartId)! }
                  : { ...i, y: positions.get(i.chartId)! }
                : i,
            ),
          }
        }),

      addFilter: (dashboardId, filter) =>
        get().__recordAndApply(dashboardId, (d) => ({
          ...d,
          filters: [...d.filters, { ...filter, id: generateId() }],
        })),

      removeFilter: (dashboardId, filterId) =>
        get().__recordAndApply(dashboardId, (d) => ({
          ...d,
          filters: d.filters.filter((f) => f.id !== filterId),
        })),

      // Filter value edits are interaction-level tweaks, not layout changes;
      // they stay outside the undo stack.
      updateFilter: (dashboardId, filterId, patch) =>
        set((s) => ({
          dashboards: touch(s.dashboards, dashboardId, (d) => ({
            ...d,
            filters: d.filters.map((f) => (f.id === filterId ? { ...f, ...patch } : f)),
            updatedAt: new Date().toISOString(),
          })),
        })),

      clearAllFilters: (dashboardId) =>
        set((s) => ({
          dashboards: touch(s.dashboards, dashboardId, (d) => ({
            ...d,
            filters: d.filters.map((f) => ({ ...f, value: null })),
            updatedAt: new Date().toISOString(),
          })),
        })),

      loadDashboards: (dashboards) =>
        set({ dashboards, activeDashboardId: dashboards[0]?.id ?? null, brushSelections: {}, undoStack: [], redoStack: [] }),

      brushSelections: {},

      setBrushSelection: (dashboardId, chartId, sel) =>
        set((s) => ({
          brushSelections: {
            ...s.brushSelections,
            [dashboardId]: { ...(s.brushSelections[dashboardId] || {}), [chartId]: sel },
          },
        })),

      clearBrushSelection: (dashboardId, chartId) =>
        set((s) => {
          const next = { ...(s.brushSelections[dashboardId] || {}) }
          delete next[chartId]
          return { brushSelections: { ...s.brushSelections, [dashboardId]: next } }
        }),

      clearAllBrushes: (dashboardId) =>
        set((s) => ({ brushSelections: { ...s.brushSelections, [dashboardId]: {} } })),

      layoutTemplates: [],

      saveLayoutTemplate: (dashboardId, name) =>
        set((s) => {
          const dashboard = s.dashboards.find((d) => d.id === dashboardId)
          if (!dashboard) return s
          const template: LayoutTemplate = {
            id: generateId(),
            name,
            items: dashboard.items.map((i) => ({ ...i })),
            createdAt: new Date().toISOString(),
          }
          return { layoutTemplates: [...s.layoutTemplates, template] }
        }),

      applyLayoutTemplate: (dashboardId, templateId) =>
        set((s) => {
          const template = s.layoutTemplates.find((t) => t.id === templateId)
          if (!template) return s
          const dashboard = s.dashboards.find((d) => d.id === dashboardId)
          if (!dashboard) return s
          const templateItems = new Map(template.items.map((item) => [item.chartId, item]))
          return {
            dashboards: touch(s.dashboards, dashboardId, (d) => ({
              ...d,
              items: d.items.map((item) => {
                const saved = templateItems.get(item.chartId)
                return saved ? { ...item, x: saved.x, y: saved.y, w: saved.w, h: saved.h } : item
              }),
              updatedAt: new Date().toISOString(),
            })),
          }
        }),

      removeLayoutTemplate: (templateId) =>
        set((s) => ({ layoutTemplates: s.layoutTemplates.filter((t) => t.id !== templateId) })),
    }),
    {
      name: 'metricstudio-dashboards',
      partialize: (s) => ({ dashboards: s.dashboards, layoutTemplates: s.layoutTemplates }),
    },
  ),
)
