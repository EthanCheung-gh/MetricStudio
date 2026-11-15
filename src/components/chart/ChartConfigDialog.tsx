import { useCallback, useEffect, useRef, useState } from 'react'
import { Button, Input, Select, SelectItem } from '@heroui/react'
import { useTranslation } from 'react-i18next'
import { GripHorizontal, Save, SlidersHorizontal, Trash2, X } from 'lucide-react'
import { useChartStore } from '@/stores/chartStore'
import { useDataStore } from '@/stores/dataStore'
import { useUIStore } from '@/stores/uiStore'
import { useCustomChart, useCustomChartStore } from '@/stores/customChartStore'
import { api } from '@/api/client'
import { chartTypeOptions } from '@/utils/chartConstants'
import { chartTypeLabel, localizedCustomText } from '@/utils/chartTypeLabel'
import { resolveConfigTarget } from '@/utils/chartConfigTarget'
import {
  PANEL_EDGE_MARGIN,
  clampPanelPosition,
  defaultPanelPosition,
  type PanelPosition,
  type PanelSize,
  type PanelViewport,
} from '@/utils/panelPosition'
import { CustomChartsDialog } from '@/components/chart/CustomChartsDialog'
import { EncodingPanel } from '@/components/chart/EncodingPanel'
import type { ChartType, ChartTemplate } from '@/types/encoding'

const DIALOG_WIDTH = 680
const POS_STORAGE_KEY = 'metricstudio-chart-config-pos'

function currentViewport(): PanelViewport {
  return { width: window.innerWidth, height: window.innerHeight }
}

/**
 * Raw restore only: the stored spot is clamped against the panel's *measured*
 * size once it is in the DOM, so a position saved on a bigger screen (or an old
 * build's pointer-offset clamp) can never be restored off-screen.
 */
function loadSavedPos(): PanelPosition {
  try {
    const raw = localStorage.getItem(POS_STORAGE_KEY)
    if (raw) {
      const pos = JSON.parse(raw)
      if (typeof pos.x === 'number' && typeof pos.y === 'number') {
        return { x: pos.x, y: pos.y }
      }
    }
  } catch {
    // corrupted value — fall through to default
  }
  return defaultPanelPosition(DIALOG_WIDTH, currentViewport())
}

interface LabeledSelectProps {
  label: string
  items: { key: string; label: string }[]
  selectedKey?: string
  onSelect: (key: string | null) => void
  className?: string
}

function LabeledSelect({ label, items, selectedKey, onSelect, className = '' }: LabeledSelectProps) {
  return (
    <div className={`flex flex-col gap-0.5 ${className}`}>
      <span className="text-[10px] font-medium text-muted">{label}</span>
      <Select
        size="sm"
        selectedKeys={selectedKey ? [selectedKey] : []}
        onSelectionChange={(keys) => onSelect(Array.from(keys)[0] as string || null)}
        className="min-w-0"
        classNames={{ trigger: 'h-7 min-h-7', value: 'text-xs' }}
      >
        {items.map((item) => (
          <SelectItem key={item.key} textValue={item.label}>{item.label}</SelectItem>
        ))}
      </Select>
    </div>
  )
}

