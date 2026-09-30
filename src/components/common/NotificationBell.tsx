import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { AlertTriangle, Bell, CheckCircle2, Info, X, XCircle } from 'lucide-react'
import { Button, Tooltip } from '@heroui/react'
import { useUIStore, type NotificationFilter, type NotificationRecord } from '@/stores/uiStore'
import { relativeBucket } from '@/utils/time'

const FILTERS: { value: NotificationFilter; labelKey: string }[] = [
  { value: 'all', labelKey: 'notify.filterAll' },
  { value: 'success', labelKey: 'notify.filterSuccess' },
  { value: 'error', labelKey: 'notify.filterError' },
  { value: 'info', labelKey: 'notify.filterInfo' },
  { value: 'warning', labelKey: 'notify.filterWarning' },
]

function useRelativeLabel(createdAt: number): string {
  const { t } = useTranslation()
  const bucket = relativeBucket(createdAt)
  switch (bucket.kind) {
    case 'justNow':
      return t('notify.justNow')
    case 'minutes':
      return t('notify.minutesAgo', { count: bucket.count })
    case 'hours':
      return t('notify.hoursAgo', { count: bucket.count })
    default:
      return t('notify.daysAgo', { count: bucket.count })
  }
}

function typeIcon(type: NotificationRecord['type']) {
  switch (type) {
    case 'success':
      return <CheckCircle2 className="h-3.5 w-3.5 text-success" />
    case 'error':
      return <XCircle className="h-3.5 w-3.5 text-danger" />
    case 'warning':
      return <AlertTriangle className="h-3.5 w-3.5 text-warning" />
    default:
      return <Info className="h-3.5 w-3.5 text-primary" />
  }
}

function NotificationRow({
  record,
  onRemove,
}: {
  record: NotificationRecord
  onRemove: (id: string) => void
}) {
  const { t } = useTranslation()
  const time = useRelativeLabel(record.createdAt)
  return (
    <div className="flex items-start gap-2 border-b border-border/50 px-3 py-2 last:border-b-0">
      <span className="mt-0.5 shrink-0">{typeIcon(record.type)}</span>
      <div className="min-w-0 flex-1">
        <p className="break-all text-xs leading-snug">{record.message}</p>
        <p className="mt-0.5 text-[10px] text-muted">{time}</p>
      </div>
      <button
        type="button"
        aria-label={t('notify.deleteOne')}
        title={t('notify.deleteOne')}
        onClick={() => onRemove(record.id)}
        className="shrink-0 rounded p-0.5 text-muted hover:bg-surface hover:text-danger"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  )
}

/** Pure presentational panel body — takes data via props so it renders identically
 *  in the app (store-connected) and in static-markup tests. */
export function NotificationPanelBody({
  history,
  filter,
  onFilterChange,
  onRemove,
  onClear,
}: {
  history: NotificationRecord[]
  filter: NotificationFilter
  onFilterChange: (filter: NotificationFilter) => void
  onRemove: (id: string) => void
  onClear: () => void
}) {
  const { t } = useTranslation()
  const filtered = filter === 'all' ? history : history.filter((n) => n.type === filter)

  return (
    <div className="flex w-80 flex-col" data-testid="notify-panel">
      <div className="flex items-center justify-between border-b border-border px-3 py-2">
        <span className="text-xs font-semibold">{t('notify.title')}</span>
        <Button size="sm" variant="light" className="h-6 min-w-0 px-2 text-[10px]" onPress={onClear}>
          {t('notify.clear')}
        </Button>
      </div>

      <div className="flex flex-wrap gap-1 border-b border-border px-2 py-1.5">
        {FILTERS.map((f) => (
          <button
            key={f.value}
            type="button"
            data-filter={f.value}
            onClick={() => onFilterChange(f.value)}
            className={`rounded-full border px-2 py-0.5 text-[10px] transition-colors ${
              filter === f.value
                ? 'border-primary bg-primary text-white'
                : 'border-border text-muted hover:bg-surface'
            }`}
          >
            {t(f.labelKey)}
          </button>
        ))}
      </div>

      <div className="max-h-80 overflow-y-auto">
        {history.length === 0 ? (
          <p className="px-3 py-6 text-center text-xs text-muted">{t('notify.empty')}</p>
        ) : filtered.length === 0 ? (
          <p className="px-3 py-6 text-center text-xs text-muted">{t('notify.emptyFiltered')}</p>
        ) : (
          filtered.map((n) => <NotificationRow key={n.id} record={n} onRemove={onRemove} />)
        )}
      </div>
    </div>
  )
}

/** Presentational unread badge: hidden at 0, capped at 99+. */
export function UnreadBadge({ count }: { count: number }) {
  const { t } = useTranslation()
  if (count <= 0) return null
  return (
    <span
      data-testid="notify-badge"
      aria-label={t('notify.unreadBadge', { count })}
      className="absolute -right-2 -top-1.5 min-w-4 rounded-full bg-danger px-1 text-center text-[9px] font-bold leading-4 text-white"
    >
      {count > 99 ? '99+' : count}
    </span>
  )
}

export function NotificationBell() {
  const { t } = useTranslation()
  const history = useUIStore((s) => s.notificationHistory)
  const filter = useUIStore((s) => s.notificationFilter)
  const unreadCount = useUIStore((s) => s.unreadCount)
  const setFilter = useUIStore((s) => s.setNotificationFilter)
  const removeRecord = useUIStore((s) => s.removeNotificationRecord)
  const clearHistory = useUIStore((s) => s.clearNotificationHistory)
  const markAllRead = useUIStore((s) => s.markAllNotificationsRead)
  const [open, setOpen] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    // Opening the panel consumes the unread badge.
    markAllRead()
    const onPointerDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false)
    }
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    window.addEventListener('mousedown', onPointerDown)
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('mousedown', onPointerDown)
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [open, markAllRead])

  return (
    <div ref={wrapRef} className="relative" data-testid="notify-bell">
      <Tooltip content={t('notify.bellLabel')} placement="bottom">
        <Button
          isIconOnly
          size="sm"
          variant="light"
          aria-label={t('notify.bellLabel')}
          onPress={() => setOpen((v) => !v)}
        >
          <span className="relative">
            <Bell className="h-4 w-4" />
            <UnreadBadge count={unreadCount} />
          </span>
        </Button>
      </Tooltip>

      {open && (
        <div className="absolute right-0 top-full z-50 mt-1 rounded-md border border-border bg-surface-elevated shadow-xl">
          <NotificationPanelBody
            history={history}
            filter={filter}
            onFilterChange={setFilter}
            onRemove={removeRecord}
            onClear={clearHistory}
          />
        </div>
      )}
    </div>
  )
}
