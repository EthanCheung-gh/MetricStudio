import { memo } from 'react'
import { Database, RefreshCw, Trash2 } from 'lucide-react'
import { Button, Card, CardBody, Chip } from '@heroui/react'
import { useDataStore } from '@/stores/dataStore'
import { useUIStore } from '@/stores/uiStore'
import { api } from '@/api/client'

export const DatasetList = memo(function DatasetList() {
  const dataFrames = useDataStore((s) => s.dataFrames)
  const activeId = useDataStore((s) => s.activeDataFrameId)
  const setActive = useDataStore((s) => s.setActiveDataFrame)
  const remove = useDataStore((s) => s.removeDataFrame)
  const addNotification = useUIStore((s) => s.addNotification)

  const refreshDataset = async (id: string, name: string) => {
    try {
      await api.refreshDataset(id)
      await useDataStore.getState().loadDataFrames()
      if (useDataStore.getState().activeDataFrameId === id) {
        await useDataStore.getState().refreshActiveDataFrame()
      }
      addNotification('success', `Refreshed ${name}`)
    } catch (err) {
      addNotification('error', err instanceof Error ? err.message : 'Refresh failed')
    }
  }

  return (
    <Card className="bg-surface-elevated border-border">
      <CardBody className="gap-2">
        <div className="text-xs font-semibold text-muted">数据集</div>
        {dataFrames.length === 0 && (
          <p className="text-xs text-muted">尚未导入数据集。</p>
        )}
        <div className="flex flex-col gap-1">
          {dataFrames.map((df) => (
            <div
              key={df.id}
              className={`flex items-center justify-between rounded px-2 py-1.5 text-xs cursor-pointer ${
                activeId === df.id ? 'bg-primary/20 text-primary' : 'hover:bg-surface'
              }`}
              onClick={() => setActive(df.id)}
            >
              <div className="flex items-center gap-2 overflow-hidden">
                <Database className="h-3.5 w-3.5 shrink-0" />
                <span className="truncate">{df.name}</span>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <Chip size="sm" variant="flat" className="text-[10px] h-4">
                  {df.rows}
                </Chip>
                <Button
                  isIconOnly
                  size="sm"
                  variant="light"
                  className="h-5 w-5 min-w-0"
                  aria-label={`Refresh ${df.name}`}
                  onPress={() => refreshDataset(df.id, df.name)}
                >
                  <RefreshCw className="h-3 w-3 text-primary" />
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
          ))}
        </div>
      </CardBody>
    </Card>
  )
})
