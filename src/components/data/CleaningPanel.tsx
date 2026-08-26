import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { AlertTriangle, CheckCircle2, Play, RefreshCw, Save, Sparkles, Trash2 } from 'lucide-react'
import { Button, Input, Modal, ModalBody, ModalContent, ModalFooter, ModalHeader } from '@heroui/react'
import { api } from '@/api/client'
import { useDataStore } from '@/stores/dataStore'
import { useUIStore } from '@/stores/uiStore'
import type { QualityFixPlan, QualityReport, UserRecipe } from '@/types/data'

interface RecipePreset {
  id: string
  name: string
  description: string
  dynamic: boolean
}

export function CleaningPanel() {
  const { t } = useTranslation();
  const activeDataFrameId = useDataStore((s) => s.activeDataFrameId)
  const refreshActiveDataFrame = useDataStore((s) => s.refreshActiveDataFrame)
  const addNotification = useUIStore((s) => s.addNotification)
  const cleaningScanVersion = useUIStore((s) => s.cleaningScanVersion)
  const [report, setReport] = useState<QualityReport | null>(null)
  const [recipes, setRecipes] = useState<{ presets: RecipePreset[]; custom: UserRecipe[] } | null>(null)
  const [loading, setLoading] = useState(false)
  const [applying, setApplying] = useState<string | null>(null)
  const [saveOpen, setSaveOpen] = useState(false)
  const [saveName, setSaveName] = useState('')
  const [savingRecipe, setSavingRecipe] = useState(false)
  const [fixPlan, setFixPlan] = useState<QualityFixPlan | null>(null)
  const [planningFix, setPlanningFix] = useState(false)
  const [applyingFix, setApplyingFix] = useState(false)

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

  const loadRecipes = useCallback(async () => {
    try {
      setRecipes(await api.listRecipes())
    } catch {
      /* ignore */
    }
  }, [])

  useEffect(() => {
    setReport(null)
    setFixPlan(null)
    load()
    loadRecipes()
  }, [load, loadRecipes, cleaningScanVersion])

  const applyRecipe = async (recipeId: string, name?: string) => {
    if (!activeDataFrameId) return
    setApplying(recipeId)
    try {
      await api.applyRecipe(activeDataFrameId, recipeId)
      addNotification('success', `Recipe applied: ${name ?? recipeId}`)
      await Promise.all([load(), refreshActiveDataFrame()])
    } catch (err) {
      addNotification('error', err instanceof Error ? err.message : 'Recipe failed')
    } finally {
      setApplying(null)
    }
  }

  const previewSuggestedFixes = async () => {
    if (!activeDataFrameId) return
    setPlanningFix(true)
    try {
      const plan = await api.qualityFixPreview(activeDataFrameId)
      if (plan.operations.length === 0) {
        addNotification('info', t('clean.noSafeFixes'))
        return
      }
      setFixPlan(plan)
    } catch (err) {
      addNotification('error', err instanceof Error ? err.message : t('clean.fixPreviewFailed'))
    } finally {
      setPlanningFix(false)
    }
  }

  const applySuggestedFixes = async () => {
    if (!activeDataFrameId || !fixPlan || fixPlan.datasetId !== activeDataFrameId) return
    setApplyingFix(true)
    try {
      await api.applyBatch(activeDataFrameId, fixPlan.operations)
      setFixPlan(null)
      await Promise.all([load(), refreshActiveDataFrame()])
      addNotification('success', t('clean.fixesApplied'))
    } catch (err) {
      addNotification('error', err instanceof Error ? err.message : t('clean.fixApplyFailed'))
    } finally {
      setApplyingFix(false)
    }
  }

  const saveRecipe = async () => {
    if (!activeDataFrameId || !saveName.trim()) return
    setSavingRecipe(true)
    try {
      const history = await api.history(activeDataFrameId)
      if (history.length === 0) {
        addNotification('info', 'No transforms to save as a recipe')
        return
      }
      await api.saveRecipe(
        saveName.trim(),
        history.map((h) => ({ type: h.type, params: h.params })),
      )
      addNotification('success', 'Recipe saved')
      setSaveName('')
      setSaveOpen(false)
      await loadRecipes()
    } catch (err) {
      addNotification('error', err instanceof Error ? err.message : 'Save recipe failed')
    } finally {
      setSavingRecipe(false)
    }
  }

  const deleteRecipe = async (recipeId: string) => {
    try {
      await api.deleteRecipe(recipeId)
      await loadRecipes()
      addNotification('success', 'Recipe deleted')
    } catch (err) {
      addNotification('error', err instanceof Error ? err.message : 'Delete recipe failed')
    }
  }

  if (!activeDataFrameId) return null

  const recipeById = new Map((report?.recipes ?? []).map((r) => [r.id, r]))
  const customRecipes = recipes?.custom ?? []

  return (
    <div className="flex flex-col gap-2 rounded border border-border bg-surface p-2">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1 text-xs font-semibold text-muted">
          <Sparkles className="h-3.5 w-3.5" />
          {t('panel.cleaning')}
        </div>
        <Button isIconOnly size="sm" variant="light" isLoading={loading} onPress={load} aria-label={t('clean.refresh')}>
          <RefreshCw className="h-3.5 w-3.5" />
        </Button>
      </div>

      {loading && !report && <div className="text-[11px] text-muted">{t('clean.scanning')}</div>}

      {report && report.issues.some((issue) => ['missing', 'duplicates', 'outliers', 'type'].includes(issue.id)) && (
        <Button
          size="sm"
          color="primary"
          variant="flat"
          isLoading={planningFix}
          startContent={<Sparkles className="h-3.5 w-3.5" />}
          onPress={previewSuggestedFixes}
        >
          {t('clean.previewSuggestedFixes')}
        </Button>
      )}

      {report && report.issues.length === 0 && (
        <div className="flex items-center gap-1.5 text-[11px] text-success">
          <CheckCircle2 className="h-3.5 w-3.5" />
          {t('clean.noIssues')}
        </div>
      )}

      {report && (report.summary.missing_cells > 0 || report.summary.duplicate_rows > 0) && (
        <div className="flex gap-3 rounded border border-border/60 bg-surface-elevated/40 px-2 py-1 text-[10px] text-muted">
          <span>{t('clean.statMissing', { count: report.summary.missing_cells })}</span>
          <span>{t('clean.statDuplicates', { count: report.summary.duplicate_rows })}</span>
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
                      onPress={() => applyRecipe(rid, meta.name)}
                    >
                      {meta.name}
                    </Button>
                  )
                })}
              </div>
            )}
            {issue.samples && issue.samples.length > 0 && (
              <details className="ml-5">
                <summary className="cursor-pointer text-[10px] text-muted">{t('clean.showSamples', { count: issue.samples.length })}</summary>
                <div className="mt-1 space-y-0.5 font-mono text-[10px] text-muted">
                  {issue.samples.map((sample) => (
                    <div key={sample.row} className="truncate" title={JSON.stringify(sample.values)}>
                      #{sample.row}: {Object.entries(sample.values).slice(0, 4).map(([key, value]) => `${key}=${String(value)}`).join(', ')}
                    </div>
                  ))}
                </div>
              </details>
            )}
          </div>
        ))}

      {/* Column-level quality stats */}
      {report && report.column_stats && report.column_stats.length > 0 && (
        <details className="rounded border border-border/60 bg-surface-elevated/40 p-2">
          <summary className="cursor-pointer text-[10px] font-semibold uppercase tracking-wide text-muted">{t('clean.columnStats')}</summary>
          <div className="mt-2 max-h-48 overflow-auto">
            <table className="w-full text-[10px]">
              <thead className="text-left text-muted">
                <tr>
                  <th className="py-1 pr-2">{t('table.columns')}</th>
                  <th className="py-1 pr-2">{t('clean.statMissingShort')}</th>
                  <th className="py-1 pr-2">{t('clean.statUnique')}</th>
                  <th className="py-1">{t('clean.statRange')}</th>
                </tr>
              </thead>
              <tbody>
                {report.column_stats.map((stat) => (
                  <tr key={stat.column} className="border-t border-border/50">
                    <td className="max-w-[80px] truncate py-1 pr-2 font-medium" title={stat.column}>{stat.column}</td>
                    <td className="py-1 pr-2">{stat.missing_ratio}%</td>
                    <td className="py-1 pr-2">{stat.unique}</td>
                    <td className="py-1">
                      {stat.mean !== undefined && stat.mean !== null
                        ? `${stat.min} – ${stat.max}`
                        : stat.top ?? '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      )}

      {/* User-defined recipes */}
      <div className="mt-1 flex flex-col gap-1 border-t border-border pt-2">
        <div className="flex items-center justify-between">
          <span className="text-[10px] font-semibold uppercase tracking-wide text-muted">{t('panel.myRecipes')}</span>
          <Button
            size="sm"
            variant="light"
            startContent={<Save className="h-3 w-3" />}
            onPress={() => setSaveOpen((v) => !v)}
          >
            {t('common.save')}
          </Button>
        </div>
        {saveOpen && (
          <div className="flex gap-1">
            <Input
              size="sm"
              value={saveName}
              onValueChange={setSaveName}
              placeholder={t('clean.recipeName')}
              className="flex-1"
            />
            <Button size="sm" color="primary" isLoading={savingRecipe} onPress={saveRecipe}>
              {t('common.save')}
            </Button>
          </div>
        )}
        {customRecipes.map((r) => (
          <div
            key={r.id}
            className="flex items-center justify-between rounded border border-border/60 bg-surface-elevated/40 px-2 py-1"
          >
            <span className="truncate text-[11px]">{r.name}</span>
            <div className="flex shrink-0 items-center gap-0.5">
              <Button
                isIconOnly
                size="sm"
                variant="light"
                isLoading={applying === r.id}
                onPress={() => applyRecipe(r.id, r.name)}
                aria-label={t('clean.applyRecipe', { name: r.name })}
              >
                <Play className="h-3 w-3 text-primary" />
              </Button>
              <Button
                isIconOnly
                size="sm"
                variant="light"
                onPress={() => deleteRecipe(r.id)}
                aria-label={t('clean.deleteRecipe', { name: r.name })}
              >
                <Trash2 className="h-3 w-3 text-muted" />
              </Button>
            </div>
          </div>
        ))}
        {customRecipes.length === 0 && !saveOpen && (
          <div className="text-[11px] text-muted">{t('clean.recipeHint')}</div>
        )}
      </div>

      <Modal isOpen={!!fixPlan} onClose={() => setFixPlan(null)} size="2xl" scrollBehavior="inside">
        <ModalContent>
          <ModalHeader>{t('clean.fixPreviewTitle')}</ModalHeader>
          <ModalBody className="gap-3 text-xs">
            {fixPlan && (
              <>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                  {fixPlan.issues.map((issue) => (
                    <div key={`${issue.id}-${issue.columns.join(',')}`} className="rounded border border-border p-2">
                      <div className="font-semibold">{issue.title}</div>
                      <div className="text-muted">{t('clean.affectedCount', { count: fixPlan.affected[issue.id] ?? 0 })}</div>
                    </div>
                  ))}
                </div>
                <div>
                  <div className="mb-1 font-semibold">{t('clean.operationPlan')}</div>
                  <div className="max-h-36 overflow-auto rounded border border-border p-2 font-mono text-[11px]">
                    {fixPlan.operations.map((operation, index) => (
                      <div key={`${operation.type}-${index}`}>{index + 1}. {operation.type} {JSON.stringify(operation.params)}</div>
                    ))}
                  </div>
                </div>
                <div className="flex gap-4 text-muted">
                  <span>{t('diff.rows')}: {fixPlan.diff.left_rows} → {fixPlan.diff.right_rows}</span>
                  <span>{t('diff.cols')}: {fixPlan.diff.left_cols} → {fixPlan.diff.right_cols}</span>
                </div>
                <div>
                  <div className="mb-1 font-semibold">{t('clean.resultPreview')}</div>
                  <div className="overflow-auto rounded border border-border">
                    <table className="w-full text-[11px]">
                      <thead className="bg-surface-elevated text-left text-muted">
                        <tr>{fixPlan.preview.columns.map((column) => <th key={column} className="px-2 py-1">{column}</th>)}</tr>
                      </thead>
                      <tbody>
                        {fixPlan.preview.rows.slice(0, 8).map((row, rowIndex) => (
                          <tr key={rowIndex} className="border-t border-border">
                            {row.map((value, columnIndex) => <td key={columnIndex} className="px-2 py-1">{String(value ?? '')}</td>)}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </>
            )}
          </ModalBody>
          <ModalFooter>
            <Button variant="light" onPress={() => setFixPlan(null)}>{t('common.cancel')}</Button>
            <Button color="primary" isLoading={applyingFix} onPress={applySuggestedFixes}>{t('clean.applySuggestedFixes')}</Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
    </div>
  )
}
