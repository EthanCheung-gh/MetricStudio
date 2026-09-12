import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { FilePlus2, LayoutDashboard, Loader2, Play, Send, Sparkles, Wand2, Wrench, X } from 'lucide-react'
import { Button } from '@heroui/react'
import { api, type NLAskStreamEvent, type NLTransformStreamEvent } from '@/api/client'
import { useDataStore } from '@/stores/dataStore'
import { useDashboardStore } from '@/stores/dashboardStore'
import { useQAStore } from '@/stores/qaStore'
import { useUIStore } from '@/stores/uiStore'
import { dashboardFiltersForDataset } from '@/utils/qaContext'

interface NLOp {
  type: string
  params: Record<string, unknown>
}

type Mode = 'query' | 'ask'

interface ProcessTool {
  name: string
  status: 'running' | 'ok' | 'error'
  detail?: string
}

/** Unified live process card shown above the command bar while streaming. */
interface ProcessCard {
  mode: Mode
  question: string
  phase: 'thinking' | 'working' | 'done' | 'error'
  tools: ProcessTool[]
  ops: NLOp[]
  answer: string
  operations: NLOp[] | null
  error?: string
}

export function AICommandBar() {
  const activeDataFrameId = useDataStore((s) => s.activeDataFrameId)
  const refreshActiveDataFrame = useDataStore((s) => s.refreshActiveDataFrame)
  const datasetId = useQAStore((s) => s.datasetId)
  const snapshotId = useQAStore((s) => s.snapshotId)
  const activeConversationId = useQAStore((s) => s.activeConversationId)
  const conversations = useQAStore((s) => s.conversations)
  const setDataset = useQAStore((s) => s.setDataset)
  const setSnapshotId = useQAStore((s) => s.setSnapshotId)
  const addTurn = useQAStore((s) => s.addTurn)
  const activeDashboardId = useDashboardStore((s) => s.activeDashboardId)
  const dashboards = useDashboardStore((s) => s.dashboards)
  const createDashboard = useDashboardStore((s) => s.createDashboard)
  const addTextItem = useDashboardStore((s) => s.addTextItem)
  const addNotification = useUIStore((s) => s.addNotification)
  const setReportNotesDraft = useUIStore((s) => s.setReportNotesDraft)
  const setReportDialogOpen = useUIStore((s) => s.setReportDialogOpen)
  const aiBarVisible = useUIStore((s) => s.aiBarVisible)
  const { t } = useTranslation();
  const [mode, setMode] = useState<Mode>('query')
  const [input, setInput] = useState('')
  const [process, setProcess] = useState<ProcessCard | null>(null)
  const [loading, setLoading] = useState(false)
  const [applying, setApplying] = useState(false)

  useEffect(() => {
    if (datasetId !== activeDataFrameId) setDataset(activeDataFrameId)
  }, [activeDataFrameId, datasetId, setDataset])

  const turns = conversations.find((conversation) => conversation.id === activeConversationId)?.turns ?? []
  const activeDashboard = dashboards.find((dashboard) => dashboard.id === activeDashboardId)
  const filters = dashboardFiltersForDataset(activeDashboard?.filters ?? [], activeDataFrameId ?? '')
  const boundSnapshotId = datasetId === activeDataFrameId ? snapshotId ?? undefined : undefined

  const submit = async () => {
    if (!activeDataFrameId || !input.trim() || loading) return
    const runMode = mode
    const value = input.trim()
    setLoading(true)
    setInput('')
    setProcess({ mode: runMode, question: value, phase: 'thinking', tools: [], ops: [], answer: '', operations: null })
    try {
      if (runMode === 'query') {
        const operations = await api.nlTransformStream(activeDataFrameId, value, (event: NLTransformStreamEvent) => {
          setProcess((prev) => {
            if (!prev) return prev
            if (event.type === 'thinking') return { ...prev, phase: 'thinking' }
            if (event.type === 'op' && event.op) return { ...prev, phase: 'working', ops: [...prev.ops, event.op] }
            return prev
          })
        })
        setProcess((prev) => (prev ? { ...prev, phase: 'done', operations } : prev))
      } else {
        const currentQuestion = value
        const res = await api.nlAskStream(
          activeDataFrameId,
          currentQuestion,
          turns.map(({ question, answer }) => ({ question, answer })),
          { snapshotId: boundSnapshotId, filters },
          (event: NLAskStreamEvent) => {
            setProcess((prev) => {
              if (!prev) return prev
              if (event.type === 'round_start') return { ...prev, phase: 'working' }
              if (event.type === 'tool_call') {
                const incoming = (event.calls ?? []).map((call) => ({ name: call.name, status: 'running' as const }))
                return { ...prev, phase: 'working', tools: [...prev.tools, ...incoming] }
              }
              if (event.type === 'tool_result') {
                const tools = [...prev.tools]
                const index = tools.findIndex((tool) => tool.status === 'running')
                if (index >= 0) {
                  tools[index] = { name: event.tool ?? tools[index].name, status: event.ok ? 'ok' : 'error', detail: event.detail }
                }
                return { ...prev, tools }
              }
              if (event.type === 'answer_delta') return { ...prev, phase: 'working', answer: prev.answer + (event.text ?? '') }
              return prev
            })
          },
        )
        addTurn({
          question: currentQuestion,
          answer: res.answer,
          evidence: res.evidence,
          generatedAt: res.generated_at,
          context: { datasetId: activeDataFrameId, snapshotId: boundSnapshotId, filters, model: res.model },
          facts: res.facts,
          followups: res.followups,
          clarify: res.clarify,
          verifiedSteps: res.tool_call_count ?? 0,
        })
        setProcess((prev) => (prev ? { ...prev, phase: 'done', answer: res.answer } : prev))
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : t('ai.requestFailed')
      setProcess((prev) => (prev ? { ...prev, phase: 'error', error: message } : prev))
    } finally {
      setLoading(false)
    }
  }

  const apply = async () => {
    if (!activeDataFrameId || !process?.operations?.length) return
    setApplying(true)
    try {
      await api.applyBatch(activeDataFrameId, process.operations)
      addNotification('success', t('ai.appliedOps', { count: process.operations.length }))
      setProcess(null)
      await refreshActiveDataFrame()
    } catch (err) {
      addNotification('error', err instanceof Error ? err.message : t('ai.applyFailed'))
    } finally {
      setApplying(false)
    }
  }

  const addAnswerToDashboard = () => {
    if (!process) return
    const dashboard = activeDashboard ?? dashboards[0] ?? createDashboard()
    addTextItem(dashboard.id, `${process.question}\n\n${process.answer}`)
    addNotification('success', t('ai.addedToDashboard'))
  }

  const addAnswerToReport = () => {
    if (!process) return
    const paragraph = `## ${process.question}\n\n${process.answer}`
    const draft = useUIStore.getState().reportNotesDraft
    setReportNotesDraft(draft ? `${draft}\n\n${paragraph}` : paragraph)
    setReportDialogOpen(true)
    addNotification('success', t('ai.addedToReport'))
  }

  // Slide in/out instead of unmounting so the toggle from the status bar animates.
  if (!activeDataFrameId) return null

  const placeholder =
    mode === 'query'
      ? t('ai.cleanPlaceholder')
      : t('ai.askPlaceholder')

  return (
    <div
      className={`fixed bottom-5 left-1/2 z-40 w-[680px] max-w-[92vw] -translate-x-1/2 transition-all duration-300 ease-out ${
        aiBarVisible ? 'translate-y-0 opacity-100' : 'pointer-events-none translate-y-24 opacity-0'
      }`}
    >
      {/* Live process card: appears the moment a message is submitted */}
      {process !== null && (
        <div className="mb-2 rounded-xl border border-border bg-surface-elevated p-3 shadow-xl">
          <div className="mb-1.5 flex items-center justify-between gap-2">
            <div className="flex min-w-0 items-center gap-1.5 text-xs">
              {process.mode === 'query' ? (
                <Wand2 className="h-3.5 w-3.5 shrink-0 text-primary" />
              ) : (
                <Sparkles className="h-3.5 w-3.5 shrink-0 text-primary" />
              )}
              <span className="truncate text-foreground">{process.question}</span>
            </div>
            <button className="shrink-0 text-muted hover:text-foreground" onClick={() => setProcess(null)} aria-label={t('common.close')}>
              <X className="h-3.5 w-3.5" />
            </button>
          </div>

          {process.phase === 'thinking' && (
            <div className="flex items-center gap-1.5 text-[11px] text-muted">
              <Loader2 className="h-3 w-3 animate-spin" />
              {t('ai.thinking')}
            </div>
          )}

          {process.phase === 'error' && (
            <div className="rounded border border-danger/40 bg-danger/10 p-1.5 text-[11px] text-danger">{process.error}</div>
          )}

          {process.tools.length > 0 && (
            <div className="mb-1.5 space-y-1">
              {process.tools.map((tool, toolIndex) => (
                <div key={`${tool.name}-${toolIndex}`} className="flex items-center gap-1.5 text-[10px]">
                  {tool.status === 'running' ? (
                    <Loader2 className="h-3 w-3 shrink-0 animate-spin text-primary" />
                  ) : (
                    <Wrench className={`h-3 w-3 shrink-0 ${tool.status === 'ok' ? 'text-success' : 'text-danger'}`} />
                  )}
                  <span className="shrink-0 font-mono text-[9px] text-muted">{tool.name}</span>
                  {tool.detail && <span className="min-w-0 flex-1 truncate text-muted">{tool.detail}</span>}
                </div>
              ))}
            </div>
          )}

          {process.ops.length > 0 && (
            <div className="mb-1.5 flex flex-col gap-1">
              <div className="text-[9px] font-medium uppercase tracking-wide text-muted">
                {t('ai.operations')} ({process.ops.length})
              </div>
              {process.ops.map((op, opIndex) => (
                <div key={opIndex} className="flex items-center gap-1.5 text-[10px]">
                  <Wrench className="h-3 w-3 shrink-0 text-success" />
                  <span className="shrink-0 font-mono text-primary">{op.type}</span>
                  <span className="min-w-0 flex-1 truncate font-mono text-muted">{JSON.stringify(op.params)}</span>
                </div>
              ))}
            </div>
          )}

          {process.answer && (
            <div className="whitespace-pre-wrap text-xs leading-relaxed">
              {process.answer}
              {process.phase === 'working' && (
                <span className="ml-0.5 inline-block h-3 w-1.5 animate-pulse rounded-sm bg-primary/70 align-middle" />
              )}
            </div>
          )}

          {process.phase === 'working' && !process.answer && process.ops.length === 0 && process.tools.length === 0 && (
            <div className="flex items-center gap-1.5 text-[11px] text-muted">
              <Loader2 className="h-3 w-3 animate-spin" />
              {t('ai.thinking')}
            </div>
          )}

          {process.phase === 'done' && process.mode === 'query' && process.operations && process.operations.length > 0 && (
            <div className="mt-2 flex gap-1 border-t border-border/50 pt-2">
              <Button size="sm" color="primary" isLoading={applying} startContent={<Play className="h-3 w-3" />} onPress={apply}>
                {t('ai.apply')}
              </Button>
              <Button size="sm" variant="light" startContent={<X className="h-3 w-3" />} onPress={() => setProcess(null)}>
                {t('ai.cancel')}
              </Button>
            </div>
          )}

          {process.phase === 'done' && process.mode === 'ask' && process.answer && (
            <div className="mt-2 flex gap-1 border-t border-border/50 pt-2">
              <Button size="sm" variant="light" startContent={<LayoutDashboard className="h-3 w-3" />} onPress={addAnswerToDashboard}>
                {t('ai.addToDashboard')}
              </Button>
              <Button size="sm" variant="light" startContent={<FilePlus2 className="h-3 w-3" />} onPress={addAnswerToReport}>
                {t('ai.addToReport')}
              </Button>
            </div>
          )}
        </div>
      )}

      {mode === 'ask' && (boundSnapshotId || filters.length > 0) && (
        <div className="mb-2 flex flex-wrap gap-1 text-[11px] text-muted">
          {boundSnapshotId && (
            <span className="flex items-center gap-1 rounded-full border border-border bg-surface-elevated px-2 py-1">
              {t('ai.snapshotBound', { id: boundSnapshotId.slice(0, 8) })}
              <button onClick={() => setSnapshotId(null)} aria-label={t('ai.clearSnapshotBinding')}>
                <X className="h-3 w-3" />
              </button>
            </span>
          )}
          {filters.length > 0 && (
            <span className="rounded-full border border-border bg-surface-elevated px-2 py-1">
              {t('ai.dashboardFiltersBound', { count: filters.length })}
            </span>
          )}
        </div>
      )}

      {/* Pill input bar */}
      <div className="flex items-center gap-1.5 rounded-full border border-border bg-surface-elevated py-1.5 pl-1.5 pr-1.5 shadow-xl">
        <button
          className={`flex items-center gap-1 rounded-full px-3 py-1.5 text-xs transition-colors ${
            mode === 'query' ? 'bg-primary/20 text-primary' : 'text-muted hover:text-foreground'
          }`}
          onClick={() => setMode('query')}
        >
          <Wand2 className="h-3.5 w-3.5" />
          {t('ai.clean')}
        </button>
        <button
          className={`flex items-center gap-1 rounded-full px-3 py-1.5 text-xs transition-colors ${
            mode === 'ask' ? 'bg-primary/20 text-primary' : 'text-muted hover:text-foreground'
          }`}
          onClick={() => setMode('ask')}
        >
          <Sparkles className="h-3.5 w-3.5" />
          {t('ai.ask')}
        </button>
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') submit()
          }}
          placeholder={placeholder}
          className="min-w-0 flex-1 rounded-full bg-transparent px-2 py-1.5 text-sm outline-none placeholder:text-muted"
        />
        <Button
          isIconOnly
          size="sm"
          color="primary"
          isLoading={loading}
          onPress={submit}
          aria-label={t('ai.send')}
          className="rounded-full"
        >
          <Send className="h-4 w-4" />
        </Button>
      </div>
    </div>
  )
}
