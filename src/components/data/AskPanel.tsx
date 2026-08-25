import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Bot, ChevronDown, ChevronUp, Copy, Send, Trash2, User } from 'lucide-react'
import { Button, Input } from '@heroui/react'
import { api } from '@/api/client'
import { useDataStore } from '@/stores/dataStore'
import { useQAStore } from '@/stores/qaStore'
import { useUIStore } from '@/stores/uiStore'

export function AskPanel() {
  const { t } = useTranslation()
  const activeDataFrameId = useDataStore((s) => s.activeDataFrameId)
  const datasetId = useQAStore((s) => s.datasetId)
  const turns = useQAStore((s) => s.turns)
  const setDataset = useQAStore((s) => s.setDataset)
  const addTurn = useQAStore((s) => s.addTurn)
  const clear = useQAStore((s) => s.clear)
  const addNotification = useUIStore((s) => s.addNotification)
  const [question, setQuestion] = useState('')
  const [expandedEvidence, setExpandedEvidence] = useState<Set<number>>(new Set())
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (datasetId !== activeDataFrameId) setDataset(activeDataFrameId)
  }, [activeDataFrameId, datasetId, setDataset])

  const ask = async () => {
    if (!activeDataFrameId || !question.trim() || loading) return
    setLoading(true)
    try {
      const currentQuestion = question.trim()
      const { answer, evidence } = await api.nlAsk(
        activeDataFrameId,
        currentQuestion,
        turns.map(({ question: previousQuestion, answer: previousAnswer }) => ({
          question: previousQuestion,
          answer: previousAnswer,
        })),
      )
      addTurn({ question: currentQuestion, answer, evidence })
      setQuestion('')
    } catch (err) {
      addNotification('error', err instanceof Error ? err.message : 'Ask failed')
    } finally {
      setLoading(false)
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

  const clearHistory = () => {
    clear()
    setExpandedEvidence(new Set())
  }

  if (!activeDataFrameId) return null

  return (
    <div className="flex max-h-[min(560px,70vh)] flex-col gap-2 overflow-hidden rounded border border-border bg-surface p-2">
      <div className="flex items-center justify-between gap-2 text-xs font-semibold text-muted">
        <div className="flex items-center gap-1">
          <Bot className="h-3.5 w-3.5" />
          {t('panel.askData')}
        </div>
        {turns.length > 0 && (
          <Button
            isIconOnly
            size="sm"
            variant="light"
            onPress={clearHistory}
            aria-label={t('ai.clearHistory')}
            title={t('ai.clearHistory')}
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        )}
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
                  <div className="whitespace-pre-wrap text-[11px] leading-relaxed">{turn.answer}</div>
                  <div className="mt-1.5 flex flex-wrap items-center gap-1 border-t border-border/50 pt-1">
                    <Button
                      size="sm"
                      variant="light"
                      className="h-6 min-w-0 px-1.5 text-[10px]"
                      onPress={() => copyAnswer(turn.answer)}
                      startContent={<Copy className="h-3 w-3" />}
                    >
                      {t('ai.copyAnswer')}
                    </Button>
                    {turn.evidence.length > 0 && (
                      <Button
                        size="sm"
                        variant="light"
                        className="h-6 min-w-0 px-1.5 text-[10px]"
                        onPress={() => toggleEvidence(index)}
                        startContent={isExpanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                      >
                        {isExpanded ? t('ai.hideEvidence') : t('ai.showEvidence')}
                      </Button>
                    )}
                  </div>
                  {isExpanded && (
                    <ul className="mt-1.5 space-y-1 border-t border-border/50 pt-1.5 text-[10px] text-muted">
                      {turn.evidence.map((item, evidenceIndex) => (
                        <li key={`${item.kind}-${evidenceIndex}`} className="break-words">
                          {item.detail}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
            </div>
          )
        })}
      </div>

      <div className="flex gap-1 border-t border-border/50 pt-2">
        <Input
          size="sm"
          placeholder={t('ai.askPlaceholder')}
          value={question}
          onValueChange={setQuestion}
          onKeyDown={(e) => {
            if (e.key === 'Enter') ask()
          }}
        />
        <Button isIconOnly size="sm" color="primary" isLoading={loading} onPress={ask} aria-label={t('ai.ask')}>
          <Send className="h-3.5 w-3.5" />
        </Button>
      </div>
    </div>
  )
}
