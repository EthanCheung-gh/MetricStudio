import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { BookOpen, CheckCircle2, Download } from 'lucide-react'
import { Button, Checkbox, Input, Modal, ModalBody, ModalContent, ModalFooter, ModalHeader, Textarea } from '@heroui/react'
import { api } from '@/api/client'
import { useDataStore } from '@/stores/dataStore'
import { useUIStore } from '@/stores/uiStore'
import { useChartStore } from '@/stores/chartStore'
import { applyPlotlyUserStyle } from '@/utils/plotlyLayout'

interface SectionState {
  source: boolean
  cleaning: boolean
  charts: boolean
  insights: boolean
}

export function StoryDialog() {
  const { t } = useTranslation()
  const open = useUIStore((s) => s.storyDialogOpen)
  const setOpen = useUIStore((s) => s.setStoryDialogOpen)
  const language = useUIStore((s) => s.language)
  const addNotification = useUIStore((s) => s.addNotification)
  const activeDataFrameId = useDataStore((s) => s.activeDataFrameId)
  const dataFrames = useDataStore((s) => s.dataFrames)
  const sourceStatuses = useDataStore((s) => s.sourceStatuses)
  const charts = useChartStore((s) => s.charts)
  const [title, setTitle] = useState('')
  const [conclusions, setConclusions] = useState('')
  const [selectedCharts, setSelectedCharts] = useState<string[]>([])
  const [sections, setSections] = useState<SectionState>({ source: true, cleaning: true, charts: true, insights: true })
  const [generating, setGenerating] = useState(false)

  const datasetMeta = dataFrames.find((d) => d.id === activeDataFrameId)
  const relevantCharts = charts.filter((c) => c.datasetId === activeDataFrameId)

  // Reset draft content whenever the dialog opens.
  useEffect(() => {
    if (!open) return
    setTitle(t('story.defaultTitle'))
    setConclusions('')
    setSelectedCharts(relevantCharts.map((c) => c.id))
    setSections({ source: true, cleaning: true, charts: true, insights: true })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  const collectCleaningSteps = async (): Promise<string[]> => {
    if (!activeDataFrameId) return []
    try {
      const history = await api.history(activeDataFrameId)
      return history.map((item, index) =>
        t('story.stepLabel', { index: index + 1, type: item.type, params: JSON.stringify(item.params) }),
      )
    } catch {
      return []
    }
  }

  const collectInsights = async (): Promise<string[]> => {
    if (!activeDataFrameId) return []
    try {
      const { insights } = await api.insights(activeDataFrameId, language)
      return insights.map((i) => i.text)
    } catch {
      return []
    }
  }

  const generate = async () => {
    if (!activeDataFrameId) return
    setGenerating(true)
    try {
      let cleaningSteps: string[] = []
      let insightTexts: string[] = []
      if (sections.cleaning) cleaningSteps = await collectCleaningSteps()
      if (sections.insights) insightTexts = await collectInsights()

      const figures = []
      if (sections.charts) {
        for (const chart of relevantCharts.filter((c) => selectedCharts.includes(c.id))) {
          const figure = await api.previewChart(chart.datasetId, chart.encoding)
          figures.push({ name: chart.name, figure: applyPlotlyUserStyle(figure, chart.layout) })
        }
      }

      const status = sourceStatuses[activeDataFrameId]
      const { html } = await api.generateStory({
        title: title.trim() || t('story.defaultTitle'),
        dataset_name: sections.source ? datasetMeta?.name : '',
        dataset_meta: sections.source ? { rows: datasetMeta?.rows, cols: datasetMeta?.cols } : {},
        source_path: sections.source ? status?.source_path || '' : '',
        cleaning_steps: cleaningSteps,
        charts: figures,
        insights: insightTexts,
        conclusions,
        locale: language,
      })
      const blob = new Blob([html], { type: 'text/html' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `${(title.trim() || 'story').replace(/[^\w\u4e00-\u9fff-]+/g, '_')}.html`
      a.click()
      URL.revokeObjectURL(url)
      addNotification('success', t('story.generated'))
      setOpen(false)
    } catch (err) {
      addNotification('error', err instanceof Error ? err.message : t('story.failed'))
    } finally {
      setGenerating(false)
    }
  }

  return (
    <Modal isOpen={open} onClose={() => setOpen(false)} size="lg">
      <ModalContent>
        <ModalHeader className="flex items-center gap-1.5">
          <BookOpen className="h-4 w-4" /> {t('story.title')}
        </ModalHeader>
        <ModalBody className="gap-3">
          <p className="text-[11px] text-muted">{t('story.hint')}</p>
          <Input size="sm" label={t('report.title')} value={title} onValueChange={setTitle} />
          {!activeDataFrameId ? (
            <p className="text-[11px] text-warning">{t('story.needDataset')}</p>
          ) : (
            <div className="flex flex-col gap-1 rounded border border-border/60 bg-surface-elevated/40 p-2">
              <span className="text-[10px] font-semibold uppercase tracking-wide text-muted">{t('story.sections')}</span>
              <Checkbox size="sm" isSelected={sections.source} isDisabled={!datasetMeta} onValueChange={(v) => setSections((s) => ({ ...s, source: v }))}>
                {t('story.sectionSource')}
              </Checkbox>
              <Checkbox size="sm" isSelected={sections.cleaning} onValueChange={(v) => setSections((s) => ({ ...s, cleaning: v }))}>
                {t('story.sectionCleaning')}
              </Checkbox>
              <Checkbox size="sm" isSelected={sections.charts} onValueChange={(v) => setSections((s) => ({ ...s, charts: v }))}>
                {t('story.sectionCharts')}
              </Checkbox>
              {sections.charts && relevantCharts.length > 0 && (
                <div className="ml-5 flex flex-wrap gap-1">
                  {relevantCharts.map((chart) => {
                    const picked = selectedCharts.includes(chart.id)
                    return (
                      <button
                        key={chart.id}
                        className={`rounded-full border px-2 py-0.5 text-[10px] ${picked ? 'border-primary bg-primary/15 text-primary' : 'border-border text-muted hover:text-foreground'}`}
                        onClick={() =>
                          setSelectedCharts((current) =>
                            picked ? current.filter((id) => id !== chart.id) : [...current, chart.id],
                          )
                        }
                      >
                        {picked && <CheckCircle2 className="mr-0.5 inline h-2.5 w-2.5" />}
                        {chart.name}
                      </button>
                    )
                  })}
                </div>
              )}
              <Checkbox size="sm" isSelected={sections.insights} onValueChange={(v) => setSections((s) => ({ ...s, insights: v }))}>
                {t('story.sectionInsights')}
              </Checkbox>
            </div>
          )}
          <Textarea
            size="sm"
            minRows={3}
            label={t('story.conclusions')}
            placeholder={t('story.conclusionsPlaceholder')}
            value={conclusions}
            onValueChange={setConclusions}
          />
        </ModalBody>
        <ModalFooter>
          <Button variant="light" onPress={() => setOpen(false)}>{t('common.cancel')}</Button>
          <Button color="primary" isLoading={generating} isDisabled={!activeDataFrameId} startContent={<Download className="h-4 w-4" />} onPress={generate}>
            {t('story.generate')}
          </Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  )
}
