import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { NotificationPanelBody, UnreadBadge } from './NotificationBell'
import { relativeBucket } from '@/utils/time'
import type { NotificationFilter, NotificationRecord } from '@/stores/uiStore'
import '@/i18n'

function record(
  id: string,
  type: NotificationRecord['type'] = 'info',
  ageMs = 0,
  message = `msg-${id}`,
): NotificationRecord {
  return { id, type, message, createdAt: Date.now() - ageMs }
}

const noop = () => {}

function panel(history: NotificationRecord[], filter: NotificationFilter = 'all') {
  return renderToStaticMarkup(
    <NotificationPanelBody
      history={history}
      filter={filter}
      onFilterChange={noop}
      onRemove={noop}
      onClear={noop}
    />,
  )
}

describe('relativeBucket', () => {
  const now = Date.now()

  it('buckets by just-now / minutes / hours / days', () => {
    expect(relativeBucket(now - 10_000, now)).toEqual({ kind: 'justNow' })
    expect(relativeBucket(now - 5 * 60_000, now)).toEqual({ kind: 'minutes', count: 5 })
    expect(relativeBucket(now - 3 * 3_600_000, now)).toEqual({ kind: 'hours', count: 3 })
    expect(relativeBucket(now - 2 * 86_400_000, now)).toEqual({ kind: 'days', count: 2 })
  })

  it('never returns negative buckets for future timestamps', () => {
    expect(relativeBucket(now + 60_000, now)).toEqual({ kind: 'justNow' })
  })
})

describe('UnreadBadge', () => {
  it('shows the count', () => {
    expect(renderToStaticMarkup(<UnreadBadge count={5} />)).toContain('>5<')
  })

  it('hides at zero', () => {
    expect(renderToStaticMarkup(<UnreadBadge count={0} />)).toBe('')
  })

  it('caps at 99+', () => {
    expect(renderToStaticMarkup(<UnreadBadge count={120} />)).toContain('>99+<')
  })
})

describe('NotificationPanelBody', () => {
  it('renders records with message, relative time and per-item delete', () => {
    const html = panel([
      record('a', 'error', 90_000, 'Import failed'),
      record('b', 'success', 0),
    ])
    expect(html).toContain('Import failed')
    expect(html).toContain('msg-b')
    expect(html).toContain('1 分钟前')
    expect(html).toContain('刚刚')
    expect(html).toContain('aria-label="删除该条通知"')
  })

  it('renders the five type filters and highlights the active one', () => {
    const html = panel([record('a')], 'error')
    expect(html).toContain('data-filter="all"')
    expect(html).toContain('data-filter="success"')
    expect(html).toContain('data-filter="error"')
    expect(html).toContain('data-filter="info"')
    expect(html).toContain('data-filter="warning"')
    // The active filter chip carries the primary background.
    expect(html).toMatch(/data-filter="error"[^>]*border-primary bg-primary/)
  })

  it('filters the list by type', () => {
    const html = panel([record('a', 'error', 0, 'boom'), record('b', 'success', 0)], 'error')
    expect(html).toContain('boom')
    expect(html).not.toContain('msg-b')
  })

  it('shows the empty state and the filtered-empty state distinctly', () => {
    expect(panel([])).toContain('暂无通知记录')
    expect(panel([record('a', 'success')], 'error')).toContain('当前筛选下没有通知')
  })
})