export function ChartConfigDialog() {
  const { t } = useTranslation()
  const isOpen = useUIStore((s) => s.chartConfigDialogOpen)
  const setOpen = useUIStore((s) => s.setChartConfigDialogOpen)
  const addNotification = useUIStore((s) => s.addNotification)
  const charts = useChartStore((s) => s.charts)
  const activeChartId = useChartStore((s) => s.activeChartId)
  const setActiveChart = useChartStore((s) => s.setActiveChart)
  const createChart = useChartStore((s) => s.createChart)
  const updateEncoding = useChartStore((s) => s.updateEncoding)
  const updateLayout = useChartStore((s) => s.updateLayout)
  const columns = useDataStore((s) => s.columns)
  const activeDataFrameId = useDataStore((s) => s.activeDataFrameId)
  // Never render nothing: an active-but-stale/missing chart falls back to a
  // picker, and "no charts at all" to a create action (see resolveConfigTarget).
  const target = resolveConfigTarget(charts, activeChartId)
  const activeChart = target.kind === 'ready' ? target.chart : null

  // Declarative custom charts (backend-owned manifests under ~/.metricstudio/charts)
  const language = useUIStore((s) => s.language)
  const customCharts = useCustomChartStore((s) => s.items)
  const customChart = useCustomChart(activeChart?.encoding.chartType ?? '')
  const [manageOpen, setManageOpen] = useState(false)

  // Chart templates (persisted server-side under ~/.metricstudio/templates)
  const [templates, setTemplates] = useState<ChartTemplate[]>([])
  const [selectedTemplateId, setSelectedTemplateId] = useState('')
  const [templateName, setTemplateName] = useState('')
  const [templateBusy, setTemplateBusy] = useState(false)

  useEffect(() => {
    if (!isOpen) return
    api.listTemplates().then(setTemplates).catch(() => setTemplates([]))
  }, [isOpen])

  // Draggable floating panel state (lazy init: restore last saved position)
  const [pos, setPos] = useState(loadSavedPos)
  const posRef = useRef(pos)
  const dragOffset = useRef<{ dx: number; dy: number } | null>(null)
  const panelRef = useRef<HTMLDivElement>(null)

  /** Single writer for the panel position, keeping the ref in sync for the
   *  effects/pointer handlers that must not read a stale render. */
  const moveTo = useCallback((next: PanelPosition) => {
    posRef.current = next
    setPos(next)
  }, [])

  /** The panel's own rendered box — never a hardcoded width constant. */
  const measurePanel = useCallback((): PanelSize | null => {
    const rect = panelRef.current?.getBoundingClientRect()
    if (!rect || rect.width <= 0) return null
    return { width: rect.width, height: rect.height }
  }, [])

  const clampToViewport = useCallback(
    (next: PanelPosition): PanelPosition => {
      const size = measurePanel()
      if (!size) return next
      return clampPanelPosition(next, size, currentViewport(), PANEL_EDGE_MARGIN)
    },
    [measurePanel],
  )

  // First measure after (re)opening + on every viewport resize. A spot that no
  // longer fits falls back to the default dock instead of being restored
  // off-screen (the panel is "open" but invisible → 图表配置 looks dead).
  useEffect(() => {
    if (!isOpen) return
    const current = posRef.current
    const fitted = clampToViewport(current)
    if (fitted.x !== current.x || fitted.y !== current.y) {
      const width = measurePanel()?.width ?? DIALOG_WIDTH
      moveTo(clampToViewport(defaultPanelPosition(width, currentViewport())))
    } else {
      moveTo(fitted)
    }
    const onResize = () => moveTo(clampToViewport(posRef.current))
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [isOpen, clampToViewport, measurePanel, moveTo])

  const onHeaderPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    dragOffset.current = { dx: e.clientX - pos.x, dy: e.clientY - pos.y }
    e.currentTarget.setPointerCapture(e.pointerId)
  }
  const onHeaderPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragOffset.current) return
    // Clamped on every move, so a drag can never park the panel off-screen.
    moveTo(
      clampToViewport({
        x: e.clientX - dragOffset.current.dx,
        y: e.clientY - dragOffset.current.dy,
      }),
    )
  }
  const onHeaderPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (dragOffset.current) {
      // Save the clamped position: a stored spot is always a visible one.
      const final = clampToViewport(posRef.current)
      moveTo(final)
      try {
        localStorage.setItem(POS_STORAGE_KEY, JSON.stringify(final))
      } catch {
        // storage full/blocked — position simply won't persist
      }
    }
    dragOffset.current = null
    e.currentTarget.releasePointerCapture(e.pointerId)
  }

  if (!isOpen) {
    return null
  }

  const onClose = () => setOpen(false)

  // Ready-state only: an empty/pick panel shows none of this.
  const encoding = activeChart?.encoding ?? null
  // Unknown ids (project saved by a newer build, or a plugin type) have no i18n
  // copy — fall back to the registry label (the bare id) instead of leaking the
  // raw key "chart.type.whatever" into the title. Custom chart ids resolve to
  // their manifest label first.
  const typeLabel = encoding ? chartTypeLabel(encoding.chartType, language, t) : ''
  // A custom chart describes itself; built-ins keep their i18n copy.
  const typeDescription = encoding
    ? customChart
      ? localizedCustomText(customChart.description, language)
      : t(`chart.desc.${encoding.chartType}`, { defaultValue: '' })
    : ''

  const applyTemplate = () => {
    const chart = activeChart
    if (!chart) return
    const tpl = templates.find((t) => t.id === selectedTemplateId)
    if (!tpl) return
    updateEncoding(chart.id, tpl.encoding)
    if (tpl.layout && Object.keys(tpl.layout).length > 0) {
      updateLayout(chart.id, tpl.layout)
    }
    addNotification('success', t('chart.templateApplied', { name: tpl.name }))
  }

  const saveAsTemplate = async () => {
    const chart = activeChart
    if (!chart) return
    const name = templateName.trim()
    if (!name) return
    setTemplateBusy(true)
    try {
      const saved = await api.saveTemplate(name, chart.encoding, chart.layout)
      setTemplates((prev) => [...prev, saved])
      setTemplateName('')
      addNotification('success', t('chart.templateSaved', { name }))
    } catch (err) {
      addNotification('error', err instanceof Error ? err.message : t('chart.saveTemplateFailed'))
    } finally {
      setTemplateBusy(false)
    }
  }

  const deleteTemplate = async () => {
    const tpl = templates.find((t) => t.id === selectedTemplateId)
    if (!tpl) return
    setTemplateBusy(true)
    try {
      await api.deleteTemplate(tpl.id)
      setTemplates((prev) => prev.filter((t) => t.id !== tpl.id))
      setSelectedTemplateId('')
      addNotification('success', t('chart.templateDeleted', { name: tpl.name }))
    } catch (err) {
      addNotification('error', err instanceof Error ? err.message : t('chart.deleteTemplateFailed'))
    } finally {
      setTemplateBusy(false)
    }
  }

  // Create from the empty state: no dataset means no chart (the button is
  // disabled and the hint below it says why).
  const createNewChart = () => {
    if (!activeDataFrameId) return
    createChart(activeDataFrameId)
  }

  return (
    <>
    <div
      ref={panelRef}
      className="fixed z-50 flex max-h-[85vh] flex-col overflow-hidden rounded-lg border border-border bg-surface-elevated shadow-2xl"
      style={{ left: pos.x, top: pos.y, width: DIALOG_WIDTH, maxWidth: 'calc(100vw - 32px)' }}
      role="dialog"
      aria-label={t('chart.configTitle')}
    >
      {/* Drag handle header */}
      <div
        className="flex cursor-move select-none items-center justify-between border-b border-border px-4 py-2.5 touch-none"
        onPointerDown={onHeaderPointerDown}
        onPointerMove={onHeaderPointerMove}
        onPointerUp={onHeaderPointerUp}
      >
        <div className="flex items-center gap-2 text-sm font-semibold">
          <GripHorizontal className="h-4 w-4 text-muted" />
          <span>{t('chart.configTitle')}</span>
          {activeChart && <span className="text-sm font-normal text-muted">— {activeChart.name}</span>}
        </div>
        <Button
          isIconOnly
          size="sm"
          variant="light"
          className="h-6 w-6 min-w-0"
          onPress={onClose}
          aria-label={t('chart.close')}
          onPointerDown={(e) => e.stopPropagation()}
        >
          <X className="h-4 w-4" />
        </Button>
      </div>

      {activeChart ? (
      <div className="flex flex-1 min-h-0 flex-col overflow-hidden p-4 pb-6">
          {/* Height constraint travels via flex-1/min-h-0 the whole way down (never %: the root only has max-h) */}
          <div className="flex flex-1 min-h-0 gap-4">
            {/* Left: Chart Type (scrolls independently from the config column) */}
            <div className="w-36 shrink-0 overflow-y-auto pr-1">
              <div className="mb-2 flex items-center justify-between">
                <span className="text-xs font-semibold text-muted">{t('chart.chartType')}</span>
                <Button
                  isIconOnly
                  size="sm"
                  variant="light"
                  className="h-5 w-5 min-w-0"
                  aria-label={t('chart.custom.manage')}
                  onPress={() => setManageOpen(true)}
                >
                  <SlidersHorizontal className="h-3 w-3" />
                </Button>
              </div>
              <div className="flex flex-col gap-1">
                {chartTypeOptions.map((opt) => (
                  <Button
                    key={opt.value}
                    size="sm"
                    variant={activeChart.encoding.chartType === opt.value ? 'solid' : 'flat'}
                    color={activeChart.encoding.chartType === opt.value ? 'primary' : 'default'}
                    onPress={() => updateEncoding(activeChart.id, { chartType: opt.value as ChartType })}
                    className="justify-start text-xs"
                  >
                    {t(`chart.type.${opt.value}`)}
                  </Button>
                ))}
              </div>
              {customCharts.length > 0 && (
                <div className="mt-2 flex flex-col gap-1 border-t border-border pt-1.5">
                  <span className="text-[10px] font-semibold uppercase tracking-wide text-muted">
                    {t('chart.custom.group')}
                  </span>
                  {customCharts.map((item) => (
                    <Button
                      key={item.id}
                      size="sm"
                      variant={activeChart.encoding.chartType === item.id ? 'solid' : 'flat'}
                      color={activeChart.encoding.chartType === item.id ? 'primary' : 'default'}
                      onPress={() => updateEncoding(activeChart.id, { chartType: item.id as ChartType })}
                      className="justify-start text-xs"
                    >
                      {chartTypeLabel(item.id, language, t)}
                    </Button>
                  ))}
                </div>
              )}
            </div>

            {/* Right: Configuration (scrolls independently from the type list) */}
            <div className="flex-1 min-h-0 min-w-0 overflow-y-auto pl-1 pr-1">
              {/* Selected chart type summary — fills the otherwise empty area and orients new users */}
              <div className="mb-4 rounded border border-border bg-surface p-3">
                <div className="text-xs font-semibold">{typeLabel}</div>
                <p className="mt-1 text-[11px] leading-relaxed text-muted">{typeDescription}</p>
              </div>

              {/* Templates */}
              <div className="mb-4">
                <span className="text-xs font-semibold text-muted mb-2 block">{t('chart.templates')}</span>
                <div className="flex items-end gap-1.5">
                  <LabeledSelect
                    label={t('chart.savedTemplates')}
                    items={templates.map((t) => ({ key: t.id, label: t.name }))}
                    selectedKey={selectedTemplateId || undefined}
                    onSelect={(id) => setSelectedTemplateId(id || '')}
                    className="flex-1 min-w-0"
                  />
                  <Button
                    size="sm"
                    variant="flat"
                    className="h-7 shrink-0 text-xs"
                    isDisabled={!selectedTemplateId}
                    onPress={applyTemplate}
                  >
                    {t('chart.apply')}
                  </Button>
                  <Button
                    isIconOnly
                    size="sm"
                    variant="light"
                    color="danger"
                    className="h-7 w-7 min-w-0 shrink-0"
                    isDisabled={!selectedTemplateId || templateBusy}
                    onPress={deleteTemplate}
                    aria-label={t('chart.deleteTemplate')}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
                <div className="mt-1.5 flex items-center gap-1.5">
                  <Input
                    size="sm"
                    placeholder={t('chart.templateName')}
                    value={templateName}
                    onValueChange={setTemplateName}
                    className="flex-1"
                    classNames={{ input: 'text-xs', inputWrapper: 'h-7 min-h-7' }}
                  />
                  <Button
                    size="sm"
                    variant="flat"
                    color="primary"
                    className="h-7 shrink-0 text-xs"
                    isLoading={templateBusy}
                    isDisabled={!templateName.trim()}
                    startContent={!templateBusy && <Save className="h-3 w-3" />}
                    onPress={saveAsTemplate}
                  >
                    {t('chart.saveCurrent')}
                  </Button>
                </div>
              </div>

              {/* Registry-driven encoding config: channels vary per chart type */}
              <EncodingPanel chart={activeChart} columns={columns} />
            </div>
          </div>
      </div>
      ) : (
        /* Same shell, same measured clamping — just no chart to configure yet */
        <div className="flex flex-col gap-3 p-4 pb-5">
          <p className="text-xs leading-relaxed text-muted">
            {t('chart.config.noActiveChart', { defaultValue: 'No chart is selected yet.' })}
          </p>
          {target.kind === 'pick' && (
            <>
              <span className="text-[10px] font-semibold uppercase tracking-wide text-muted">
                {t('chart.config.pickChart', { defaultValue: 'Pick a chart to configure' })}
              </span>
              <div className="flex max-h-64 flex-col gap-1 overflow-y-auto pr-1">
                {target.charts.map((chart) => (
                  <Button
                    key={chart.id}
                    size="sm"
                    variant="flat"
                    className="justify-start text-xs"
                    onPress={() => setActiveChart(chart.id)}
                  >
                    {chart.name}
                  </Button>
                ))}
              </div>
            </>
          )}
          <div className="flex flex-col gap-1 border-t border-border pt-2">
            <Button
              color="primary"
              size="sm"
              className="self-start text-xs"
              isDisabled={!activeDataFrameId}
              onPress={createNewChart}
            >
              {t('chart.config.createChart', { defaultValue: 'New chart' })}
            </Button>
            {!activeDataFrameId && (
              <span className="text-[10px] text-muted">
                {t('chart.config.noDataset', { defaultValue: 'Select a dataset first to create a chart.' })}
              </span>
            )}
          </div>
        </div>
      )}
      <div className="flex justify-end gap-2 border-t border-border p-3">
        <Button color="primary" size="sm" onPress={onClose}>
          {t('chart.done')}
        </Button>
      </div>
    </div>
    <CustomChartsDialog open={manageOpen} onOpenChange={setManageOpen} />
    </>
  )
}
