import { useState } from 'react'
import { DataTable } from './DataTable'
import { ColumnStats } from './ColumnStats'
import { TransformPanel } from './TransformPanel'
import { LineageView } from './LineageView'
import { CleaningPanel } from './CleaningPanel'
import { InsightsPanel } from './InsightsPanel'
import { useDataStore } from '@/stores/dataStore'

type DataViewMode = 'table' | 'lineage'

export function DataView() {
  const activeDataFrameId = useDataStore((s) => s.activeDataFrameId)
  const [view, setView] = useState<DataViewMode>('table')

  return (
    <div className="flex h-full flex-col gap-2 lg:flex-row">
      <div className="flex h-full min-h-0 flex-1 flex-col overflow-hidden rounded border border-border bg-surface">
        <div className="flex shrink-0 items-center gap-1 border-b border-border px-2 py-1">
          {(['table', 'lineage'] as const).map((v) => (
            <button
              key={v}
              className={`rounded px-2.5 py-1 text-xs capitalize transition-colors ${
                view === v ? 'bg-primary/20 text-primary' : 'text-muted hover:text-foreground'
              }`}
              onClick={() => setView(v)}
            >
              {v === 'lineage' ? '血缘' : '表格'}
            </button>
          ))}
        </div>
        <div className="min-h-0 flex-1">
          {view === 'table' ? <DataTable /> : <LineageView datasetId={activeDataFrameId} />}
        </div>
      </div>
      <div className="flex h-full min-h-0 w-full flex-col gap-2 overflow-auto lg:w-72">
        <CleaningPanel />
        <InsightsPanel />
        <TransformPanel />
        <ColumnStats />
      </div>
    </div>
  )
}
