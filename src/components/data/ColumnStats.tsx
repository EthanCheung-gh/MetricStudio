import { useDataStore } from '@/stores/dataStore'
import { Card, CardBody, Chip } from '@heroui/react'

export function ColumnStats() {
  const columns = useDataStore((s) => s.columns)
  const describe = useDataStore((s) => s.describe)

  return (
    <Card className="bg-surface-elevated border-border">
      <CardBody className="gap-2">
        <div className="text-xs font-semibold text-muted">Columns</div>
        {columns.length === 0 && (
          <p className="text-xs text-muted">No dataset selected.</p>
        )}
        <div className="flex max-h-64 flex-col gap-1 overflow-auto">
          {columns.map((col) => {
            const stats = describe?.stats[col.name]
            return (
              <div
                key={col.name}
                className="rounded border border-border p-2 text-xs"
              >
                <div className="flex items-center justify-between">
                  <span className="font-medium truncate">{col.name}</span>
                  <Chip size="sm" variant="flat" className="text-[10px] h-4">
                    {col.inferredType}
                  </Chip>
                </div>
                <div className="mt-1 text-muted">
                  {col.dtype} · {col.uniqueCount} unique
                </div>
                {stats && (
                  <div className="mt-1 grid grid-cols-2 gap-x-2 text-[10px] text-muted">
                    {Object.entries(stats).map(([k, v]) => (
                      <div key={k}>
                        {k}: {v === null ? '—' : Number(v).toFixed(2)}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </CardBody>
    </Card>
  )
}
