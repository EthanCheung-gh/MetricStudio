import { Database, Upload } from 'lucide-react'
import { Button, Card, CardBody, Input, Select, SelectItem } from '@heroui/react'
import { useRef, useState } from 'react'
import { useDataStore } from '@/stores/dataStore'
import { useUIStore } from '@/stores/uiStore'
import { api } from '@/api/client'

export function DataExplorer() {
  const inputRef = useRef<HTMLInputElement>(null)
  const importFile = useDataStore((s) => s.importFile)
  const loading = useDataStore((s) => s.loading)
  const addNotification = useUIStore((s) => s.addNotification)
  const [dragOver, setDragOver] = useState(false)
  const [sqlPath, setSqlPath] = useState('')
  const [sqlTables, setSqlTables] = useState<string[]>([])
  const [sqlSelectedTable, setSqlSelectedTable] = useState('')
  const [sqlLoading, setSqlLoading] = useState(false)
  const [importMode, setImportMode] = useState<'file' | 'sqlite'>('file')

  const listTables = async () => {
    if (!sqlPath.trim()) return
    setSqlLoading(true)
    try {
      const { tables } = await api.sqlTables(sqlPath.trim())
      setSqlTables(tables)
      setSqlSelectedTable('')
    } catch (err) {
      addNotification('error', err instanceof Error ? err.message : '列出表失败')
    } finally {
      setSqlLoading(false)
    }
  }

  const importSqlTable = async () => {
    if (!sqlPath.trim() || !sqlSelectedTable) return
    setSqlLoading(true)
    try {
      const meta = await api.sqlImport(sqlPath.trim(), sqlSelectedTable)
      await useDataStore.getState().loadDataFrames()
      addNotification('success', `已导入 SQLite 表 ${meta.name}`)
    } catch (err) {
      addNotification('error', err instanceof Error ? err.message : '导入失败')
    } finally {
      setSqlLoading(false)
    }
  }

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

        {/* 导入方式切换 */}
        <div className="flex gap-1">
          <button
            className={`flex-1 rounded px-2 py-1 text-xs transition-colors ${
              importMode === 'file' ? 'bg-primary/20 text-primary' : 'text-muted hover:text-foreground'
            }`}
            onClick={() => setImportMode('file')}
          >
            文件
          </button>
          <button
            className={`flex-1 rounded px-2 py-1 text-xs transition-colors ${
              importMode === 'sqlite' ? 'bg-primary/20 text-primary' : 'text-muted hover:text-foreground'
            }`}
            onClick={() => setImportMode('sqlite')}
          >
            <Database className="mr-1 inline h-3 w-3" />
            SQLite
          </button>
        </div>

        {importMode === 'file' ? (
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
        ) : (
          <div className="flex flex-col gap-1 rounded border border-border p-2">
            <Input size="sm" placeholder="数据库文件路径" value={sqlPath} onValueChange={setSqlPath} />
            <Button size="sm" variant="flat" isLoading={sqlLoading} onPress={listTables}>
              列出表
            </Button>
            {sqlTables.length > 0 && (
              <>
                <Select
                  size="sm"
                  placeholder="选择表"
                  selectedKeys={sqlSelectedTable ? [sqlSelectedTable] : []}
                  onSelectionChange={(keys) => setSqlSelectedTable(Array.from(keys)[0] as string)}
                >
                  {sqlTables.map((t) => (
                    <SelectItem key={t}>{t}</SelectItem>
                  ))}
                </Select>
                <Button size="sm" color="primary" isLoading={sqlLoading} onPress={importSqlTable}>
                  导入表
                </Button>
              </>
            )}
          </div>
        )}
      </CardBody>
    </Card>
  )
}
