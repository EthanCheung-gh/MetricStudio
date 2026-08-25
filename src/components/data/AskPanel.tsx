import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Bot,
  ChevronDown,
  ChevronUp,
  Copy,
  Download,
  FileText,
  MessageSquarePlus,
  Pencil,
  RefreshCw,
  Search,
  Send,
  Trash2,
  User,
  X,
} from 'lucide-react'
import { Button, Input } from '@heroui/react'
import { api } from '@/api/client'
import { useDataStore } from '@/stores/dataStore'
import { useQAStore } from '@/stores/qaStore'
import { useUIStore } from '@/stores/uiStore'
import { conversationToHtml, conversationToMarkdown, downloadText } from '@/utils/qaExport'

export function AskPanel() {
  const { t } = useTranslation()
  const activeDataFrameId = useDataStore((s) => s.activeDataFrameId)
  const datasetId = useQAStore((s) => s.datasetId)
  const activeConversationId = useQAStore((s) => s.activeConversationId)
  const conversations = useQAStore((s) => s.conversations)
  const setDataset = useQAStore((s) => s.setDataset)
  const createConversation = useQAStore((s) => s.createConversation)
  const selectConversation = useQAStore((s) => s.selectConversation)
  const renameConversation = useQAStore((s) => s.renameConversation)
  const deleteConversation = useQAStore((s) => s.deleteConversation)
  const addTurn = useQAStore((s) => s.addTurn)
  const deleteTurn = useQAStore((s) => s.deleteTurn)
  const replaceTurn = useQAStore((s) => s.replaceTurn)
  const clear = useQAStore((s) => s.clear)
  const addNotification = useUIStore((s) => s.addNotification)
  const [question, setQuestion] = useState('')
  const [conversationSearch, setConversationSearch] = useState('')
  const [renameValue, setRenameValue] = useState('')
  const [renaming, setRenaming] = useState(false)
  const [expandedEvidence, setExpandedEvidence] = useState<Set<number>>(new Set())
  const [loading, setLoading] = useState(false)
  const [regeneratingIndex, setRegeneratingIndex] = useState<number | null>(null)

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

  const ask = async (value = question) => {
    if (!activeDataFrameId || !activeConversationId || !value.trim() || loading || regeneratingIndex !== null) return
    setLoading(true)
    try {
      const currentQuestion = value.trim()
      const response = await api.nlAsk(
        activeDataFrameId,
        currentQuestion,
        turns.map(({ question: previousQuestion, answer: previousAnswer }) => ({
          question: previousQuestion,
          answer: previousAnswer,
        })),
      )
      addTurn({
        question: currentQuestion,
        answer: response.answer,
        evidence: response.evidence,
        generatedAt: response.generated_at,
        context: { datasetId: activeDataFrameId, model: response.model },
      })
      setQuestion('')
    } catch (err) {
      addNotification('error', err instanceof Error ? err.message : 'Ask failed')
    } finally {
      setLoading(false)
    }
  }

  const regenerate = async (index: number) => {
    if (!activeDataFrameId || !activeConversationId || loading || regeneratingIndex !== null) return
    setRegeneratingIndex(index)
    try {
      const turn = turns[index]
      const response = await api.nlAsk(
        activeDataFrameId,
        turn.question,
        turns.slice(0, index).map(({ question: previousQuestion, answer: previousAnswer }) => ({
          question: previousQuestion,
          answer: previousAnswer,
        })),
      )
      replaceTurn(index, {
        question: turn.question,
        answer: response.answer,
        evidence: response.evidence,
        generatedAt: response.generated_at,
        context: { datasetId: activeDataFrameId, model: response.model },
      })
    } catch (err) {
      addNotification('error', err instanceof Error ? err.message : 'Regenerate failed')
    } finally {
      setRegeneratingIndex(null)
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
  }

  const startConversation = () => {
    createConversation()
    setQuestion('')
    setExpandedEvidence(new Set())
  }

  if (!activeDataFrameId) return null

  return (
    <div className="flex max-h-[min(560px,70vh)] flex-col gap-2 overflow-hidden rounded border border-border bg-surface p-2">
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
            <option key={conversation.id} value={conversation.id}>{conversation.name}</option>
          ))}
        </select>
      </div>

      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto pr-1">
        {turns.length === 0 && (
          <div className="flex items-center gap-2 rounded border border-dashed border-border/70 p-3 text-[11px] text-muted">
            <Bot className="h-4 w-4 shrink-0 opacity-60" />
            {t('ai.emptyHistory')}
          </div>
        )}
        {turns.map((turn, index) => {
          const isExpanded = expandedEvidence.has(index)
          const isRegenerating = regeneratingIndex === index
          return (
            <div key={`${turn.question}-${index}`} className="space-y-1.5">
              <div className="flex items-start justify-end gap-1.5">
                <div className="max-w-[88%] rounded-lg rounded-tr-sm bg-primary/15 px-2.5 py-1.5 text-[11px] text-foreground">
                  {turn.question}
                </div>
                <User className="mt-1 h-3.5 w-3.5 shrink-0 text-primary" />
              </div>
              <div className="flex items-start gap-1.5">
                <Bot className="mt-1 h-3.5 w-3.5 shrink-0 text-primary" />
                <div className="min-w-0 max-w-[92%] flex-1 rounded-lg rounded-tl-sm border border-border/60 bg-surface-elevated/40 p-2">
                  <div className="whitespace-pre-wrap text-[11px] leading-relaxed">{isRegenerating ? t('ai.regenerating') : turn.answer}</div>
                  <div className="mt-1.5 flex flex-wrap items-center gap-1 border-t border-border/50 pt-1">
                    <Button size="sm" variant="light" className="h-6 min-w-0 px-1.5 text-[10px]" onPress={() => copyAnswer(turn.answer)} startContent={<Copy className="h-3 w-3" />}>
                      {t('ai.copyAnswer')}
                    </Button>
                    <Button size="sm" variant="light" className="h-6 min-w-0 px-1.5 text-[10px]" onPress={() => regenerate(index)} isLoading={isRegenerating} startContent={<RefreshCw className="h-3 w-3" />}>
                      {t('ai.regenerate')}
                    </Button>
                    <Button size="sm" variant="light" className="h-6 min-w-0 px-1.5 text-[10px]" onPress={() => deleteTurn(index)} startContent={<Trash2 className="h-3 w-3" />}>
                      {t('ai.deleteTurn')}
                    </Button>
                    {turn.evidence.length > 0 && (
                      <Button size="sm" variant="light" className="h-6 min-w-0 px-1.5 text-[10px]" onPress={() => toggleEvidence(index)} startContent={isExpanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}>
                        {isExpanded ? t('ai.hideEvidence') : t('ai.showEvidence')}
                      </Button>
                    )}
                  </div>
                  {isExpanded && (
                    <ul className="mt-1.5 space-y-1 border-t border-border/50 pt-1.5 text-[10px] text-muted">
                      {turn.evidence.map((item, evidenceIndex) => <li key={`${item.kind}-${evidenceIndex}`} className="break-words">{item.detail}</li>)}
                    </ul>
                  )}
                  {!isRegenerating && index === turns.length - 1 && (
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
          )
        })}
      </div>

      <div className="flex items-center justify-between border-t border-border/50 pt-2">
        <Button size="sm" variant="light" onPress={clearHistory} isDisabled={turns.length === 0}>{t('ai.clearHistory')}</Button>
        <div className="flex flex-1 gap-1 pl-1">
          <Input size="sm" placeholder={t('ai.askPlaceholder')} value={question} onValueChange={setQuestion} onKeyDown={(e) => { if (e.key === 'Enter') ask() }} />
          <Button isIconOnly size="sm" color="primary" isLoading={loading} onPress={() => ask()} aria-label={t('ai.ask')}>
            <Send className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>
    </div>
  )
}
