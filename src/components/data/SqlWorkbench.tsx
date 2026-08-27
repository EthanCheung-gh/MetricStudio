import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Database, Eraser, History, Play, Save, Table2 } from 'lucide-react'
import { Button, Input } from '@heroui/react'
import { api } from '@/api/client'
import { useDataStore } from '@/stores/dataStore'
import { useUIStore } from '@/stores/uiStore'

interface QueryResult {
  columns: string[]
  rows: (string | number | boolean | null)[][]
  rowCount: number
  truncated: boolean
  elapsedMs: number
  plan: string[]
}

interface SchemaTable {
  table: string
  dataset: string
  rows: number
  columns: string[]
}

interface HistoryEntry {
  sql: string
  elapsedMs: number
  rowCount: number
  at: string
}

export function SqlWorkbench() {
  const { t } = useTranslation()
  const loadDataFrames = useDataStore((s) => s.loadDataFrames)
  const addNotification = useUIStore((s) => s.addNotification)
  const [sqlText, setSqlText] = useState('')
  const [result, setResult] = useState<QueryResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [running, setRunning] = useState(false)
  const [tables, setTables] = useState<SchemaTable[]>([])
  const [history, setHistory] = useState<HistoryEntry[]>([])
  const [showHistory, setShowHistory] = useState(false)
  const [snapshotName, setSnapshotName] = useState('')
  const editorRef = useRef<HTMLTextAreaElement>(null)

  const refreshMeta = useCallback(async () => {
    try {
      setTables((await api.sqlSchema()).tables)
      setHistory((await api.sqlHistory()).history)
    } catch {
      /* ignore */
    }
  }, [])

  useEffect(() => {
    void refreshMeta()
  }, [refreshMeta])

  const run = useCallback(async () => {
    if (!sqlText.trim() || running) return
    setRunning(true)
    setError(null)
    try {
      setResult(await api.runSqlQuery(sqlText))
      await refreshMeta()
    } catch (err) {
      setResult(null)
      setError(err instanceof Error ? err.message : 'Query failed')
    } finally {
      setRunning(false)
    }
  }, [sqlText, running, refreshMeta])

  const insertTable = (table: string) => {
    setSqlText((current) => (current ? `${current.replace(/\s+$/, '')}\n${table}` : `SELECT * FROM ${table} LIMIT 50`))
    editorRef.current?.focus()
  }

  const clearHistory = async () => {
    try {
      await api.clearSqlHistory()
      setHistory([])
    } catch {
      /* ignore */
    }
  }

  const saveSnapshot = async () => {
    try {
      const meta = await api.importSqlResult(snapshotName.trim() || undefined)
      addNotification('success', t('sql.snapshotSaved', { name: meta.name }))
      setSnapshotName('')
      await loadDataFrames()
    } catch (err) {
      addNotification('error', err instanceof Error ? err.message : 'Snapshot failed')
    }
  }

  return (
    <div className="flex h-full min-h-0 gap-2">
      {/* schema sidebar */}
      <div className="flex w-52 shrink-0 flex-col gap-1 overflow-auto rounded border border-border bg-surface-elevated/40 p-2">
        <div className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-muted">
          <Database className="h-3 w-3" /> {t('sql.schema')}
        </div>
        {tables.length === 0 && <p className="text-[11px] text-muted">{t('sql.noTables')}</p>}
        {tables.map((entry) => (
          <button
            key={entry.table}
            className="rounded px-1.5 py-1 text-left hover:bg-surface"
            onClick={() => insertTable(entry.table)}
            title={entry.columns.join(', ')}
          >
            <div className="truncate font-mono text-[11px] text-primary">{entry.table}</div>
            <div className="text-[10px] text-muted">{entry.dataset} · {entry.rows}</div>
          </button>
        ))}
      </div>

      <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-2">
        {/* editor */}
        <textarea
          ref={editorRef}
          className="h-28 w-full shrink-0 resize-none rounded border border-border bg-surface p-2 font-mono text-xs outline-none focus:border-primary/60"
          placeholder={t('sql.placeholder')}
          value={sqlText}
          onChange={(e) => setSqlText(e.target.value)}
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') void run()
          }}
          spellCheck={false}
        />
        <div className="flex shrink-0 items-center gap-2">
          <Button size="sm" color="primary" isLoading={running} startContent={<Play className="h-3 w-3" />} onPress={run}>
            {t('sql.run')} (⌘↵)
          </Button>
          <Button size="sm" variant="light" startContent={<History className="h-3 w-3" />} onPress={() => setShowHistory((v) => !v)}>
            {t('sql.history')}
          </Button>
          <Button size="sm" variant="light" isDisabled={!result} startContent={<Save className="h-3 w-3" />} onPress={saveSnapshot} aria-label={t('sql.saveSnapshot')}>
            {t('sql.saveSnapshot')}
          </Button>
          <Input
            size="sm"
            className="w-40"
            placeholder={t('sql.snapshotName')}
            value={snapshotName}
            onValueChange={setSnapshotName}
          />
          {result && (
            <span className="ml-auto text-[11px] text-muted">
              {result.rowCount}{result.truncated ? '+' : ''} · {result.elapsedMs}ms
            </span>
          )}
        </div>

        {showHistory && (
          <div className="shrink-0 rounded border border-border/60 bg-surface-elevated/40 p-2">
            <div className="mb-1 flex items-center justify-between">
              <span className="text-[10px] font-semibold uppercase text-muted">{t('sql.history')}</span>
              <Button isIconOnly size="sm" variant="light" className="h-5 w-5 min-w-0" onPress={clearHistory} aria-label={t('sql.clearHistory')}>
                <Eraser className="h-3 w-3" />
              </Button>
            </div>
            {history.length === 0 && <p className="text-[11px] text-muted">{t('sql.emptyHistory')}</p>}
            {history.map((entry, index) => (
              <button
                key={`${entry.at}-${index}`}
                className="block w-full truncate rounded px-1 py-0.5 text-left font-mono text-[10px] text-muted hover:bg-surface hover:text-foreground"
                title={entry.sql}
                onClick={() => setSqlText(entry.sql)}
              >
                [{entry.at}] {entry.sql}
              </button>
            ))}
          </div>
        )}

        {error && <div className="shrink-0 rounded border border-danger/40 bg-danger/10 p-2 text-[11px] text-danger">{error}</div>}

        {result && (
          <>
            {result.plan.length > 0 && (
              <details className="shrink-0 rounded border border-border/60 bg-surface-elevated/40 p-2 text-[10px] text-muted">
                <summary className="cursor-pointer font-semibold uppercase">{t('sql.plan')}</summary>
                <ul className="mt-1 space-y-0.5 font-mono">
                  {result.plan.map((step, index) => (
                    <li key={index}>• {step}</li>
                  ))}
                </ul>
              </details>
            )}
            <div className="min-h-0 flex-1 overflow-auto rounded border border-border">
              <table className="w-full text-[11px]">
                <thead className="sticky top-0 bg-surface-elevated text-left text-muted">
                  <tr>
                    {result.columns.map((c) => (
                      <th key={c} className="whitespace-nowrap px-2 py-1 font-mono">{c}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {result.rows.slice(0, 200).map((row, i) => (
                    <tr key={i} className="border-t border-border/50">
                      {row.map((value, j) => (
                        <td key={j} className="max-w-[220px] truncate whitespace-nowrap px-2 py-1">{String(value ?? '')}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
              {result.rows.length > 200 && (
                <div className="border-t border-border/50 px-2 py-1 text-[10px] text-muted">
                  <Table2 className="mr-1 inline h-3 w-3" />
                  {t('sql.previewTruncated', { shown: 200, total: result.rowCount })}
                </div>
              )}
            </div>
          </>
        )}
        {!result && !error && (
          <div className="flex flex-1 items-center justify-center rounded border border-dashed border-border/60 text-[11px] text-muted">
            {t('sql.hint')}
          </div>
        )}
      </div>
    </div>
  )
}
