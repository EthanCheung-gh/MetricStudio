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

describe('dashboard undo/redo', () => {
  function setupWithTextCard() {
    const current = dashboard('dash')
    current.items = [{ chartId: 'text-1', kind: 'text', text: 'v1', x: 0, y: 0, w: 4, h: 2 }]
    useDashboardStore.setState({
      dashboards: [current],
      activeDashboardId: 'dash',
      undoStack: [],
      redoStack: [],
    })
  }

  it('undoes and redoes a tracked mutation', () => {
    setupWithTextCard()
    useDashboardStore.getState().updateItemText('dash', 'text-1', 'v2')

    expect(useDashboardStore.getState().undoStack).toHaveLength(1)
    useDashboardStore.getState().undoDashboard('dash')
    expect(useDashboardStore.getState().dashboards[0].items[0].text).toBe('v1')
    expect(useDashboardStore.getState().redoStack).toHaveLength(1)

    useDashboardStore.getState().redoDashboard('dash')
    expect(useDashboardStore.getState().dashboards[0].items[0].text).toBe('v2')
  })

  it('clears the redo stack on a new tracked change', () => {
    setupWithTextCard()
    useDashboardStore.getState().updateItemText('dash', 'text-1', 'v2')
    useDashboardStore.getState().undoDashboard('dash')
    useDashboardStore.getState().addTextItem('dash', 'new card')

    expect(useDashboardStore.getState().redoStack).toHaveLength(0)
  })

  it('ignores undo for a different dashboard than the snapshot', () => {
    setupWithTextCard()
    useDashboardStore.setState({ dashboards: [useDashboardStore.getState().dashboards[0], dashboard('other')], activeDashboardId: 'other' })

    useDashboardStore.getState().undoDashboard('other')

    expect(useDashboardStore.getState().undoStack).toHaveLength(0)
  })

  it('clears undo stacks when loading dashboards', () => {
    setupWithTextCard()
    useDashboardStore.getState().updateItemText('dash', 'text-1', 'v2')
    useDashboardStore.getState().loadDashboards([dashboard('fresh')])

    expect(useDashboardStore.getState().undoStack).toHaveLength(0)
    expect(useDashboardStore.getState().redoStack).toHaveLength(0)
  })
})

describe('batch layout', () => {
  function item(chartId: string, x: number, y: number) {
    return { chartId, kind: 'text' as const, text: '', x, y, w: 3, h: 2 }
  }

  function lockedItem(chartId: string, x: number, y: number) {
    return { ...item(chartId, x, y), locked: true }
  }

  function setupItems(items: (ReturnType<typeof item> | ReturnType<typeof lockedItem>)[]) {
    const current = dashboard('dash')
    current.items = items
    useDashboardStore.setState({ dashboards: [current], activeDashboardId: 'dash', undoStack: [], redoStack: [] })
  }

  it('aligns unlocked items left while keeping locked items in place', () => {
    setupItems([item('a', 4, 0), item('b', 8, 6), lockedItem('locked', 8, 0)])

    useDashboardStore.getState().alignItems('dash', 'left')

    const items = useDashboardStore.getState().dashboards[0].items
    expect(items.find((i) => i.chartId === 'a')!.x).toBe(4)
    expect(items.find((i) => i.chartId === 'b')!.x).toBe(4)
    expect(items.find((i) => i.chartId === 'locked')!.x).toBe(8)
  })

  it('aligns unlocked items to the top row', () => {
    setupItems([item('a', 0, 3), item('b', 5, 7)])

    useDashboardStore.getState().alignItems('dash', 'top')

    const items = useDashboardStore.getState().dashboards[0].items
    expect(items.every((i) => i.y === 3)).toBe(true)
  })

  it('distributes unlocked items evenly along an axis', () => {
    setupItems([item('a', 0, 0), item('b', 5, 0), item('c', 10, 0)])

    useDashboardStore.getState().spaceItemsEvenly('dash', 'x')

    const xs = useDashboardStore
      .getState()
      .dashboards[0].items.map((i) => i.x)
      .sort((left, right) => left - right)
    expect(xs).toEqual([0, 5, 10])
  })

  it('leaves fewer-than-three items untouched by even spacing', () => {
    setupItems([item('a', 0, 0), item('b', 9, 9)])

    useDashboardStore.getState().spaceItemsEvenly('dash', 'y')

    const ys = useDashboardStore.getState().dashboards[0].items.map((i) => i.y)
    expect(ys).toEqual([0, 9])
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
