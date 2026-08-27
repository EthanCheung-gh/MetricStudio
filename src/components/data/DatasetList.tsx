import { memo } from 'react'
import { useTranslation } from 'react-i18next'
import { Database, Download, GitCompareArrows, RefreshCw, Trash2 } from 'lucide-react'
import { Button, Card, CardBody, Chip } from '@heroui/react'
import { useDataStore } from '@/stores/dataStore'
import { useUIStore } from '@/stores/uiStore'
import { api } from '@/api/client'

export const DatasetList = memo(function DatasetList() {
  const { t } = useTranslation()
  const dataFrames = useDataStore((s) => s.dataFrames)
  const activeId = useDataStore((s) => s.activeDataFrameId)
  const setActive = useDataStore((s) => s.setActiveDataFrame)
  const remove = useDataStore((s) => s.removeDataFrame)
  const sourceStatuses = useDataStore((s) => s.sourceStatuses)
  const refreshSource = useDataStore((s) => s.refreshSource)
  const dataVersions = useDataStore((s) => s.dataVersions)
  const addNotification = useUIStore((s) => s.addNotification)

  const refreshDataset = async (id: string, name: string) => {
    try {
      await refreshSource(id)
      addNotification('success', t('dataset.refreshed', { name }))
    } catch (err) {
      addNotification('error', err instanceof Error ? err.message : 'Refresh failed')
    }
  }

  return (
    <Card className="bg-surface-elevated border-border">
      <CardBody className="gap-2">
        <div className="flex items-center justify-between">
          <div className="text-xs font-semibold text-muted">{t('nav.datasets')}</div>
          {dataFrames.length >= 2 && (
            <Button
              isIconOnly
              size="sm"
              variant="light"
              className="h-5 w-5 min-w-0"
              aria-label={t('dataset.compare')}
              onPress={() => useUIStore.getState().setDiffModalOpen(true)}
            >
              <GitCompareArrows className="h-3 w-3 text-primary" />
            </Button>
          )}
        </div>
        {dataFrames.length === 0 && (
          <p className="text-xs text-muted">{t('dataset.empty')}</p>
        )}
        <div className="flex flex-col gap-1">
          {dataFrames.map((df) => {
            const source = sourceStatuses[df.id]
            return (
            <div
              key={df.id}
              className={`flex items-center justify-between rounded px-2 py-1.5 text-xs cursor-pointer ${
                activeId === df.id ? 'bg-primary/20 text-primary' : 'hover:bg-surface'
              }`}
              onClick={() => setActive(df.id)}
            >
              <div className="flex items-center gap-2 overflow-hidden" title={source?.source_path || undefined}>
                <Database className="h-3.5 w-3.5 shrink-0" />
                <span className="truncate">{df.name}</span>
                {source?.changed && <span className="text-[9px] text-warning">{t('dataset.changed')}</span>}
                {source?.original_exists === false && <span className="text-[9px] text-danger">{t('dataset.sourceMissing')}</span>}
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <Chip size="sm" variant="flat" className="text-[10px] h-4">
                  {df.rows}
                </Chip>
                {(dataVersions[df.id] || 0) > 0 && (
                  <span className="text-[9px] text-muted" title={t('dataset.versionBadge')}>
                    v{dataVersions[df.id]}
                  </span>
                )}
                <Button
                  isIconOnly
                  size="sm"
                  variant="light"
                  className="h-5 w-5 min-w-0"
                  aria-label={`Refresh ${df.name}`}
                  isDisabled={!source?.refreshable || source.original_exists === false}
                  onPress={() => refreshDataset(df.id, df.name)}
                >
                  <RefreshCw className="h-3 w-3 text-primary" />
                </Button>
                <Button
                  isIconOnly
                  size="sm"
                  variant="light"
                  className="h-5 w-5 min-w-0"
                  aria-label={`Export ${df.name}`}
                  onPress={() => window.open(api.exportDatasetUrl(df.id, 'csv'), '_blank')}
                >
                  <Download className="h-3 w-3 text-muted" />
                </Button>
                <Button
                  isIconOnly
                  size="sm"
                  variant="light"
                  className="h-5 w-5 min-w-0"
                  onPress={() => {
                    remove(df.id)
                    addNotification('info', `Removed ${df.name}`)
                  }}
                >
                  <Trash2 className="h-3 w-3 text-danger" />
                </Button>
              </div>
            </div>
            )
          })}
        </div>
      </CardBody>
    </Card>
  )
})
