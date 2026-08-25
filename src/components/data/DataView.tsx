import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@heroui/react'
import { Columns3, Lightbulb, SlidersHorizontal, Sparkles, X } from 'lucide-react'
import { CollapsedIconBarItem } from '@/components/layout/CollapsedIconBar'
import { DataTable } from './DataTable'
import { ColumnStats } from './ColumnStats'
import { TransformPanel } from './TransformPanel'
import { LineageView } from './LineageView'
import { SnapshotView } from './SnapshotView'
import { CleaningPanel } from './CleaningPanel'
import { InsightsPanel } from './InsightsPanel'
import { useDataStore } from '@/stores/dataStore'

type DataViewMode = 'table' | 'lineage' | 'snapshots'
type DataPanel = 'cleaning' | 'insights' | 'transform' | 'columns'

export function DataView() {
  const { t } = useTranslation()
  const activeDataFrameId = useDataStore((s) => s.activeDataFrameId)
  const [view, setView] = useState<DataViewMode>('table')
  const [openPanel, setOpenPanel] = useState<DataPanel | null>(null)

  const togglePanel = (panel: DataPanel) => {
    setOpenPanel((current) => (current === panel ? null : panel))
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-2 lg:flex-row">
      <div className="flex h-full min-h-0 flex-1 flex-col overflow-hidden rounded border border-border bg-surface">
        <div className="flex shrink-0 items-center gap-1 border-b border-border px-2 py-1">
          {(['table', 'lineage', 'snapshots'] as const).map((v) => (
            <button
              key={v}
              className={`rounded px-2.5 py-1 text-xs capitalize transition-colors ${
                view === v ? 'bg-primary/20 text-primary' : 'text-muted hover:text-foreground'
              }`}
              onClick={() => setView(v)}
            >
              {v === 'lineage' ? t('common.lineage') : v === 'snapshots' ? t('snapshot.title') : t('common.table')}
            </button>
          ))}
        </div>
        <div className="min-h-0 flex-1">
          {view === 'table' ? <DataTable /> : view === 'lineage' ? <LineageView datasetId={activeDataFrameId} /> : <SnapshotView datasetId={activeDataFrameId} />}
        </div>
      </div>
      <div className="flex h-full min-h-0 shrink-0 border border-border bg-surface">
        <div className="flex w-10 shrink-0 flex-col items-center gap-1 border-r border-border py-2">
          <CollapsedIconBarItem
            icon={Sparkles}
            label={t('panel.cleaning')}
            tooltip={t('panel.cleaning')}
            active={openPanel === 'cleaning'}
            onClick={() => togglePanel('cleaning')}
          />
          <CollapsedIconBarItem
            icon={Lightbulb}
            label={t('panel.insights')}
            tooltip={t('panel.insights')}
            active={openPanel === 'insights'}
            onClick={() => togglePanel('insights')}
          />
          <CollapsedIconBarItem
            icon={SlidersHorizontal}
            label={t('transform.title')}
            tooltip={t('transform.title')}
            active={openPanel === 'transform'}
            onClick={() => togglePanel('transform')}
          />
          <CollapsedIconBarItem
            icon={Columns3}
            label={t('table.columns')}
            tooltip={t('table.columns')}
            active={openPanel === 'columns'}
            onClick={() => togglePanel('columns')}
          />
        </div>
        {openPanel && (
          <div className="flex min-h-0 w-72 flex-col">
            <div className="flex h-9 shrink-0 items-center justify-between border-b border-border px-2">
              <span className="text-xs font-semibold text-muted">
                {openPanel === 'cleaning'
                  ? t('panel.cleaning')
                  : openPanel === 'insights'
                    ? t('panel.insights')
                    : openPanel === 'transform'
                      ? t('transform.title')
                      : t('table.columns')}
              </span>
              <Button isIconOnly size="sm" variant="light" onPress={() => setOpenPanel(null)} aria-label={t('common.close')}>
                <X className="h-3.5 w-3.5" />
              </Button>
            </div>
            <div className="min-h-0 flex-1 overflow-auto p-2">
              {openPanel === 'cleaning' && <CleaningPanel />}
              {openPanel === 'insights' && <InsightsPanel />}
              {openPanel === 'transform' && <TransformPanel />}
              {openPanel === 'columns' && <ColumnStats />}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
