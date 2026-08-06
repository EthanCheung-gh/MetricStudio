import { useEffect, useState } from 'react'
import { Button, Checkbox, Input, Modal, ModalBody, ModalContent, ModalFooter, ModalHeader, Textarea } from '@heroui/react'
import { FileText } from 'lucide-react'
import { useUIStore } from '@/stores/uiStore'
import { useChartStore } from '@/stores/chartStore'
import { useDataStore } from '@/stores/dataStore'
import { api } from '@/api/client'

export function ReportDialog() {
  const open = useUIStore((s) => s.reportDialogOpen)
  const setOpen = useUIStore((s) => s.setReportDialogOpen)
  const addNotification = useUIStore((s) => s.addNotification)
  const charts = useChartStore((s) => s.charts)
  const activeDataFrameId = useDataStore((s) => s.activeDataFrameId)
  const [title, setTitle] = useState('Untitled Report')
  const [selected, setSelected] = useState<string[]>([])
  const [notes, setNotes] = useState('')
  const [includeInsights, setIncludeInsights] = useState(true)
  const [generating, setGenerating] = useState(false)

  // Default to all charts whenever the dialog opens
  useEffect(() => {
    if (open) setSelected(charts.map((c) => c.id))
  }, [open, charts])

  const generate = async () => {
    setGenerating(true)
    try {
      const figures = []
      for (const chart of charts.filter((c) => selected.includes(c.id))) {
        const figure = await api.previewChart(chart.datasetId, chart.encoding)
        figures.push({ name: chart.name, figure })
      }
      const { html } = await api.generateReport({
        title: title.trim() || 'Untitled Report',
        dataset_id: activeDataFrameId ?? undefined,
        charts: figures,
        notes,
        include_insights: includeInsights,
      })
      const blob = new Blob([html], { type: 'text/html' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `${(title.trim() || 'report').replace(/[^\w\-]+/g, '_')}.html`
      a.click()
      URL.revokeObjectURL(url)
      addNotification('success', `Report generated with ${figures.length} chart(s)`)
      setOpen(false)
    } catch (err) {
      addNotification('error', err instanceof Error ? err.message : 'Report generation failed')
    } finally {
      setGenerating(false)
    }
  }

  return (
    <Modal isOpen={open} onClose={() => setOpen(false)} size="lg">
      <ModalContent>
        <ModalHeader>Generate Report</ModalHeader>
        <ModalBody className="gap-3">
          <Input
            label="Report title"
            value={title}
            onValueChange={setTitle}
            size="sm"
          />
          {charts.length > 0 && (
            <div className="flex flex-col gap-1">
              <span className="text-[10px] font-semibold uppercase tracking-wide text-muted">
                Charts ({selected.length}/{charts.length})
              </span>
              {charts.map((chart) => (
                <label
                  key={chart.id}
                  className="flex cursor-pointer items-center gap-2 rounded px-1 py-0.5 text-xs hover:bg-surface"
                >
                  <Checkbox
                    size="sm"
                    isSelected={selected.includes(chart.id)}
                    onValueChange={(checked) =>
                      setSelected((prev) =>
                        checked ? [...prev, chart.id] : prev.filter((id) => id !== chart.id),
                      )
                    }
                  />
                  <span className="truncate">{chart.name}</span>
                </label>
              ))}
            </div>
          )}
          <Textarea
            label="Notes (rendered in the report)"
            value={notes}
            onValueChange={setNotes}
            minRows={3}
          />
          <Checkbox
            size="sm"
            isSelected={includeInsights}
            onValueChange={setIncludeInsights}
            isDisabled={!activeDataFrameId}
          >
            Include data insights (active dataset)
          </Checkbox>
        </ModalBody>
        <ModalFooter>
          <Button variant="light" onPress={() => setOpen(false)}>
            Cancel
          </Button>
          <Button color="primary" isLoading={generating} startContent={<FileText className="h-4 w-4" />} onPress={generate}>
            Generate & Download
          </Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  )
}
