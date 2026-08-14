import { useState } from 'react'
import { Play, Send, Sparkles, Wand2, X } from 'lucide-react'
import { Button } from '@heroui/react'
import { api } from '@/api/client'
import { useDataStore } from '@/stores/dataStore'
import { useUIStore } from '@/stores/uiStore'

interface NLOp {
  type: string
  params: Record<string, unknown>
}

type Mode = 'query' | 'ask'

export function AICommandBar() {
  const activeDataFrameId = useDataStore((s) => s.activeDataFrameId)
  const refreshActiveDataFrame = useDataStore((s) => s.refreshActiveDataFrame)
  const addNotification = useUIStore((s) => s.addNotification)
  const [mode, setMode] = useState<Mode>('query')
  const [input, setInput] = useState('')
  const [operations, setOperations] = useState<NLOp[] | null>(null)
  const [answer, setAnswer] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [applying, setApplying] = useState(false)

  const submit = async () => {
    if (!activeDataFrameId || !input.trim()) return
    setLoading(true)
    setOperations(null)
    setAnswer(null)
    try {
      if (mode === 'query') {
        const res = await api.nlTransform(activeDataFrameId, input.trim())
        setOperations(res.operations)
      } else {
        const res = await api.nlAsk(activeDataFrameId, input.trim())
        setAnswer(res.answer)
      }
    } catch (err) {
      addNotification('error', err instanceof Error ? err.message : '请求失败')
    } finally {
      setLoading(false)
    }
  }

  const apply = async () => {
    if (!activeDataFrameId || !operations || operations.length === 0) return
    setApplying(true)
    try {
      await api.applyBatch(activeDataFrameId, operations)
      addNotification('success', `已应用 ${operations.length} 个操作`)
      setOperations(null)
      setInput('')
      await refreshActiveDataFrame()
    } catch (err) {
      addNotification('error', err instanceof Error ? err.message : '应用失败')
    } finally {
      setApplying(false)
    }
  }

  if (!activeDataFrameId) return null

  const placeholder =
    mode === 'query'
      ? '描述数据清洗需求，如：删除 value>100 的行，然后按 date 排序…'
      : '向数据提问，如：哪个地区 value 最高？'

  return (
    <div className="fixed bottom-4 left-1/2 z-40 w-[680px] max-w-[92vw] -translate-x-1/2">
      {/* Result card */}
      {operations !== null && (
        <div className="mb-2 rounded-xl border border-border bg-surface-elevated p-3 shadow-xl">
          <div className="mb-1 flex items-center justify-between">
            <span className="text-xs font-semibold text-muted">{operations.length} 个操作</span>
            <button className="text-muted hover:text-foreground" onClick={() => setOperations(null)} aria-label="关闭">
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
          <div className="flex flex-col gap-1">
            {operations.map((op, i) => (
              <div key={i} className="flex items-start gap-1 font-mono text-[11px]">
                <span className="shrink-0 text-primary">{op.type}</span>
                <span className="break-all text-muted">{JSON.stringify(op.params)}</span>
              </div>
            ))}
          </div>
          <div className="mt-2 flex gap-1">
            <Button size="sm" color="primary" isLoading={applying} startContent={<Play className="h-3 w-3" />} onPress={apply}>
              应用
            </Button>
            <Button size="sm" variant="light" startContent={<X className="h-3 w-3" />} onPress={() => setOperations(null)}>
              取消
            </Button>
          </div>
        </div>
      )}

      {answer !== null && (
        <div className="mb-2 flex items-start gap-2 rounded-xl border border-border bg-surface-elevated p-3 shadow-xl">
          <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
          <div className="min-w-0 flex-1">
            <div className="whitespace-pre-wrap text-xs leading-relaxed">{answer}</div>
          </div>
          <button className="text-muted hover:text-foreground" onClick={() => setAnswer(null)} aria-label="关闭">
            <X className="h-3.5 w-3.5" />
          </button>
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
          清洗
        </button>
        <button
          className={`flex items-center gap-1 rounded-full px-3 py-1.5 text-xs transition-colors ${
            mode === 'ask' ? 'bg-primary/20 text-primary' : 'text-muted hover:text-foreground'
          }`}
          onClick={() => setMode('ask')}
        >
          <Sparkles className="h-3.5 w-3.5" />
          问答
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
          aria-label="发送"
          className="rounded-full"
        >
          <Send className="h-4 w-4" />
        </Button>
      </div>
    </div>
  )
}
