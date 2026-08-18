import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useChartStore } from '@/stores/chartStore'
import { useDataStore } from '@/stores/dataStore'
import { PlotlyRenderer, type PlotlySelection } from './PlotlyRenderer'
import { Button, Card, CardBody, Input } from '@heroui/react'
import { Download, Image, FileCode, FileText, Filter, Lightbulb, Sparkles, X } from 'lucide-react'
import { useUIStore } from '@/stores/uiStore'
import { api } from '@/api/client'
import { applyPlotlyUserStyle } from '@/utils/plotlyLayout'

declare const Plotly: {
  toImage: (el: HTMLElement, opts: { format: string; height: number; width: number }) => Promise<string>
}

export function ChartCanvas() {
  const { t } = useTranslation()
  const activeChartId = useChartStore((s) => s.activeChartId)
  const charts = useChartStore((s) => s.charts)
  const previewFigure = useChartStore((s) => s.previewFigure)
  const selection = useChartStore((s) => s.selection)
  const setSelection = useChartStore((s) => s.setSelection)
  const clearSelection = useChartStore((s) => s.clearSelection)
  const updateName = useChartStore((s) => s.updateName)
  const updateLayout = useChartStore((s) => s.updateLayout)
  const addNotification = useUIStore((s) => s.addNotification)
  const setReportDialogOpen = useUIStore((s) => s.setReportDialogOpen)
  const [explanation, setExplanation] = useState('')
  const [explaining, setExplaining] = useState(false)
  const [annotating, setAnnotating] = useState(false)

  useEffect(() => {
    setExplanation('')
  }, [activeChartId])

  const activeChart = charts.find((c) => c.id === activeChartId)
  const dataVersion = useDataStore((state) => activeChart ? state.dataVersions[activeChart.datasetId] || 0 : 0)

  useEffect(() => {
    if (activeChart) useChartStore.getState().previewChart(activeChart.datasetId, activeChart.encoding, activeChart.id)
  }, [activeChart, dataVersion])

  const handleExplain = async () => {
    if (!activeChart) return
    setExplaining(true)
    setExplanation('')
    try {
      const res = await api.explainChart(activeChart.datasetId, activeChart.encoding)
      setExplanation(res.explanation)
    } catch (err) {
      addNotification('error', err instanceof Error ? err.message : t('chart.explainFailed'))
    } finally {
      setExplaining(false)
    }
  }

  const handleAnnotateInsights = async () => {
    if (!activeChart) return
    setAnnotating(true)
    try {
      const { insights } = await api.insights(activeChart.datasetId, useUIStore.getState().language)
      if (!insights || insights.length === 0) {
        addNotification('info', t('chart.noInsights'))
        return
      }
      const existing = (activeChart.layout.annotations as Record<string, unknown>[]) || []
      const newAnnotations = insights.slice(0, 2).map((ins, i) => ({
        text: ins.text,
        xref: 'paper',
        yref: 'paper',
        x: 0,
        y: 1.08 + i * 0.07,
        xanchor: 'left',
        showarrow: false,
        font: { size: 11, color: '#9aa0a6' },
      }))
      updateLayout(activeChart.id, { annotations: [...existing, ...newAnnotations] })
      addNotification('success', t('chart.insightsAnnotated'))
    } catch (err) {
      addNotification('error', err instanceof Error ? err.message : t('chart.annotateFailed'))
    } finally {
      setAnnotating(false)
    }
  }

  const handleSelected = (sel: PlotlySelection) => {
    if (!activeChart) return
    setSelection({
      chartId: activeChart.id,
      sourceName: activeChart.name,
      xField: activeChart.encoding.x?.field,
      yField: activeChart.encoding.yFields?.[0]?.field,
      xRange: sel.xRange,
      yRange: sel.yRange,
    })
  }

  const handleExportHtml = async () => {
    if (!previewFigure) return
    try {
      const figure = applyPlotlyUserStyle(previewFigure, activeChart?.layout)
      const { html } = await api.exportHtml(figure)
      const blob = new Blob([html], { type: 'text/html' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = 'chart.html'
      a.click()
      URL.revokeObjectURL(url)
      addNotification('success', t('chart.htmlExported'))
    } catch (err) {
      addNotification('error', err instanceof Error ? err.message : t('chart.exportFailed'))
    }
  }

  const handleExportPng = async () => {
    if (!previewFigure) return
    try {
      const container = document.querySelector('.js-plotly-plot') as HTMLElement | null
      if (!container) return
      const url = await Plotly.toImage(container, {
        format: 'png',
        height: 600,
        width: 800,
      })
      if (!url) return
      const a = document.createElement('a')
      a.href = url
      a.download = 'chart.png'
      a.click()
      addNotification('success', t('chart.pngExported'))
    } catch (err) {
      addNotification('error', err instanceof Error ? err.message : t('chart.exportFailed'))
    }
  }

  const handleExportJson = () => {
    if (!previewFigure) return
    try {
      const json = JSON.stringify(applyPlotlyUserStyle(previewFigure, activeChart?.layout), null, 2)
      const blob = new Blob([json], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = 'chart.json'
      a.click()
      URL.revokeObjectURL(url)
      addNotification('success', t('chart.jsonExported'))
    } catch (err) {
      addNotification('error', err instanceof Error ? err.message : t('chart.exportFailed'))
    }
  }

  return (
    <div className="flex h-full flex-col gap-2">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          {activeChart ? (
            <Input
              size="sm"
              value={activeChart.name}
              onValueChange={(v) => updateName(activeChart.id, v)}
              className="w-48"
            />
          ) : (
            <span className="text-sm text-muted">{t('chart.noChartSelected')}</span>
          )}
        </div>
        <div className="flex items-center gap-1">
          {selection && (
            <div className="mr-1 flex items-center gap-1 rounded bg-primary/15 px-2 py-1 text-[11px] text-primary">
              <Filter className="h-3 w-3" />
              {selection.chartId === activeChartId ? (
                <span>{t('chart.selectionSource')}</span>
              ) : (
                <span>{t('chart.filteredBy', { name: selection.sourceName })}</span>
              )}
              <button
                className="ml-0.5 rounded p-0.5 hover:bg-primary/20"
                onClick={clearSelection}
                aria-label={t('chart.clearSelection')}
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          )}
          <Button
            isIconOnly size="sm" variant="light"
            isDisabled={!activeChart || !previewFigure}
            isLoading={explaining}
            onPress={handleExplain}
            aria-label={t('chart.aiExplain')}
          >
            <Sparkles className="h-4 w-4" />
          </Button>
          <Button
            isIconOnly size="sm" variant="light"
            isDisabled={!activeChart || !previewFigure}
            isLoading={annotating}
            onPress={handleAnnotateInsights}
            aria-label={t('chart.annotateInsights')}
          >
            <Lightbulb className="h-4 w-4" />
          </Button>
          <Button
            isIconOnly size="sm" variant="light"
            isDisabled={charts.length === 0}
            onPress={() => setReportDialogOpen(true)}
            aria-label={t('cmd.generateReport')}
          >
            <FileText className="h-4 w-4" />
          </Button>
          <Button
            isIconOnly size="sm" variant="light"
            isDisabled={!previewFigure}
            onPress={handleExportHtml}
            aria-label={t('chart.exportHtml')}
          >
            <FileCode className="h-4 w-4" />
          </Button>
          <Button
            isIconOnly size="sm" variant="light"
            isDisabled={!previewFigure}
            onPress={handleExportPng}
            aria-label={t('chart.exportPng')}
          >
            <Image className="h-4 w-4" />
          </Button>
          <Button
            isIconOnly size="sm" variant="light"
            isDisabled={!previewFigure}
            onPress={handleExportJson}
            aria-label={t('chart.exportJson')}
          >
            <Download className="h-4 w-4" />
          </Button>
        </div>
      </div>
      <Card className="flex-1 border-border bg-surface">
        <CardBody className="h-full p-0">
          <PlotlyRenderer
            key={activeChartId || 'no-chart'}
            figure={previewFigure}
            userLayout={activeChart?.layout}
            className="h-full w-full"
            onSelected={handleSelected}
            onClearSelection={clearSelection}
          />
        </CardBody>
      </Card>
      {explanation && (
        <Card className="border-border bg-surface">
          <CardBody className="flex-row items-start gap-2 p-3">
            <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
            <p className="flex-1 whitespace-pre-wrap text-sm">{explanation}</p>
            <button
              className="rounded p-0.5 text-muted hover:bg-surface-elevated"
              onClick={() => setExplanation('')}
              aria-label={t('chart.dismissExplain')}
            >
              <X className="h-4 w-4" />
            </button>
          </CardBody>
        </Card>
      )}
    </div>
  )
}
