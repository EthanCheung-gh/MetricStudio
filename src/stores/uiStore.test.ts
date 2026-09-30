import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useUIStore, type NotificationRecord } from './uiStore'

function record(id: string, type: NotificationRecord['type'] = 'info', ageMs = 0): NotificationRecord {
  return { id, type, message: `msg-${id}`, createdAt: Date.now() - ageMs }
}

beforeEach(() => {
  vi.useRealTimers()
  useUIStore.setState({
    notifications: [],
    notificationHistory: [],
    unreadCount: 0,
    notificationFilter: 'all',
  })
})

describe('notification history (v1.12.0)', () => {
  it('records every toast into the history with a timestamp', () => {
    useUIStore.getState().addNotification('error', 'boom')

    const state = useUIStore.getState()
    expect(state.notifications).toHaveLength(1)
    expect(state.notificationHistory).toHaveLength(1)
    expect(state.notificationHistory[0]).toMatchObject({ type: 'error', message: 'boom' })
    expect(state.notificationHistory[0].createdAt).toBeGreaterThan(0)
    expect(state.unreadCount).toBe(1)
  })

  it('keeps the newest record first and caps the history at 100', () => {
    for (let i = 1; i <= 102; i++) {
      useUIStore.getState().addNotification('info', `m${i}`)
    }

    const history = useUIStore.getState().notificationHistory
    expect(history).toHaveLength(100)
    expect(history[0].message).toBe('m102')
    expect(history[history.length - 1].message).toBe('m3')
  })

  it('auto-dismisses toasts after 4s without touching the history', () => {
    vi.useFakeTimers()
    useUIStore.getState().addNotification('info', 'temp')

    expect(useUIStore.getState().notifications).toHaveLength(1)
    vi.advanceTimersByTime(4000)
    expect(useUIStore.getState().notifications).toHaveLength(0)
    expect(useUIStore.getState().notificationHistory).toHaveLength(1)
  })

  it('removes a single record', () => {
    useUIStore.setState({
      notificationHistory: [record('a'), record('b'), record('c')],
    })

    useUIStore.getState().removeNotificationRecord('b')

    expect(useUIStore.getState().notificationHistory.map((n) => n.id)).toEqual(['a', 'c'])
  })

  it('clears the whole history but keeps the filter untouched', () => {
    useUIStore.setState({
      notificationHistory: [record('a'), record('b')],
      notificationFilter: 'error',
    })

    useUIStore.getState().clearNotificationHistory()

    expect(useUIStore.getState().notificationHistory).toEqual([])
    expect(useUIStore.getState().notificationFilter).toBe('error')
  })

  it('markAllNotificationsRead resets unread while keeping the history', () => {
    useUIStore.getState().addNotification('success', 'one')
    useUIStore.getState().addNotification('warning', 'two')
    expect(useUIStore.getState().unreadCount).toBe(2)

    useUIStore.getState().markAllNotificationsRead()

    const state = useUIStore.getState()
    expect(state.unreadCount).toBe(0)
    expect(state.notificationHistory).toHaveLength(2)
  })

  it('switches the panel filter', () => {
    useUIStore.getState().setNotificationFilter('error')
    expect(useUIStore.getState().notificationFilter).toBe('error')

    useUIStore.getState().setNotificationFilter('all')
    expect(useUIStore.getState().notificationFilter).toBe('all')
  })
})
