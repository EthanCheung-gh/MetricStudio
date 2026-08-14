import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { DashboardConfig, DashboardFilter, DashboardItem, LayoutTemplate } from '@/types/dashboard'
import type { SelectionFilter } from '@/types/encoding'
import { generateId } from '@/utils/id'

interface DashboardState {
  dashboards: DashboardConfig[]
  activeDashboardId: string | null

  createDashboard: () => DashboardConfig
  removeDashboard: (id: string) => void
  renameDashboard: (id: string, name: string) => void
  setActiveDashboard: (id: string | null) => void
  addItem: (dashboardId: string, chartId: string) => void
  removeItem: (dashboardId: string, chartId: string) => void
  moveItem: (dashboardId: string, chartId: string, x: number, y: number) => void
  resizeItem: (dashboardId: string, chartId: string, w: number, h: number) => void
  addFilter: (dashboardId: string, filter: Omit<DashboardFilter, 'id'>) => void
  updateFilter: (dashboardId: string, filterId: string, patch: Partial<DashboardFilter>) => void
  removeFilter: (dashboardId: string, filterId: string) => void
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

export const useDashboardStore = create<DashboardState>()(
  persist(
    (set, get) => ({
      dashboards: [],
      activeDashboardId: null,

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

      removeDashboard: (id) =>
        set((s) => ({
          dashboards: s.dashboards.filter((d) => d.id !== id),
          activeDashboardId: s.activeDashboardId === id ? null : s.activeDashboardId,
        })),

      renameDashboard: (id, name) =>
        set((s) => ({
          dashboards: touch(s.dashboards, id, (d) => ({ ...d, name, updatedAt: new Date().toISOString() })),
        })),

      setActiveDashboard: (id) => set({ activeDashboardId: id }),

      addItem: (dashboardId, chartId) =>
        set((s) => ({
          dashboards: touch(s.dashboards, dashboardId, (d) => {
            if (d.items.some((i) => i.chartId === chartId)) return d
            const item: DashboardItem = { chartId, x: 0, y: 0, w: 6, h: 4 }
            return { ...d, items: [...d.items, item], updatedAt: new Date().toISOString() }
          }),
        })),

      removeItem: (dashboardId, chartId) =>
        set((s) => ({
          dashboards: touch(s.dashboards, dashboardId, (d) => ({
            ...d,
            items: d.items.filter((i) => i.chartId !== chartId),
            updatedAt: new Date().toISOString(),
          })),
        })),

      moveItem: (dashboardId, chartId, x, y) =>
        set((s) => ({
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

      addFilter: (dashboardId, filter) =>
        set((s) => ({
          dashboards: touch(s.dashboards, dashboardId, (d) => ({
            ...d,
            filters: [...d.filters, { ...filter, id: generateId() }],
            updatedAt: new Date().toISOString(),
          })),
        })),

      updateFilter: (dashboardId, filterId, patch) =>
        set((s) => ({
          dashboards: touch(s.dashboards, dashboardId, (d) => ({
            ...d,
            filters: d.filters.map((f) => (f.id === filterId ? { ...f, ...patch } : f)),
            updatedAt: new Date().toISOString(),
          })),
        })),

      removeFilter: (dashboardId, filterId) =>
        set((s) => ({
          dashboards: touch(s.dashboards, dashboardId, (d) => ({
            ...d,
            filters: d.filters.filter((f) => f.id !== filterId),
            updatedAt: new Date().toISOString(),
          })),
        })),

      loadDashboards: (dashboards) => set({ dashboards }),

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
          const validIds = new Set(dashboard.items.map((i) => i.chartId))
          const items = template.items
            .filter((i) => validIds.has(i.chartId))
            .map((i) => ({ ...i }))
          return {
            dashboards: touch(s.dashboards, dashboardId, (d) => ({
              ...d,
              items,
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
