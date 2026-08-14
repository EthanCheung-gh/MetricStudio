import { Upload } from 'lucide-react'
import { Button, Card, CardBody } from '@heroui/react'
import { useRef, useState } from 'react'
import { useDataStore } from '@/stores/dataStore'
import { useUIStore } from '@/stores/uiStore'

export function DataExplorer() {
  const inputRef = useRef<HTMLInputElement>(null)
  const importFile = useDataStore((s) => s.importFile)
  const loading = useDataStore((s) => s.loading)
  const addNotification = useUIStore((s) => s.addNotification)
  const [dragOver, setDragOver] = useState(false)

  const handleFile = async (file: File) => {
    try {
      const meta = await importFile(file)
      addNotification('success', `Imported ${meta.name}`)
    } catch (err) {
      addNotification('error', err instanceof Error ? err.message : 'Import failed')
    }
  }

  return (
    <Card className="bg-surface-elevated border-border">
      <CardBody className="gap-2">
        <div className="text-xs font-semibold text-muted">导入数据</div>
        <div
          className={`rounded border border-dashed p-3 text-center transition-colors ${
            dragOver ? 'border-primary bg-primary/10' : 'border-border'
          }`}
          onDragOver={(e) => {
            e.preventDefault()
            setDragOver(true)
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            e.preventDefault()
            setDragOver(false)
            const file = e.dataTransfer.files[0]
            if (file) handleFile(file)
          }}
        >
          <Upload className="mx-auto h-6 w-6 text-muted" />
          <p className="mt-1 text-xs text-muted">拖入 CSV / Excel / Parquet</p>
          <input
            ref={inputRef}
            type="file"
            accept=".csv,.xlsx,.xls,.parquet"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0]
              if (file) handleFile(file)
            }}
          />
          <Button
            size="sm"
            color="primary"
            className="mt-2"
            isLoading={loading}
            onPress={() => inputRef.current?.click()}
          >
            浏览
          </Button>
        </div>
      </CardBody>
    </Card>
  )
}
