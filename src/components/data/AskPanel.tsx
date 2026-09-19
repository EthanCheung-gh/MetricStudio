import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Archive,
  Bot,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  Copy,
  Download,
  FilePlus2,
  FileText,
  LayoutDashboard,
  Loader2,
  MessageSquare,
  MessageSquarePlus,
  Pencil,
  RefreshCw,
  Search,
  Send,
  ShieldCheck,
  Square,
  Trash2,
  User,
  Wrench,
  X,
} from 'lucide-react'
import { Button, Input } from '@heroui/react'
import { api, type NLAskStreamEvent } from '@/api/client'
import { AnswerMarkdown } from '@/components/ai/AnswerMarkdown'
import { useDataStore } from '@/stores/dataStore'
import { useDashboardStore } from '@/stores/dashboardStore'
import { useQAStore } from '@/stores/qaStore'
import { useUIStore } from '@/stores/uiStore'
import { dashboardFiltersForDataset } from '@/utils/qaContext'
import { conversationToHtml, conversationToMarkdown, downloadText } from '@/utils/qaExport'

interface StreamTool {
  name: string
  status: 'running' | 'ok' | 'error'
  detail?: string
}

interface StreamState {
  question: string
  answer: string
  tools: StreamTool[]
  round: number
}

export function AskPanel() {
  const { t } = useTranslation()
  const activeDataFrameId = useDataStore((s) => s.activeDataFrameId)
  const datasetId = useQAStore((s) => s.datasetId)
  const snapshotId = useQAStore((s) => s.snapshotId)
  const activeConversationId = useQAStore((s) => s.activeConversationId)
  const conversations = useQAStore((s) => s.conversations)
  const activeDashboardId = useDashboardStore((s) => s.activeDashboardId)
  const dashboards = useDashboardStore((s) => s.dashboards)
  const createDashboard = useDashboardStore((s) => s.createDashboard)
  const addTextItem = useDashboardStore((s) => s.addTextItem)
  const setDataset = useQAStore((s) => s.setDataset)
  const createConversation = useQAStore((s) => s.createConversation)
  const selectConversation = useQAStore((s) => s.selectConversation)
  const renameConversation = useQAStore((s) => s.renameConversation)
  const deleteConversation = useQAStore((s) => s.deleteConversation)
  const addTurn = useQAStore((s) => s.addTurn)
  const deleteTurn = useQAStore((s) => s.deleteTurn)
  const replaceTurn = useQAStore((s) => s.replaceTurn)
  const compactTurns = useQAStore((s) => s.compactTurns)
  const clear = useQAStore((s) => s.clear)
  const addNotification = useUIStore((s) => s.addNotification)
  const setReportNotesDraft = useUIStore((s) => s.setReportNotesDraft)
  const setReportDialogOpen = useUIStore((s) => s.setReportDialogOpen)
  const [question, setQuestion] = useState('')
  const [conversationSearch, setConversationSearch] = useState('')
  const [renameValue, setRenameValue] = useState('')
  const [renaming, setRenaming] = useState(false)
  const [expandedEvidence, setExpandedEvidence] = useState<Set<number>>(new Set())
  const [activeCitation, setActiveCitation] = useState<{ turn: number; n: number } | null>(null)
  const [loading, setLoading] = useState(false)
  const [regeneratingIndex, setRegeneratingIndex] = useState<number | null>(null)
  const [streamState, setStreamState] = useState<StreamState | null>(null)
  // v1.9.0 stop-generation: the in-flight request's controller plus a ref mirror
  // of the stream state, so the abort handler can keep the partial answer.
  const abortRef = useRef<AbortController | null>(null)
  const streamRef = useRef<StreamState | null>(null)
  // v1.5.0 turn display: explicit visibility overrides; default = only the
  // latest turn expanded. Cleared whenever the turn list shifts.
  const [turnVisibility, setTurnVisibility] = useState<Map<number, boolean>>(new Map())
  const turnRefs = useRef<Map<number, HTMLDivElement>>(new Map())

  useEffect(() => {
    if (datasetId !== activeDataFrameId) setDataset(activeDataFrameId)
  }, [activeDataFrameId, datasetId, setDataset])

  const datasetConversations = conversations.filter(
    (conversation) => conversation.datasetId === activeDataFrameId,
  )
  const visibleConversations = datasetConversations.filter((conversation) =>
    conversation.name.toLocaleLowerCase().includes(conversationSearch.trim().toLocaleLowerCase()),
  )
  const activeConversation = conversations.find((conversation) => conversation.id === activeConversationId)
  const turns = activeConversation?.turns ?? []
  // v1.10.0: cumulative tokens across the conversation's turns.
  const totalTokens = turns.reduce((sum, t) => sum + (t.usage?.total ?? 0), 0)
  const activeDashboard = dashboards.find((dashboard) => dashboard.id === activeDashboardId)
  const filters = dashboardFiltersForDataset(activeDashboard?.filters ?? [], activeDataFrameId ?? '')
  const boundSnapshotId = datasetId === activeDataFrameId ? snapshotId ?? undefined : undefined

  // --- v1.6.0 history compaction ------------------------------------------------
  // Mirrors backend qa_agent.HISTORY_ROUNDS: dialog turns this far back are no
  // longer sent verbatim to the LLM.
  const HISTORY_ROUNDS = 8
  const COMPACT_MIN_TURNS = 4
  const COMPACT_SUGGEST_TURNS = 12

  const dialogIndexes = turns.map((t, i) => (t.kind !== 'compaction' ? i : -1)).filter((i) => i >= 0)
  const compactibleCount = dialogIndexes.length - 1 // keep the latest dialog turn
  const canCompact = compactibleCount >= COMPACT_MIN_TURNS
  const suggestCompact = dialogIndexes.length >= COMPACT_SUGGEST_TURNS
  const [compacting, setCompacting] = useState(false)

  const isOutOfContext = (index: number) => {
    const pos = dialogIndexes.indexOf(index)
    return pos >= 0 && pos < dialogIndexes.length - HISTORY_ROUNDS
  }

  const compact = async () => {
    if (!activeDataFrameId || !canCompact || compacting) return
    const endIndex = dialogIndexes[compactibleCount - 1]
    const turnsToCompact = dialogIndexes
      .slice(0, compactibleCount)
      .map((i) => turns[i])
      // v1.9.0: stopped turns hold partial answers — never summarize them.
      .filter((t) => !(t.kind !== 'compaction' && t.stopped))
      .map((t) => {
        if (t.kind === 'compaction') return { question: '（此前对话摘要）', answer: t.summary ?? '' }
        return { question: t.question, answer: t.answer }
      })
    setCompacting(true)
    try {
      const res = await api.nlCompact(activeDataFrameId, turnsToCompact)
      compactTurns(0, endIndex, res.summary)
      addNotification('success', t('ai.compacted', { count: res.turns_compacted }))
    } catch (err) {
      addNotification('error', err instanceof Error ? err.message : t('ai.requestFailed'))
    } finally {
      setCompacting(false)
    }
  }

  const toHistory = (list: typeof turns) =>
    list
      // Stopped turns keep a partial answer — exclude them from LLM context.
      .filter((t) => !t.stopped)
      .map((t) => ({
        question: t.kind === 'compaction' ? '' : t.question,
        answer: t.kind === 'compaction' ? (t.summary ?? '') : t.answer,
        kind: (t.kind ?? 'dialog') as 'dialog' | 'compaction',
        summary: t.summary,
        compacted_range: t.compactedRange,
      }))

  const isAbortError = (err: unknown) =>
    err instanceof DOMException
      ? err.name === 'AbortError'
      : err instanceof Error && err.name === 'AbortError'

  const applyStreamEvent = (event: NLAskStreamEvent) => {
    setStreamState((prev) => {
      if (!prev) return prev
      let next: StreamState
      if (event.type === 'round_start') next = { ...prev, round: event.round ?? prev.round + 1 }
      else if (event.type === 'tool_call') {
        const incoming = (event.calls ?? []).map((call) => ({ name: call.name, status: 'running' as const }))
        next = { ...prev, tools: [...prev.tools, ...incoming] }
      } else if (event.type === 'tool_result') {
        const tools = [...prev.tools]
        const index = tools.findIndex((tool) => tool.status === 'running')
        if (index >= 0) {
          tools[index] = { name: event.tool ?? tools[index].name, status: event.ok ? 'ok' : 'error', detail: event.detail }
        }
        next = { ...prev, tools }
      } else if (event.type === 'answer_delta') next = { ...prev, answer: prev.answer + (event.text ?? '') }
      else next = prev
      streamRef.current = next
      return next
    })
  }

  const stopStream = () => {
    abortRef.current?.abort()
    abortRef.current = null
  }

  const ask = async (value = question) => {
    if (!activeDataFrameId || !activeConversationId || !value.trim() || loading || regeneratingIndex !== null) return
    const currentQuestion = value.trim()
    const controller = new AbortController()
    abortRef.current = controller
    setLoading(true)
    setQuestion('')
    const initial: StreamState = { question: currentQuestion, answer: '', tools: [], round: 0 }
    streamRef.current = initial
    setStreamState(initial)
    try {
      const response = await api.nlAskStream(
        activeDataFrameId,
        currentQuestion,
        toHistory(turns),
        { snapshotId: boundSnapshotId, filters },
        applyStreamEvent,
        controller.signal,
      )
      addTurn({
        question: currentQuestion,
        answer: response.answer,
        evidence: response.evidence,
        generatedAt: response.generated_at,
        context: { datasetId: activeDataFrameId, snapshotId: boundSnapshotId, filters, model: response.model },
        facts: response.facts,
        followups: response.followups,
        clarify: response.clarify,
        verifiedSteps: response.tool_call_count ?? 0,
        usage: response.usage,
      })
    } catch (err) {
      if (isAbortError(err)) {
        // Keep whatever arrived before the stop; marked stopped so it stays
        // out of history/compaction and shows a badge.
        addTurn({
          question: currentQuestion,
          answer: streamRef.current?.answer ?? '',
          evidence: [],
          context: { datasetId: activeDataFrameId, snapshotId: boundSnapshotId, filters },
          stopped: true,
        })
      } else {
        setQuestion(currentQuestion)
        addNotification('error', err instanceof Error ? err.message : 'Ask failed')
      }
    } finally {
      if (abortRef.current === controller) abortRef.current = null
      setLoading(false)
      setStreamState(null)
      streamRef.current = null
    }
  }

  const regenerate = async (index: number) => {
    if (!activeDataFrameId || !activeConversationId || loading || regeneratingIndex !== null) return
    const controller = new AbortController()
    abortRef.current = controller
    setRegeneratingIndex(index)
    const turn = turns[index]
    const initial: StreamState = { question: turn.question, answer: '', tools: [], round: 0 }
    streamRef.current = initial
    setStreamState(initial)
    try {
      const requestDatasetId = turn.context?.datasetId ?? activeDataFrameId
      const context = { snapshotId: turn.context?.snapshotId, filters: turn.context?.filters ?? [] }
      const response = await api.nlAskStream(
        requestDatasetId,
        turn.question,
        toHistory(turns.slice(0, index)),
        context,
        applyStreamEvent,
        controller.signal,
      )
      replaceTurn(index, {
        question: turn.question,
        answer: response.answer,
        evidence: response.evidence,
        generatedAt: response.generated_at,
        context: { datasetId: requestDatasetId, ...context, model: response.model },
        facts: response.facts,
        followups: response.followups,
        clarify: response.clarify,
        verifiedSteps: response.tool_call_count ?? 0,
        usage: response.usage,
      })
    } catch (err) {
      // Aborted regenerate: keep the previous answer untouched.
      if (!isAbortError(err)) {
        addNotification('error', err instanceof Error ? err.message : 'Regenerate failed')
      }
    } finally {
      if (abortRef.current === controller) abortRef.current = null
      setRegeneratingIndex(null)
      setStreamState(null)
      streamRef.current = null
    }
  }

  const toggleEvidence = (index: number) => {
    setExpandedEvidence((current) => {
      const next = new Set(current)
      if (next.has(index)) next.delete(index)
      else next.add(index)
      return next
    })
  }

  const copyAnswer = async (answer: string) => {
    try {
      await navigator.clipboard.writeText(answer)
      addNotification('success', t('ai.copied'))
    } catch {
      addNotification('error', t('ai.copyFailed'))
    }
  }

  const addAnswerToDashboard = (question: string, answer: string) => {
    const dashboard = activeDashboard ?? dashboards[0] ?? createDashboard()
    addTextItem(dashboard.id, `${question}\n\n${answer}`)
    addNotification('success', t('ai.addedToDashboard'))
  }

  const addAnswerToReport = (question: string, answer: string) => {
    const paragraph = `## ${question}\n\n${answer}`
    const draft = useUIStore.getState().reportNotesDraft
    setReportNotesDraft(draft ? `${draft}\n\n${paragraph}` : paragraph)
    setReportDialogOpen(true)
    addNotification('success', t('ai.addedToReport'))
  }

  const exportConversation = (format: 'markdown' | 'html') => {
    if (!activeConversation) return
    const content = format === 'markdown' ? conversationToMarkdown(activeConversation) : conversationToHtml(activeConversation)
    downloadText(`${activeConversation.name}.${format === 'markdown' ? 'md' : 'html'}`, content, format === 'markdown' ? 'text/markdown;charset=utf-8' : 'text/html;charset=utf-8')
    addNotification('success', t('ai.exported'))
  }

  const startRename = () => {
    setRenameValue(activeConversation?.name ?? '')
    setRenaming(true)
  }

  const confirmRename = () => {
    if (activeConversationId && renameValue.trim()) renameConversation(activeConversationId, renameValue)
    setRenaming(false)
  }

  const clearHistory = () => {
    clear()
    setExpandedEvidence(new Set())
    setTurnVisibility(new Map())
  }

  const startConversation = () => {
    createConversation()
    setQuestion('')
    setExpandedEvidence(new Set())
    setTurnVisibility(new Map())
  }

  const setTurnExpanded = (index: number, expanded: boolean) => {
    setTurnVisibility((current) => {
      const next = new Map(current)
      next.set(index, expanded)
      return next
    })
  }

  const scrollToTurn = (index: number) => {
    turnRefs.current.get(index)?.scrollIntoView({ block: 'start', behavior: 'smooth' })
  }

  /** One-line collapsed preview of a historical turn (v1.5.0). */
  const turnPreview = (index: number) => {
    const turn = turns[index]
    const question = turn.question.trim().replace(/\s+/g, ' ')
    const answerLine = turn.answer.trim().split('\n')[0].replace(/\s+/g, ' ')
    return `#${index + 1} · ${question.slice(0, 40)}${question.length > 40 ? '…' : ''} → ${answerLine.slice(0, 48)}${answerLine.length > 48 ? '…' : ''}`
  }

  if (!activeDataFrameId) {
    return (
      <div className="flex items-center gap-2 rounded border border-dashed border-border/70 p-3 text-[11px] text-muted">
        <Bot className="h-4 w-4 shrink-0 opacity-60" />
        {t('ai.noDataset')}
      </div>
    )
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-2 overflow-hidden rounded border border-border bg-surface p-2">
      <div className="flex items-center justify-between gap-2 text-xs font-semibold text-muted">
        <div className="flex min-w-0 items-center gap-1">
          <Bot className="h-3.5 w-3.5 shrink-0" />
          {renaming ? (
            <Input
              size="sm"
              autoFocus
              value={renameValue}
              onValueChange={setRenameValue}
              onKeyDown={(event) => {
                if (event.key === 'Enter') confirmRename()
                if (event.key === 'Escape') setRenaming(false)
              }}
              className="max-w-[180px]"
            />
          ) : (
            <span className="truncate">{activeConversation?.name ?? t('ai.newConversation')}</span>
          )}
          {totalTokens > 0 && (
            <span className="shrink-0 text-[9px] font-normal text-muted/80">
              {t('ai.tokensTotal', { count: totalTokens })}
            </span>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-0.5">
          {renaming ? (
            <>
              <Button size="sm" variant="light" onPress={confirmRename}>{t('ai.confirm')}</Button>
              <Button isIconOnly size="sm" variant="light" onPress={() => setRenaming(false)} aria-label={t('ai.cancel')}>
                <X className="h-3.5 w-3.5" />
              </Button>
            </>
          ) : (
            <>
              <Button isIconOnly size="sm" variant="light" onPress={startConversation} aria-label={t('ai.newConversation')} title={t('ai.newConversation')}>
                <MessageSquarePlus className="h-3.5 w-3.5" />
              </Button>
              <Button isIconOnly size="sm" variant="light" onPress={startRename} aria-label={t('ai.renameConversation')} title={t('ai.renameConversation')}>
                <Pencil className="h-3.5 w-3.5" />
              </Button>
              <Button isIconOnly size="sm" variant="light" onPress={() => exportConversation('markdown')} aria-label={t('ai.exportMarkdown')} title={t('ai.exportMarkdown')}>
                <FileText className="h-3.5 w-3.5" />
              </Button>
              <Button isIconOnly size="sm" variant="light" onPress={() => exportConversation('html')} aria-label={t('ai.exportHtml')} title={t('ai.exportHtml')}>
                <Download className="h-3.5 w-3.5" />
              </Button>
              <Button isIconOnly size="sm" variant="light" onPress={() => activeConversationId && deleteConversation(activeConversationId)} aria-label={t('ai.deleteConversation')} title={t('ai.deleteConversation')}>
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
              {canCompact && (
                <Button
                  isIconOnly
                  size="sm"
                  variant="light"
                  className={suggestCompact ? 'text-warning' : undefined}
                  isLoading={compacting}
                  onPress={() => void compact()}
                  aria-label={t('ai.compact')}
                  title={suggestCompact ? t('ai.compactSuggest') : t('ai.compact')}
                >
                  <Archive className="h-3.5 w-3.5" />
                </Button>
              )}
            </>
          )}
        </div>
      </div>

      <div className="flex gap-1">
        <div className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted" />
          <Input
            size="sm"
            className="pl-6"
            placeholder={t('ai.searchConversations')}
            value={conversationSearch}
            onValueChange={setConversationSearch}
          />
        </div>
        <select
          aria-label={t('ai.selectConversation')}
          value={activeConversationId ?? ''}
          onChange={(event) => selectConversation(event.target.value)}
          className="max-w-[45%] rounded border border-border bg-surface px-2 text-xs outline-none"
        >
          {visibleConversations.length === 0 && <option value="">{t('ai.noConversations')}</option>}
          {visibleConversations.map((conversation) => (
            <option key={conversation.id} value={conversation.id}>
              {conversation.name} · {t('ai.turnCount', { count: conversation.turns.length })}
            </option>
          ))}
        </select>
      </div>

      {turns.length >= 6 && (
        <div className="flex flex-wrap gap-1">
          {turns.map((_, navIndex) => {
            const active = turnVisibility.get(navIndex) ?? navIndex === turns.length - 1
            return (
              <button
                key={navIndex}
                type="button"
                onClick={() => scrollToTurn(navIndex)}
                title={turnPreview(navIndex)}
                className={`h-4 min-w-5 rounded px-1 text-[9px] transition-colors ${
                  active ? 'bg-primary/20 text-primary' : 'bg-default/40 text-muted hover:text-foreground'
                }`}
              >
                {navIndex + 1}
              </button>
            )
          })}
        </div>
      )}

      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto pr-1">
        {turns.length === 0 && (
          <div className="flex items-center gap-2 rounded border border-dashed border-border/70 p-3 text-[11px] text-muted">
            <Bot className="h-4 w-4 shrink-0 opacity-60" />
            {t('ai.emptyHistory')}
          </div>
        )}
        {turns.map((turn, index) => {
          const isExpanded = expandedEvidence.has(index)
          const turnExpanded = turnVisibility.get(index) ?? index === turns.length - 1
          const isRegenerating = regeneratingIndex === index
          return (
            <div
              key={`${turn.question}-${index}`}
              className="scroll-mt-1 space-y-1.5"
              ref={(el) => { if (el) turnRefs.current.set(index, el); else turnRefs.current.delete(index) }}
            >
              {turn.kind === 'compaction' ? (
                turnExpanded ? (
                  <div className="rounded border border-primary/30 bg-primary/5 p-2">
                    <div className="flex items-center gap-1.5 text-[11px] font-medium text-primary">
                      <Archive className="h-3 w-3 shrink-0" />
                      {t('ai.compactedRange', {
                        start: turn.compactedRange?.[0] ?? 0,
                        end: turn.compactedRange?.[1] ?? 0,
                      })}
                      <button
                        type="button"
                        className="ml-auto text-muted hover:text-foreground"
                        onClick={() => setTurnExpanded(index, false)}
                        title={t('ai.collapseTurn')}
                      >
                        <ChevronUp className="h-3 w-3" />
                      </button>
                    </div>
                    <div className="mt-1 whitespace-pre-wrap text-[10px] leading-relaxed text-muted">{turn.summary}</div>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => setTurnExpanded(index, true)}
                    title={t('ai.expandTurn')}
                    className="group flex w-full items-center gap-1.5 rounded border border-primary/30 bg-primary/5 px-2 py-1.5 text-left hover:bg-primary/10"
                  >
                    <Archive className="h-3 w-3 shrink-0 text-primary" />
                    <span className="min-w-0 flex-1 truncate text-[10px] text-primary">
                      {t('ai.compactedRange', {
                        start: turn.compactedRange?.[0] ?? 0,
                        end: turn.compactedRange?.[1] ?? 0,
                      })}
                      {' · '}
                      {turn.summary}
                    </span>
                    <ChevronRight className="h-3 w-3 shrink-0 text-primary group-hover:text-foreground" />
                  </button>
                )
              ) : (
              <>
              {!turnExpanded && (
                <button
                  type="button"
                  onClick={() => setTurnExpanded(index, true)}
                  title={t('ai.expandTurn')}
                  className="group flex w-full items-center gap-1.5 rounded border border-border/50 bg-surface/40 px-2 py-1.5 text-left hover:bg-surface-elevated/60"
                >
                  <MessageSquare className="h-3 w-3 shrink-0 text-muted" />
                  <span className="min-w-0 flex-1 truncate text-[10px] text-muted">{turnPreview(index)}</span>
                  {isOutOfContext(index) && (
                    <span className="shrink-0 rounded bg-default/60 px-1 text-[8px] text-muted/80">{t('ai.outOfContext')}</span>
                  )}
                  {!!turn.verifiedSteps && (
                    <span className="flex shrink-0 items-center gap-0.5 text-[9px] text-primary">
                      <ShieldCheck className="h-2.5 w-2.5" />
                      {turn.verifiedSteps}
                    </span>
                  )}
                  <ChevronRight className="h-3 w-3 shrink-0 text-muted group-hover:text-foreground" />
                </button>
              )}
              {turnExpanded && (
              <div className="space-y-1.5">
                <div className="flex items-start justify-end gap-1.5">
                  <div className="max-w-[88%] rounded-lg rounded-tr-sm bg-primary/15 px-2.5 py-1.5 text-[11px] text-foreground">
                    {turn.question}
                  </div>
                  <User className="mt-1 h-3.5 w-3.5 shrink-0 text-primary" />
                </div>
                <div className="flex items-start gap-1.5">
                  <Bot className="mt-1 h-3.5 w-3.5 shrink-0 text-primary" />
                  <div className="min-w-0 max-w-[92%] flex-1 rounded-lg rounded-tl-sm border border-border/60 bg-surface-elevated/40 p-2">
                    {!isRegenerating && !!turn.verifiedSteps && turn.verifiedSteps > 0 && (
                      <div className="mb-1 inline-flex items-center gap-1 rounded-full bg-primary/10 px-1.5 py-0.5 text-[9px] text-primary">
                        <ShieldCheck className="h-3 w-3" />
                        {t('ai.verified', { count: turn.verifiedSteps })}
                      </div>
                    )}
                    {turn.usage && turn.usage.total > 0 && (
                      <div
                        className="mb-1 inline-flex items-center rounded-full bg-default/50 px-1.5 py-0.5 text-[9px] text-muted"
                        title={t('ai.tokensDetail', { prompt: turn.usage.prompt.toLocaleString(), completion: turn.usage.completion.toLocaleString() })}
                      >
                        {turn.usage.estimated ? t('ai.tokensEstimated', { count: turn.usage.total }) : t('ai.tokens', { count: turn.usage.total })}
                      </div>
                    )}
                    {turn.stopped && (
                      <div className="mb-1 inline-flex items-center rounded-full bg-default/60 px-1.5 py-0.5 text-[9px] text-muted">
                        {t('ai.stopped')}
                      </div>
                    )}
                    {turn.clarify && (
                      <div className="mb-1.5 rounded border border-warning/40 bg-warning/10 p-1.5">
                        <div className="text-[11px] font-medium text-foreground">{turn.clarify.question}</div>
                        <div className="mt-1 flex flex-wrap gap-1">
                          {turn.clarify.options.map((option) => (
                            <button
                              key={option}
                              type="button"
                              className="rounded-full border border-border px-2 py-0.5 text-[10px] text-muted hover:text-foreground"
                              onClick={() => void ask(option)}
                            >
                              {option}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                    {isRegenerating ? (
                      <div className="whitespace-pre-wrap text-[11px] leading-relaxed">{t('ai.regenerating')}</div>
                    ) : (
                      turn.answer && (
                        <AnswerMarkdown
                          text={turn.answer}
                          onCite={(n) => {
                            setActiveCitation({ turn: index, n })
                            setExpandedEvidence((current) => {
                              const next = new Set(current)
                              next.add(index)
                              return next
                            })
                          }}
                        />
                      )
                    )}
                    <div className="mt-1.5 flex flex-wrap items-center gap-1 border-t border-border/50 pt-1">
                      <Button size="sm" variant="light" className="h-6 min-w-0 px-1.5 text-[10px]" onPress={() => copyAnswer(turn.answer)} startContent={<Copy className="h-3 w-3" />}>
                        {t('ai.copyAnswer')}
                      </Button>
                      <Button size="sm" variant="light" className="h-6 min-w-0 px-1.5 text-[10px]" onPress={() => addAnswerToDashboard(turn.question, turn.answer)} startContent={<LayoutDashboard className="h-3 w-3" />}>
                        {t('ai.addToDashboard')}
                      </Button>
                      <Button size="sm" variant="light" className="h-6 min-w-0 px-1.5 text-[10px]" onPress={() => addAnswerToReport(turn.question, turn.answer)} startContent={<FilePlus2 className="h-3 w-3" />}>
                        {t('ai.addToReport')}
                      </Button>
                      <Button size="sm" variant="light" className="h-6 min-w-0 px-1.5 text-[10px]" onPress={() => regenerate(index)} isLoading={isRegenerating} startContent={<RefreshCw className="h-3 w-3" />}>
                        {t('ai.regenerate')}
                      </Button>
                      <Button size="sm" variant="light" className="h-6 min-w-0 px-1.5 text-[10px]" onPress={() => { deleteTurn(index); setTurnVisibility(new Map()); setExpandedEvidence(new Set()) }} startContent={<Trash2 className="h-3 w-3" />}>
                        {t('ai.deleteTurn')}
                      </Button>
                      {turns.length > 1 && (
                      <Button size="sm" variant="light" className="h-6 min-w-0 px-1.5 text-[10px]" onPress={() => setTurnExpanded(index, false)} startContent={<ChevronDown className="h-3 w-3" />}>
                        {t('ai.collapseTurn')}
                      </Button>
                    )}
                    {(turn.evidence ?? []).length > 0 && (
                        <Button size="sm" variant="light" className="h-6 min-w-0 px-1.5 text-[10px]" onPress={() => toggleEvidence(index)} startContent={isExpanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}>
                          {isExpanded ? t('ai.hideEvidence') : t('ai.showEvidence')}
                        </Button>
                      )}
                    </div>
                    {isExpanded && (
                      <ul className="mt-1.5 space-y-1 border-t border-border/50 pt-1.5 text-[10px] text-muted">
                        {(turn.evidence ?? []).map((item, evidenceIndex) => (
                          <li
                            key={`${item.kind}-${evidenceIndex}`}
                            className={`break-words rounded px-1 ${activeCitation?.turn === index && activeCitation.n.toString() === item.id?.replace('fact:', '') ? 'bg-primary/15 text-foreground' : ''}`}
                          >
                            {item.detail}
                          </li>
                        ))}
                      </ul>
                    )}
                    {!isRegenerating && !!turn.followups?.length && (
                      <div className="mt-1.5 flex flex-wrap gap-1">
                        {turn.followups.map((followup) => (
                          <button
                            key={followup}
                            type="button"
                            className="rounded-full border border-primary/40 px-2 py-0.5 text-[10px] text-primary hover:bg-primary/10"
                            onClick={() => void ask(followup)}
                          >
                            {followup}
                          </button>
                        ))}
                      </div>
                    )}
                    {!isRegenerating && index === turns.length - 1 && !turn.followups?.length && (
                      <div className="mt-1.5 flex flex-wrap gap-1">
                        {[t('ai.quickWhy'), t('ai.quickBreakdown'), t('ai.quickChart')].map((suggestion) => (
                          <button key={suggestion} className="rounded-full border border-border px-2 py-0.5 text-[10px] text-muted hover:text-foreground" onClick={() => setQuestion(suggestion)}>
                            {suggestion}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </div>
              )}
              </>
              )}
            </div>
          )
        })}
        {streamState && (
          <div className="space-y-1.5">
            <div className="flex items-start justify-end gap-1.5">
              <div className="max-w-[88%] rounded-lg rounded-tr-sm bg-primary/15 px-2.5 py-1.5 text-[11px] text-foreground">
                {streamState.question}
              </div>
              <User className="mt-1 h-3.5 w-3.5 shrink-0 text-primary" />
            </div>
            <div className="flex items-start gap-1.5">
              <Bot className="mt-1 h-3.5 w-3.5 shrink-0 text-primary" />
              <div className="min-w-0 max-w-[92%] flex-1 rounded-lg rounded-tl-sm border border-border/60 bg-surface-elevated/40 p-2">
                {streamState.tools.length > 0 && (
                  <div className="mb-1.5 space-y-1 rounded border border-border/50 bg-surface/60 p-1.5">
                    {streamState.tools.map((tool, toolIndex) => (
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
                {streamState.answer ? (
                  <AnswerMarkdown text={streamState.answer} cursor />
                ) : (
                  <div className="flex items-center gap-1.5 text-[11px] text-muted">
                    <Loader2 className="h-3 w-3 animate-spin" />
                    {t('ai.thinking')}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </div>

      <div className="flex items-center justify-between border-t border-border/50 pt-2">
        <Button size="sm" variant="light" onPress={clearHistory} isDisabled={turns.length === 0}>{t('ai.clearHistory')}</Button>
        <div className="flex flex-1 gap-1 pl-1">
          <Input size="sm" placeholder={t('ai.askPlaceholder')} value={question} onValueChange={setQuestion} onKeyDown={(e) => { if (e.key === 'Enter') ask() }} />
          {(loading || regeneratingIndex !== null) && (
            <Button
              isIconOnly
              size="sm"
              variant="light"
              className="text-danger"
              onPress={stopStream}
              aria-label={t('ai.stop')}
              title={t('ai.stop')}
            >
              <Square className="h-3.5 w-3.5" />
            </Button>
          )}
          <Button isIconOnly size="sm" color="primary" isLoading={loading} onPress={() => ask()} aria-label={t('ai.ask')}>
            <Send className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>
    </div>
  )
}
