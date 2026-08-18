import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { BarChart3, Lightbulb, LineChart, Link2, PieChart, Sparkles, TrendingUp, AlertTriangle, RefreshCw } from 'lucide-react'
import { Button } from '@heroui/react'
import { api } from '@/api/client'
import { useDataStore, type TsResult } from '@/stores/dataStore'
import { useUIStore } from '@/stores/uiStore'

interface Insight {
  type: string
  text: string
  evidence: Record<string, unknown>
}

const ICONS: Record<string, React.ReactNode> = {
  trend: <TrendingUp className="h-3.5 w-3.5" />,
  concentration: <PieChart className="h-3.5 w-3.5" />,
  skew: <BarChart3 className="h-3.5 w-3.5" />,
  correlation: <Link2 className="h-3.5 w-3.5" />,
  missing: <AlertTriangle className="h-3.5 w-3.5" />,
}

export function InsightsPanel() {
  const { t } = useTranslation();
  const activeDataFrameId = useDataStore((s) => s.activeDataFrameId)
  const language = useUIStore((s) => s.language)
  const [insights, setInsights] = useState<Insight[] | null>(null)
  const narrative = useDataStore((s) => (activeDataFrameId ? (s.narratives[activeDataFrameId] ?? null) : null))
  const tsResult = useDataStore((s) => (activeDataFrameId ? (s.tsResults[activeDataFrameId] ?? null) : null))
  const [narrating, setNarrating] = useState(false)
  const [tsLoading, setTsLoading] = useState(false)
  const [loading, setLoading] = useState(false)
  const columns = useDataStore((s) => s.columns)

  const narrate = async () => {
    if (!activeDataFrameId) return
    setNarrating(true)
    try {
      const { narrative } = await api.nlNarrate(activeDataFrameId)
      useDataStore.getState().setNarrative(activeDataFrameId, narrative)
    } catch {
      useDataStore.getState().setNarrative(activeDataFrameId, t('insight.narrateFailed'))
    } finally {
      setNarrating(false)
    }
  }

  const analyzeTs = async () => {
    if (!activeDataFrameId) return
    const numericCol = columns.find((c) => c.inferredType === 'quantitative')
    if (!numericCol) return
    setTsLoading(true)
    try {
      useDataStore.getState().setTsResult(activeDataFrameId, (await api.timeseries(activeDataFrameId, numericCol.name)) as TsResult)
    } catch {
      useDataStore.getState().setTsResult(activeDataFrameId, { ok: false })
    } finally {
      setTsLoading(false)
    }
  }

  const load = useCallback(async () => {
    if (!activeDataFrameId) return
    setLoading(true)
    try {
      const body = await api.insights(activeDataFrameId, language)
      setInsights(body.insights)
    } catch {
      /* ignore */
    } finally {
      setLoading(false)
    }
  }, [activeDataFrameId, language])

  useEffect(() => {
    setInsights(null)
    load()
  }, [load])

  if (!activeDataFrameId) return null

  return (
    <div className="flex flex-col gap-2 rounded border border-border bg-surface p-2">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1 text-xs font-semibold text-muted">
          <Lightbulb className="h-3.5 w-3.5" />
          {t('panel.insights')}
        </div>
        <div className="flex items-center gap-1">
          <Button
            size="sm"
            variant="light"
            isLoading={tsLoading}
            startContent={<LineChart className="h-3 w-3" />}
            onPress={analyzeTs}
          >
            {t('ai.mom')}
          </Button>
          <Button
            size="sm"
            variant="light"
            isLoading={narrating}
            startContent={<Sparkles className="h-3 w-3" />}
            onPress={narrate}
          >
            {t('ai.narrate')}
          </Button>
          <Button isIconOnly size="sm" variant="light" isLoading={loading} onPress={load} aria-label={t('insight.refresh')}>
            <RefreshCw className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      {tsResult && tsResult.ok && tsResult.periods && (
        <div className="rounded border border-border/60 bg-surface-elevated/40 p-2">
          <div className="mb-1 text-[10px] font-semibold uppercase text-muted">{t('insight.monthlyMom')}</div>
          {tsResult.periods.map((p, i) => (
            <div key={p} className="flex items-center justify-between text-[11px]">
              <span className="text-muted">{p}</span>
              <span>{tsResult.values?.[i]}</span>
              <span className={tsResult.pct_change?.[i] !== null && tsResult.pct_change?.[i] !== undefined && (tsResult.pct_change?.[i] ?? 0) >= 0 ? 'text-success' : 'text-danger'}>
                {tsResult.pct_change?.[i] !== null && tsResult.pct_change?.[i] !== undefined ? tsResult.pct_change?.[i] + '%' : '—'}
              </span>
            </div>
          ))}
        </div>
      )}

      {narrative && (
        <div className="rounded border border-primary/30 bg-primary/10 p-2 text-[11px] leading-relaxed">
          {narrative}
        </div>
      )}

      {loading && !insights && <div className="text-[11px] text-muted">{t('insight.analyzing')}</div>}

      {insights && insights.length === 0 && (
        <div className="text-[11px] text-muted">{t('insight.empty')}</div>
      )}

      {insights &&
        insights.map((insight, idx) => (
          <div key={`${insight.type}-${idx}`} className="rounded border border-border/60 bg-surface-elevated/40 p-2">
            <div className="flex items-start gap-1.5">
              <span className="mt-0.5 text-primary">{ICONS[insight.type] ?? <Lightbulb className="h-3.5 w-3.5" />}</span>
              <p className="text-[11px] leading-snug">{insight.text}</p>
            </div>
            <div className="ml-5 mt-1 font-mono text-[10px] text-muted">
              {Object.entries(insight.evidence)
                .map(([k, v]) => `${k}=${v}`)
                .join('  ')}
            </div>
          </div>
        ))}
    </div>
  )
}
