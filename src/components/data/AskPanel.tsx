import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Bot, Send } from 'lucide-react'
import { Button, Input } from '@heroui/react'
import { api } from '@/api/client'
import { useDataStore } from '@/stores/dataStore'
import { useUIStore } from '@/stores/uiStore'

interface QA {
  question: string
  answer: string
}

export function AskPanel() {
  const { t } = useTranslation()
  const activeDataFrameId = useDataStore((s) => s.activeDataFrameId)
  const addNotification = useUIStore((s) => s.addNotification)
  const [question, setQuestion] = useState('')
  const [history, setHistory] = useState<QA[]>([])
  const [loading, setLoading] = useState(false)

  const ask = async () => {
    if (!activeDataFrameId || !question.trim()) return
    setLoading(true)
    try {
      const { answer } = await api.nlAsk(activeDataFrameId, question.trim())
      setHistory((h) => [...h, { question: question.trim(), answer }])
      setQuestion('')
    } catch (err) {
      addNotification('error', err instanceof Error ? err.message : 'Ask failed')
    } finally {
      setLoading(false)
    }
  }

  if (!activeDataFrameId) return null

  return (
    <div className="flex flex-col gap-2 rounded border border-border bg-surface p-2">
      <div className="flex items-center gap-1 text-xs font-semibold text-muted">
        <Bot className="h-3.5 w-3.5" />
        {t('panel.askData')}
      </div>

      {history.map((qa, i) => (
        <div key={i} className="flex flex-col gap-1 rounded border border-border/60 bg-surface-elevated/40 p-2">
          <div className="text-[11px] font-semibold text-primary">Q: {qa.question}</div>
          <div className="whitespace-pre-wrap text-[11px] leading-snug">{qa.answer}</div>
        </div>
      ))}

      <div className="flex gap-1">
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
