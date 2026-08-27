import { beforeEach, describe, expect, it } from 'vitest'
import type { DashboardConfig, LayoutTemplate } from '@/types/dashboard'
import { useDashboardStore } from './dashboardStore'

function dashboard(id: string, name = id): DashboardConfig {
  return {
    id,
    name,
    items: [],
    filters: [],
    cols: 12,
    rowHeight: 80,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  }
}

beforeEach(() => {
  useDashboardStore.setState({
    dashboards: [],
    activeDashboardId: null,
    brushSelections: {},
    layoutTemplates: [],
    editMode: true,
  })
})

describe('dashboard lifecycle', () => {
  it('selects the first remaining dashboard after deleting the active one', () => {
    useDashboardStore.setState({
      dashboards: [dashboard('one'), dashboard('two')],
      activeDashboardId: 'one',
      brushSelections: { one: { chart: { xField: 'x', xRange: [1, 2] } } },
    })

    useDashboardStore.getState().removeDashboard('one')

    const state = useDashboardStore.getState()
    expect(state.dashboards.map((item) => item.id)).toEqual(['two'])
    expect(state.activeDashboardId).toBe('two')
    expect(state.brushSelections.one).toBeUndefined()
  })

  it('adds supplied answer text to a Dashboard text card', () => {
    useDashboardStore.setState({ dashboards: [dashboard('dash')], activeDashboardId: 'dash' })

    useDashboardStore.getState().addTextItem('dash', 'Question\n\nAnswer')

    expect(useDashboardStore.getState().dashboards[0].items).toContainEqual(
      expect.objectContaining({ kind: 'text', text: 'Question\n\nAnswer' }),
    )
  })

  it('toggles the locked flag of a card', () => {
    const current = dashboard('dash')
    current.items = [{ chartId: 'text-1', kind: 'text', text: 'hi', x: 0, y: 0, w: 4, h: 2 }]
    useDashboardStore.setState({ dashboards: [current], activeDashboardId: 'dash' })

    useDashboardStore.getState().toggleItemLock('dash', 'text-1')
    expect(useDashboardStore.getState().dashboards[0].items[0].locked).toBe(true)

    useDashboardStore.getState().toggleItemLock('dash', 'text-1')
    expect(useDashboardStore.getState().dashboards[0].items[0].locked).toBe(false)
  })

  it('duplicates a dashboard with independent kpi/text cards and shared chart ids', () => {
    const source = dashboard('source', 'Sales')
    source.items = [
      { chartId: 'chart-1', x: 0, y: 0, w: 6, h: 4 },
      { chartId: 'text-1', kind: 'text', text: 'note', x: 6, y: 0, w: 3, h: 2 },
      { chartId: 'kpi-1', kind: 'kpi', kpi: { datasetId: 'ds', field: 'f', aggregate: 'sum' }, x: 9, y: 0, w: 3, h: 2 },
    ]
    useDashboardStore.setState({ dashboards: [source], activeDashboardId: 'source' })

    const copy = useDashboardStore.getState().duplicateDashboard('source')

    expect(copy).not.toBeNull()
    const state = useDashboardStore.getState()
    expect(state.dashboards).toHaveLength(2)
    expect(state.activeDashboardId).toBe(copy!.id)
    expect(state.dashboards[1].name).toContain('Sales')
    expect(state.dashboards[1].items).toHaveLength(3)
    // Chart items share the same global chart id…
    expect(state.dashboards[1].items.find((i) => i.kind === undefined)?.chartId).toBe('chart-1')
    // …while text/kpi cards get fresh ids but keep content.
    const copiedText = state.dashboards[1].items.find((i) => i.kind === 'text')!
    expect(copiedText.chartId).not.toBe('text-1')
    expect(copiedText.text).toBe('note')
    expect(state.dashboards[0].items.map((i) => i.chartId)).toEqual(['chart-1', 'text-1', 'kpi-1'])
  })

  it('toggles edit mode off and on', () => {
    useDashboardStore.setState({ editMode: true })
    useDashboardStore.getState().setEditMode(false)
    expect(useDashboardStore.getState().editMode).toBe(false)
    useDashboardStore.getState().setEditMode(true)
    expect(useDashboardStore.getState().editMode).toBe(true)
  })

  it('resets the active dashboard and brushes when loading a project', () => {
    useDashboardStore.setState({
      dashboards: [dashboard('old')],
      activeDashboardId: 'old',
      brushSelections: { old: { chart: { xField: 'x', xRange: [1, 2] } } },
    })

    useDashboardStore.getState().loadDashboards([dashboard('loaded')])

    expect(useDashboardStore.getState().activeDashboardId).toBe('loaded')
    expect(useDashboardStore.getState().brushSelections).toEqual({})
  })
})

describe('layout templates', () => {
  it('updates matching geometry without dropping unmatched cards', () => {
    const current = dashboard('dash')
    current.items = [
      { chartId: 'chart', x: 0, y: 0, w: 4, h: 3 },
      { chartId: 'text', kind: 'text', text: 'Keep me', x: 6, y: 0, w: 3, h: 2 },
    ]
    const template: LayoutTemplate = {
      id: 'layout',
      name: 'Saved',
      createdAt: '2026-01-01T00:00:00.000Z',
      items: [
        { chartId: 'chart', x: 2, y: 4, w: 8, h: 5 },
        { chartId: 'missing', x: 0, y: 0, w: 1, h: 1 },
      ],
    }
    useDashboardStore.setState({ dashboards: [current], activeDashboardId: 'dash', layoutTemplates: [template] })

    useDashboardStore.getState().applyLayoutTemplate('dash', 'layout')

    const items = useDashboardStore.getState().dashboards[0].items
    expect(items).toHaveLength(2)
    expect(items[0]).toMatchObject({ chartId: 'chart', x: 2, y: 4, w: 8, h: 5 })
    expect(items[1]).toMatchObject({ chartId: 'text', text: 'Keep me', x: 6, y: 0, w: 3, h: 2 })
  })
})
