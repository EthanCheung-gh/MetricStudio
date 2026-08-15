import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { AlertTriangle, CheckCircle2, Play, RefreshCw, Save, Sparkles, Trash2 } from 'lucide-react'
import { Button, Input } from '@heroui/react'
import { api } from '@/api/client'
import { useDataStore } from '@/stores/dataStore'
import { useUIStore } from '@/stores/uiStore'
import type { QualityReport, UserRecipe } from '@/types/data'

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
          数据清洗
        </div>
        <Button isIconOnly size="sm" variant="light" isLoading={loading} onPress={load} aria-label="Refresh quality report">
          <RefreshCw className="h-3.5 w-3.5" />
        </Button>
      </div>

      {loading && !report && <div className="text-[11px] text-muted">扫描中…</div>}

      {report && report.issues.length === 0 && (
        <div className="flex items-center gap-1.5 text-[11px] text-success">
          <CheckCircle2 className="h-3.5 w-3.5" />
          未发现问题
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
          </div>
        ))}

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
            保存
          </Button>
        </div>
        {saveOpen && (
          <div className="flex gap-1">
            <Input
              size="sm"
              value={saveName}
              onValueChange={setSaveName}
              placeholder="配方名称"
              className="flex-1"
            />
            <Button size="sm" color="primary" isLoading={savingRecipe} onPress={saveRecipe}>
              保存
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
                aria-label={`Apply ${r.name}`}
              >
                <Play className="h-3 w-3 text-primary" />
              </Button>
              <Button
                isIconOnly
                size="sm"
                variant="light"
                onPress={() => deleteRecipe(r.id)}
                aria-label={`Delete ${r.name}`}
              >
                <Trash2 className="h-3 w-3 text-muted" />
              </Button>
            </div>
          </div>
        ))}
        {customRecipes.length === 0 && !saveOpen && (
          <div className="text-[11px] text-muted">将变换链保存为可复用配方</div>
        )}
      </div>
    </div>
  )
}
