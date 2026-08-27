import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Sigma, Table2, TrendingUp } from 'lucide-react'
import { Button, Select, SelectItem } from '@heroui/react'
import { api } from '@/api/client'
import { useDataStore } from '@/stores/dataStore'

interface CorrelationResult {
  ok: boolean
  reason?: string
  columns?: string[]
  matrix?: (number | null)[][]
  pairs?: { x: string; y: string; r: number; text: string }[]
}

interface RegressionResult {
  ok: boolean
  detail?: string
  n?: number
  slope?: number
  intercept?: number
  r_squared?: number | null
  p_value?: number | null
  interpretation?: string
}

function corrColor(r: number | null): string {
  if (r === null) return ''
  const alpha = Math.min(Math.abs(r), 1)
  return r >= 0 ? `rgba(59,130,246,${alpha})` : `rgba(239,68,68,${alpha})`
}

export function StatsPanel() {
  const { t } = useTranslation()
  const activeDataFrameId = useDataStore((s) => s.activeDataFrameId)
  const columns = useDataStore((s) => s.columns)
  const numericColumns = columns.filter((c) => c.inferredType === 'quantitative')
  const [corr, setCorr] = useState<CorrelationResult | null>(null)
  const [regression, setRegression] = useState<RegressionResult | null>(null)
  const [xCol, setXCol] = useState('')
  const [yCol, setYCol] = useState('')
  const [loadingCorr, setLoadingCorr] = useState(false)
  const [loadingReg, setLoadingReg] = useState(false)

  const loadCorrelation = useCallback(async () => {
    if (!activeDataFrameId) return
    setLoadingCorr(true)
    try {
      setCorr(await api.correlation(activeDataFrameId))
    } catch {
      setCorr({ ok: false })
    } finally {
      setLoadingCorr(false)
    }
  }, [activeDataFrameId])

  useEffect(() => {
    setCorr(null)
    setRegression(null)
    if (numericColumns.length >= 2) {
      void loadCorrelation()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeDataFrameId])

  const runRegression = async () => {
    if (!activeDataFrameId || !xCol || !yCol || xCol === yCol) return
    setLoadingReg(true)
    try {
      setRegression(await api.regression(activeDataFrameId, xCol, yCol))
    } catch (err) {
      setRegression({ ok: false, detail: err instanceof Error ? err.message : '' })
    } finally {
      setLoadingReg(false)
    }
  }

  if (!activeDataFrameId) return null

  return (
    <div className="flex flex-col gap-2 text-xs">
      <div className="flex items-center gap-1 font-semibold text-muted">
        <Sigma className="h-3.5 w-3.5" />
        {t('stats.title')}
      </div>

      {loadingCorr && <div className="text-[11px] text-muted">{t('insight.analyzing')}</div>}

      {/* Correlation matrix heatmap */}
      {corr?.ok && corr.columns && (
        <div className="rounded border border-border/60 bg-surface-elevated/40 p-2">
          <div className="mb-1 flex items-center gap-1 text-[10px] font-semibold uppercase text-muted">
            <Table2 className="h-3 w-3" /> {t('stats.correlation')}
          </div>
          <div className="overflow-auto">
            <table className="text-[10px]">
              <thead>
                <tr>
                  <th />
                  {corr.columns.map((c) => (
                    <th key={c} className="max-w-[48px] truncate px-1 pb-1 text-muted" title={c}>{c}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {corr.matrix!.map((row, i) => (
                  <tr key={corr.columns![i]}>
                    <td className="max-w-[56px] truncate pr-1 text-right text-muted" title={corr.columns![i]}>{corr.columns![i]}</td>
                    {row.map((value, j) => (
                      <td
                        key={j}
                        className="h-7 w-8 text-center"
                        style={{ backgroundColor: i === j ? undefined : corrColor(value) }}
                        title={`${corr.columns![i]} vs ${corr.columns![j]}: ${value ?? '—'}`}
                      >
                        <span className={value !== null && Math.abs(value) > 0.6 ? 'font-semibold' : 'text-muted'}>
                          {i === j ? '' : value}
                        </span>
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {corr.pairs && corr.pairs.length > 0 && (
            <ul className="mt-2 space-y-0.5 text-[10px] leading-snug text-muted">
              {corr.pairs.slice(0, 4).map((pair) => (
                <li key={`${pair.x}-${pair.y}`}>• {pair.text}</li>
              ))}
            </ul>
          )}
        </div>
      )}
      {corr && !corr.ok && <div className="text-[11px] text-muted">{corr.reason ?? t('insight.empty')}</div>}

      {/* Linear regression */}
      <div className="rounded border border-border/60 bg-surface-elevated/40 p-2">
        <div className="mb-1 flex items-center gap-1 text-[10px] font-semibold uppercase text-muted">
          <TrendingUp className="h-3 w-3" /> {t('stats.regression')}
        </div>
        <div className="flex items-center gap-1">
          <Select size="sm" aria-label={t('stats.x')} selectedKeys={xCol ? [xCol] : []} onSelectionChange={(keys) => { const v = [...keys][0]; if (v) setXCol(String(v)) }}>
            {numericColumns.map((c) => (
              <SelectItem key={c.name}>{c.name}</SelectItem>
            ))}
          </Select>
          <span className="shrink-0 text-muted">~</span>
          <Select size="sm" aria-label={t('stats.y')} selectedKeys={yCol ? [yCol] : []} onSelectionChange={(keys) => { const v = [...keys][0]; if (v) setYCol(String(v)) }}>
            {numericColumns.map((c) => (
              <SelectItem key={c.name}>{c.name}</SelectItem>
            ))}
          </Select>
          <Button isIconOnly size="sm" color="primary" variant="flat" isLoading={loadingReg} onPress={runRegression} aria-label={t('stats.run')}>
            <Sigma className="h-3.5 w-3.5" />
          </Button>
        </div>
        {regression?.ok ? (
          <div className="mt-2 space-y-1 text-[11px]">
            <p className="leading-snug">{regression.interpretation}</p>
            <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 font-mono text-[10px] text-muted">
              <span>n={regression.n}</span>
              <span>slope={regression.slope}</span>
              <span>R²={regression.r_squared}</span>
              <span>p={regression.p_value}</span>
            </div>
          </div>
        ) : regression ? (
          <div className="mt-2 text-[11px] text-danger">{regression.detail}</div>
        ) : null}
      </div>

      {numericColumns.length < 2 && (
        <div className="text-[11px] text-muted">{t('stats.needsNumeric')}</div>
      )}
    </div>
  )
}
