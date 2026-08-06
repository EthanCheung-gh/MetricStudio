import { useCallback, useEffect, useState } from 'react'
import { AlertTriangle, CheckCircle2, Sparkles, RefreshCw } from 'lucide-react'
import { Button } from '@heroui/react'
import { api } from '@/api/client'
import { useDataStore } from '@/stores/dataStore'
import { useUIStore } from '@/stores/uiStore'
import type { QualityReport } from '@/types/data'

export function CleaningPanel() {
  const activeDataFrameId = useDataStore((s) => s.activeDataFrameId)
  const refreshActiveDataFrame = useDataStore((s) => s.refreshActiveDataFrame)
  const addNotification = useUIStore((s) => s.addNotification)
  const cleaningScanVersion = useUIStore((s) => s.cleaningScanVersion)
  const [report, setReport] = useState<QualityReport | null>(null)
  const [loading, setLoading] = useState(false)
  const [applying, setApplying] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!activeDataFrameId) return
    setLoading(true)
    try {
      setReport(await api.quality(activeDataFrameId))
    } catch {
      /* ignore */
    } finally {
      setLoading(false)
    }
  }, [activeDataFrameId])

  useEffect(() => {
    setReport(null)
    load()
  }, [load, cleaningScanVersion])

  const applyRecipe = async (recipeId: string) => {
    if (!activeDataFrameId) return
    setApplying(recipeId)
    try {
      await api.applyRecipe(activeDataFrameId, recipeId)
      addNotification('success', `Recipe applied: ${recipeId}`)
      await Promise.all([load(), refreshActiveDataFrame()])
    } catch (err) {
      addNotification('error', err instanceof Error ? err.message : 'Recipe failed')
    } finally {
      setApplying(null)
    }
  }

  if (!activeDataFrameId) return null

  const recipeById = new Map((report?.recipes ?? []).map((r) => [r.id, r]))

  return (
    <div className="flex flex-col gap-2 rounded border border-border bg-surface p-2">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1 text-xs font-semibold text-muted">
          <Sparkles className="h-3.5 w-3.5" />
          Cleaning
        </div>
        <Button isIconOnly size="sm" variant="light" isLoading={loading} onPress={load} aria-label="Refresh quality report">
          <RefreshCw className="h-3.5 w-3.5" />
        </Button>
      </div>

      {loading && !report && <div className="text-[11px] text-muted">Scanning…</div>}

      {report && report.issues.length === 0 && (
        <div className="flex items-center gap-1.5 text-[11px] text-success">
          <CheckCircle2 className="h-3.5 w-3.5" />
          No issues detected
        </div>
      )}

      {report &&
        report.issues.map((issue) => (
          <div
            key={issue.id + issue.columns.join(',')}
            className="flex flex-col gap-1 rounded border border-border/60 bg-surface-elevated/40 p-2"
          >
            <div className="flex items-start gap-1.5">
              <AlertTriangle
                className={`mt-0.5 h-3.5 w-3.5 shrink-0 ${
                  issue.severity === 'warning' ? 'text-warning' : 'text-primary'
                }`}
              />
              <div className="min-w-0">
                <div className="text-[11px] font-semibold">{issue.title}</div>
                <div className="break-words text-[11px] text-muted">{issue.detail}</div>
              </div>
            </div>
            {issue.suggestions.length > 0 && (
              <div className="ml-5 flex flex-wrap gap-1">
                {issue.suggestions.map((rid) => {
                  const meta = recipeById.get(rid)
                  if (!meta) return null
                  return (
                    <Button
                      key={rid}
                      size="sm"
                      variant="flat"
                      color={issue.severity === 'warning' ? 'warning' : 'primary'}
                      className="h-6 min-h-0 px-2 text-[10px]"
                      isLoading={applying === rid}
                      onPress={() => applyRecipe(rid)}
                    >
                      {meta.name}
                    </Button>
                  )
                })}
              </div>
            )}
          </div>
        ))}
    </div>
  )
}
