import { ArrowUp, ClipboardPaste, Database, FileText, Folder, Upload } from 'lucide-react'
import { Button, Card, CardBody, Checkbox, Input, Select, SelectItem, Textarea } from '@heroui/react'
import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useDataStore } from '@/stores/dataStore'
import { useUIStore } from '@/stores/uiStore'
import { api } from '@/api/client'

interface BrowseState {
  dir: string
  parent: string | null
  dirs: { name: string; path: string }[]
  files: { name: string; path: string }[]
}

export function DataExplorer() {
  const { t } = useTranslation()
  const inputRef = useRef<HTMLInputElement>(null)
  const importFile = useDataStore((s) => s.importFile)
  const importText = useDataStore((s) => s.importText)
  const loading = useDataStore((s) => s.loading)
  const addNotification = useUIStore((s) => s.addNotification)
  const [dragOver, setDragOver] = useState(false)
  const [sqlPath, setSqlPath] = useState('')
  const [sqlTables, setSqlTables] = useState<string[]>([])
  const [sqlSelectedTable, setSqlSelectedTable] = useState('')
  const [sqlLoading, setSqlLoading] = useState(false)
  const [importMode, setImportMode] = useState<'file' | 'sqlite' | 'paste'>('file')
  const [browse, setBrowse] = useState<BrowseState | null>(null)
  const [manualPath, setManualPath] = useState(false)
  const [pasteText, setPasteText] = useState('')
  const [pasteName, setPasteName] = useState('')
  const [mergeSheets, setMergeSheets] = useState(false)
  const [sourcePath, setSourcePath] = useState('')

  const browseDir = async (dir?: string) => {
    setSqlLoading(true)
    try {
      const state = await api.sqlBrowse(dir)
      setBrowse(state)
      setManualPath(false)
    } catch (err) {
      addNotification('error', err instanceof Error ? err.message : t('import.browseFailed'))
    } finally {
      setSqlLoading(false)
    }
  }

  const pickDbFile = (path: string) => {
    setSqlPath(path)
    setSqlTables([])
    setSqlSelectedTable('')
    listTables(path)
  }

  const listTables = async (path?: string) => {
    const p = (path ?? sqlPath).trim()
    if (!p) return
    setSqlLoading(true)
    try {
      const { tables } = await api.sqlTables(p)
      setSqlTables(tables)
      setSqlSelectedTable('')
    } catch (err) {
      addNotification('error', err instanceof Error ? err.message : t('import.listTablesFailed'))
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
      addNotification('success', t('import.tableImported', { name: meta.name }))
    } catch (err) {
      addNotification('error', err instanceof Error ? err.message : t('import.importFailed'))
    } finally {
      setSqlLoading(false)
    }
  }

  const handleFile = async (file: File) => {
    try {
      const merge = mergeSheets && /\.(xlsx|xls)$/i.test(file.name)
      const meta = await importFile(file, merge)
      addNotification('success', t('import.fileImported', { name: meta.name }))
    } catch (err) {
      addNotification('error', err instanceof Error ? err.message : t('import.importFailed'))
    }
  }

  const importLivePath = async () => {
    if (!sourcePath.trim()) return
    try {
      const results = await api.importPath(sourcePath.trim(), mergeSheets)
      await useDataStore.getState().loadDataFrames()
      if (results[0]) useDataStore.getState().setActiveDataFrame(results[0].id)
      addNotification('success', t('import.fileImported', { name: results[0]?.name || sourcePath }))
    } catch (err) {
      addNotification('error', err instanceof Error ? err.message : t('import.importFailed'))
    }
  }

  const handlePasteImport = async () => {
    if (!pasteText.trim()) return
    try {
      const meta = await importText(pasteName.trim() || t('import.pastedData'), pasteText)
      addNotification('success', t('import.fileImported', { name: meta.name }))
      setPasteText('')
      setPasteName('')
    } catch (err) {
      addNotification('error', err instanceof Error ? err.message : t('import.importFailed'))
    }
  }

  return (
    <Card className="bg-surface-elevated border-border">
      <CardBody className="gap-2">
        <div className="text-xs font-semibold text-muted">{t('import.title')}</div>

        {/* 导入方式切换 */}
        <div className="flex gap-1">
          <button
            className={`flex-1 rounded px-2 py-1 text-xs transition-colors ${
              importMode === 'file' ? 'bg-primary/20 text-primary' : 'text-muted hover:text-foreground'
            }`}
            onClick={() => setImportMode('file')}
          >
            {t('import.file')}
          </button>
          <button
            className={`flex-1 rounded px-2 py-1 text-xs transition-colors ${
              importMode === 'sqlite' ? 'bg-primary/20 text-primary' : 'text-muted hover:text-foreground'
            }`}
            onClick={() => {
              setImportMode('sqlite')
              if (!browse && !manualPath) browseDir()
            }}
          >
            <Database className="mr-1 inline h-3 w-3" />
            SQLite
          </button>
          <button
            className={`flex-1 rounded px-2 py-1 text-xs transition-colors ${
              importMode === 'paste' ? 'bg-primary/20 text-primary' : 'text-muted hover:text-foreground'
            }`}
            onClick={() => setImportMode('paste')}
          >
            <ClipboardPaste className="mr-1 inline h-3 w-3" />
            {t('import.paste')}
          </button>
        </div>

        {importMode === 'file' && (
          <>
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
            <p className="mt-1 text-xs text-muted">{t('import.dropHint')}</p>
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
              {t('import.browse')}
            </Button>
          </div>
          <div className="mt-1 flex gap-1">
            <Input
              size="sm"
              value={sourcePath}
              onValueChange={setSourcePath}
              placeholder={t('import.livePath')}
              className="flex-1"
            />
            <Button size="sm" variant="flat" onPress={importLivePath}>{t('import.liveImport')}</Button>
          </div>
          <p className="text-[10px] text-muted">{t('import.liveHint')}</p>
          <Checkbox
            size="sm"
            isSelected={mergeSheets}
            onValueChange={setMergeSheets}
            className="mt-1"
          >
            <span className="text-xs text-muted">{t('import.mergeSheets')}</span>
          </Checkbox>
          </>
        )}
        {importMode === 'sqlite' && (
          <div className="flex flex-col gap-1 rounded border border-border p-2">
            {manualPath ? (
              <>
                <Input
                  size="sm"
                  placeholder={t('import.dbPath')}
                  value={sqlPath}
                  onValueChange={(v) => {
                    setSqlPath(v)
                    setSqlTables([])
                  }}
                />
                <div className="flex gap-1">
                  <Button size="sm" variant="flat" className="flex-1" isLoading={sqlLoading} onPress={() => listTables()}>
                    {t('import.listTables')}
                  </Button>
                  <Button size="sm" variant="light" className="flex-1" onPress={() => browseDir()}>
                    {t('import.browseFile')}
                  </Button>
                </div>
              </>
            ) : (
              <>
                <div className="flex items-center gap-1">
                  <button
                    className="rounded p-1 hover:bg-surface disabled:opacity-30"
                    disabled={!browse?.parent}
                    onClick={() => browse?.parent && browseDir(browse.parent)}
                    aria-label={t('import.up')}
                  >
                    <ArrowUp className="h-3.5 w-3.5 text-muted" />
                  </button>
                  <span className="flex-1 truncate font-mono text-[10px] text-muted" title={browse?.dir}>
                    {browse?.dir ?? '…'}
                  </span>
                  <button
                    className="shrink-0 rounded px-1 text-[10px] text-primary hover:underline"
                    onClick={() => setManualPath(true)}
                  >
                    {t('import.manualInput')}
                  </button>
                </div>
                <div className="max-h-40 overflow-auto rounded bg-surface">
                  {browse?.dirs.map((d) => (
                    <button
                      key={d.path}
                      className="flex w-full items-center gap-1.5 px-2 py-1 text-left text-xs hover:bg-surface-elevated"
                      onClick={() => browseDir(d.path)}
                    >
                      <Folder className="h-3.5 w-3.5 shrink-0 text-warning" />
                      <span className="truncate">{d.name}</span>
                    </button>
                  ))}
                  {browse?.files.map((f) => (
                    <button
                      key={f.path}
                      className={`flex w-full items-center gap-1.5 px-2 py-1 text-left text-xs hover:bg-surface-elevated ${
                        sqlPath === f.path ? 'bg-primary/15 text-primary' : ''
                      }`}
                      onClick={() => pickDbFile(f.path)}
                    >
                      <FileText className="h-3.5 w-3.5 shrink-0 text-primary" />
                      <span className="truncate">{f.name}</span>
                    </button>
                  ))}
                  {browse && browse.dirs.length === 0 && browse.files.length === 0 && (
                    <p className="px-2 py-2 text-[10px] text-muted">{t('import.noDbFiles')}</p>
                  )}
                </div>
              </>
            )}
            {sqlTables.length > 0 && (
              <>
                <Select
                  size="sm"
                  placeholder={t('import.selectTable')}
                  selectedKeys={sqlSelectedTable ? [sqlSelectedTable] : []}
                  onSelectionChange={(keys) => setSqlSelectedTable(Array.from(keys)[0] as string)}
                >
                  {sqlTables.map((tbl) => (
                    <SelectItem key={tbl}>{tbl}</SelectItem>
                  ))}
                </Select>
                <Button size="sm" color="primary" isLoading={sqlLoading} onPress={importSqlTable}>
                  {t('import.importTable')}
                </Button>
              </>
            )}
          </div>
        )}
        {importMode === 'paste' && (
          <div className="flex flex-col gap-2">
            <Input
              size="sm"
              placeholder={t('import.pasteName')}
              value={pasteName}
              onValueChange={setPasteName}
            />
            <Textarea
              size="sm"
              minRows={5}
              placeholder={t('import.pastePlaceholder')}
              value={pasteText}
              onValueChange={setPasteText}
            />
            <Button
              size="sm"
              color="primary"
              isLoading={loading}
              isDisabled={!pasteText.trim()}
              onPress={handlePasteImport}
            >
              {t('import.importText')}
            </Button>
          </div>
        )}
      </CardBody>
    </Card>
  )
}
