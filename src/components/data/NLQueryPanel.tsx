import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Play, Settings, Sparkles, Wand2, X } from 'lucide-react'
import { Button, Input } from '@heroui/react'
import { api } from '@/api/client'
import { useDataStore } from '@/stores/dataStore'
import { useUIStore } from '@/stores/uiStore'

interface NLOp {
  type: string
  params: Record<string, unknown>
}

export function NLQueryPanel() {
  const { t } = useTranslation()
  const activeDataFrameId = useDataStore((s) => s.activeDataFrameId)
  const refreshActiveDataFrame = useDataStore((s) => s.refreshActiveDataFrame)
  const addNotification = useUIStore((s) => s.addNotification)
  const [query, setQuery] = useState('')
  const [operations, setOperations] = useState<NLOp[] | null>(null)
  const [generating, setGenerating] = useState(false)
  const [applying, setApplying] = useState(false)

  const generate = async () => {
    if (!activeDataFrameId || !query.trim()) return
    setGenerating(true)
    setOperations(null)
    try {
      const res = await api.nlTransform(activeDataFrameId, query.trim())
      setOperations(res.operations)
    } catch (err) {
      addNotification('error', err instanceof Error ? err.message : 'NL query failed')
    } finally {
      setGenerating(false)
    }
  }

  const apply = async () => {
    if (!activeDataFrameId || !operations || operations.length === 0) return
    setApplying(true)
    try {
      await api.applyBatch(activeDataFrameId, operations)
      addNotification('success', `Applied ${operations.length} operation(s)`)
      setOperations(null)
      setQuery('')
      await refreshActiveDataFrame()
    } catch (err) {
      addNotification('error', err instanceof Error ? err.message : 'Apply failed')
    } finally {
      setApplying(false)
    }
  }

  if (!activeDataFrameId) return null

  return (
    <div className="flex flex-col gap-2 rounded border border-border bg-surface p-2">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1 text-xs font-semibold text-muted">
          <Sparkles className="h-3.5 w-3.5" />
          {t('panel.nlQuery')}
        </div>
        <Button
          isIconOnly
          size="sm"
          variant="light"
          onPress={() => useUIStore.getState().setSettingsOpen(true)}
          aria-label={t('nlq.llmSettings')}
        >
          <Settings className="h-3.5 w-3.5" />
        </Button>
      </div>

      <Input
        size="sm"
        placeholder={t('nlq.placeholder')}
        value={query}
        onValueChange={setQuery}
      />
      <Button size="sm" color="primary" isLoading={generating} startContent={<Wand2 className="h-3 w-3" />} onPress={generate}>
        {t('nlq.generate')}
      </Button>

      {operations !== null && (
        <div className="flex flex-col gap-1 rounded border border-border/60 bg-surface-elevated/40 p-2">
          <div className="text-[10px] font-semibold uppercase text-muted">
            {operations.length} {t('ai.operations')}
          </div>
          {operations.map((op, i) => (
            <div key={i} className="flex items-start gap-1 font-mono text-[10px]">
              <span className="shrink-0 text-primary">{op.type}</span>
              <span className="break-all text-muted">{JSON.stringify(op.params)}</span>
            </div>
          ))}
          <div className="flex gap-1">
            <Button
              size="sm"
              color="primary"
              isLoading={applying}
              startContent={<Play className="h-3 w-3" />}
              onPress={apply}
            >
              {t('ai.apply')}
            </Button>
            <Button size="sm" variant="light" startContent={<X className="h-3 w-3" />} onPress={() => setOperations(null)}>
              {t('common.cancel')}
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
