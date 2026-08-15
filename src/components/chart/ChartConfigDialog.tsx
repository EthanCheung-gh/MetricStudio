import { useEffect, useRef, useState } from 'react'
import { Button, Input, Select, SelectItem } from '@heroui/react'
import { GripHorizontal, Save, Trash2, X } from 'lucide-react'
import { useChartStore } from '@/stores/chartStore'
import { useDataStore } from '@/stores/dataStore'
import { useUIStore } from '@/stores/uiStore'
import { api } from '@/api/client'
import { chartTypeOptions } from '@/utils/encodingToPlotly'
import { EncodingPanel } from '@/components/chart/EncodingPanel'
import type { ChartType, ChartTemplate } from '@/types/encoding'

const DIALOG_WIDTH = 680
const POS_STORAGE_KEY = 'metricstudio-chart-config-pos'

function loadSavedPos(): { x: number; y: number } {
  try {
    const raw = localStorage.getItem(POS_STORAGE_KEY)
    if (raw) {
      const pos = JSON.parse(raw)
      if (typeof pos.x === 'number' && typeof pos.y === 'number') {
        // Clamp into current viewport in case the window was resized
        return {
          x: Math.min(Math.max(0, pos.x), Math.max(0, window.innerWidth - 120)),
          y: Math.min(Math.max(0, pos.y), Math.max(0, window.innerHeight - 60)),
        }
      }
    }
  } catch {
    // corrupted value — fall through to default
  }
  return { x: Math.max(16, window.innerWidth - DIALOG_WIDTH - 60), y: 72 }
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
  const isOpen = useUIStore((s) => s.chartConfigDialogOpen)
  const setOpen = useUIStore((s) => s.setChartConfigDialogOpen)
  const addNotification = useUIStore((s) => s.addNotification)
  const charts = useChartStore((s) => s.charts)
  const activeChartId = useChartStore((s) => s.activeChartId)
  const updateEncoding = useChartStore((s) => s.updateEncoding)
  const updateLayout = useChartStore((s) => s.updateLayout)
  const columns = useDataStore((s) => s.columns)
  const activeChart = charts.find((c) => c.id === activeChartId)

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
  const dragOffset = useRef<{ dx: number; dy: number } | null>(null)
  const panelRef = useRef<HTMLDivElement>(null)

  const onHeaderPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    dragOffset.current = { dx: e.clientX - pos.x, dy: e.clientY - pos.y }
    e.currentTarget.setPointerCapture(e.pointerId)
  }
  const onHeaderPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragOffset.current) return
    const maxX = window.innerWidth - 120
    const maxY = window.innerHeight - 60
    setPos({
      x: Math.min(Math.max(0, e.clientX - dragOffset.current.dx), maxX),
      y: Math.min(Math.max(0, e.clientY - dragOffset.current.dy), maxY),
    })
  }
  const onHeaderPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (dragOffset.current) {
      try {
        localStorage.setItem(POS_STORAGE_KEY, JSON.stringify(pos))
      } catch {
        // storage full/blocked — position simply won't persist
      }
    }
    dragOffset.current = null
    e.currentTarget.releasePointerCapture(e.pointerId)
  }

  if (!isOpen || !activeChart) {
    return null
  }

  const onClose = () => setOpen(false)

  const encoding = activeChart.encoding

  const applyTemplate = () => {
    const tpl = templates.find((t) => t.id === selectedTemplateId)
    if (!tpl) return
    updateEncoding(activeChart.id, tpl.encoding)
    if (tpl.layout && Object.keys(tpl.layout).length > 0) {
      updateLayout(activeChart.id, tpl.layout)
    }
    addNotification('success', `Template "${tpl.name}" applied`)
  }

  const saveAsTemplate = async () => {
    const name = templateName.trim()
    if (!name) return
    setTemplateBusy(true)
    try {
      const saved = await api.saveTemplate(name, activeChart.encoding, activeChart.layout)
      setTemplates((prev) => [...prev, saved])
      setTemplateName('')
      addNotification('success', `Template "${name}" saved`)
    } catch (err) {
      addNotification('error', err instanceof Error ? err.message : 'Failed to save template')
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
      addNotification('success', `Template "${tpl.name}" deleted`)
    } catch (err) {
      addNotification('error', err instanceof Error ? err.message : 'Failed to delete template')
    } finally {
      setTemplateBusy(false)
    }
  }

  return (
    <div
      ref={panelRef}
      className="fixed z-50 flex max-h-[85vh] flex-col overflow-hidden rounded-lg border border-border bg-surface-elevated shadow-2xl"
      style={{ left: pos.x, top: pos.y, width: DIALOG_WIDTH, maxWidth: 'calc(100vw - 32px)' }}
      role="dialog"
      aria-label="Chart Configuration"
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
          <span>Chart Configuration</span>
          <span className="text-sm font-normal text-muted">— {activeChart.name}</span>
        </div>
        <Button
          isIconOnly
          size="sm"
          variant="light"
          className="h-6 w-6 min-w-0"
          onPress={onClose}
          aria-label="Close"
          onPointerDown={(e) => e.stopPropagation()}
        >
          <X className="h-4 w-4" />
        </Button>
      </div>

      <div className="flex flex-1 min-h-0 flex-col overflow-hidden p-4 pb-6">
          {/* Height constraint travels via flex-1/min-h-0 the whole way down (never %: the root only has max-h) */}
          <div className="flex flex-1 min-h-0 gap-4">
            {/* Left: Chart Type (scrolls independently from the config column) */}
            <div className="w-36 shrink-0 overflow-y-auto pr-1">
              <span className="text-xs font-semibold text-muted mb-2 block">Chart Type</span>
              <div className="flex flex-col gap-1">
                {chartTypeOptions.map((opt) => (
                  <Button
                    key={opt.value}
                    size="sm"
                    variant={encoding.chartType === opt.value ? 'solid' : 'flat'}
                    color={encoding.chartType === opt.value ? 'primary' : 'default'}
                    onPress={() => updateEncoding(activeChart.id, { chartType: opt.value as ChartType })}
                    className="justify-start text-xs"
                  >
                    {opt.label}
                  </Button>
                ))}
              </div>
            </div>

            {/* Right: Configuration (scrolls independently from the type list) */}
            <div className="flex-1 min-h-0 min-w-0 overflow-y-auto pl-1 pr-1">
              {/* Templates */}
              <div className="mb-4">
                <span className="text-xs font-semibold text-muted mb-2 block">Templates</span>
                <div className="flex items-end gap-1.5">
                  <LabeledSelect
                    label="Saved Templates"
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
                    Apply
                  </Button>
                  <Button
                    isIconOnly
                    size="sm"
                    variant="light"
                    color="danger"
                    className="h-7 w-7 min-w-0 shrink-0"
                    isDisabled={!selectedTemplateId || templateBusy}
                    onPress={deleteTemplate}
                    aria-label="Delete template"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
                <div className="mt-1.5 flex items-center gap-1.5">
                  <Input
                    size="sm"
                    placeholder="Template name"
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
                    Save Current
                  </Button>
                </div>
              </div>

              {/* Registry-driven encoding config: channels vary per chart type */}
              <EncodingPanel chart={activeChart} columns={columns} />
            </div>
          </div>
      </div>
      <div className="flex justify-end gap-2 border-t border-border p-3">
        <Button color="primary" size="sm" onPress={onClose}>
          Done
        </Button>
      </div>
    </div>
  )
}
