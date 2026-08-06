import { useUIStore } from '@/stores/uiStore'

export function NotificationContainer() {
  const notifications = useUIStore((s) => s.notifications)

  return (
    <div className="pointer-events-none fixed right-3 top-12 z-50 flex flex-col gap-2">
      {notifications.map((n) => (
        <div
          key={n.id}
          className={`pointer-events-auto rounded px-3 py-2 text-xs shadow-lg ${
            n.type === 'success'
              ? 'bg-success text-white'
              : n.type === 'error'
                ? 'bg-danger text-white'
                : 'bg-surface-elevated text-foreground border border-border'
          }`}
        >
          {n.message}
        </div>
      ))}
    </div>
  )
}
