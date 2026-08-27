import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Card, CardBody, Textarea } from '@heroui/react'
import { Lock, Pencil, Unlock, X } from 'lucide-react'
import type { DashboardItem } from '@/types/dashboard'

export interface TextCardProps {
  item: DashboardItem
  /** false in view mode: editing chrome is hidden and text is read-only. */
  editing: boolean
  onToggleLock: () => void
  onRemove: () => void
  onChange: (text: string) => void
}

export function TextCard({ item, editing, onToggleLock, onRemove, onChange }: TextCardProps) {
  const { t } = useTranslation()
  const [editingText, setEditingText] = useState(!item.text)
  return (
    <Card className={`h-full border-border bg-surface ${item.locked ? 'opacity-90' : ''}`}>
      <div className="flex shrink-0 items-center justify-between border-b border-border px-2 py-1">
        <span className="drag-handle flex-1 cursor-grab truncate text-xs font-medium text-muted">{t('dashboard.textCard')}</span>
        {editing && (
          <div className="flex shrink-0 items-center gap-0.5">
            <button
              className="rounded p-0.5 hover:bg-surface-elevated"
              onClick={onToggleLock}
              aria-label={item.locked ? t('dashboard.unlockCard') : t('dashboard.lockCard')}
            >
              {item.locked ? <Lock className="h-3.5 w-3.5 text-warning" /> : <Unlock className="h-3.5 w-3.5 text-muted" />}
            </button>
            {!item.locked && (
              <>
                <button
                  className="rounded p-0.5 hover:bg-surface-elevated"
                  onClick={() => setEditingText((e) => !e)}
                  aria-label={t('dashboard.editText')}
                >
                  <Pencil className="h-3.5 w-3.5 text-muted" />
                </button>
                <button
                  className="rounded p-0.5 hover:bg-danger/20 hover:text-danger"
                  onClick={onRemove}
                  aria-label={t('dashboard.removeCard')}
                >
                  <X className="h-3.5 w-3.5 text-muted" />
                </button>
              </>
            )}
          </div>
        )}
      </div>
      <CardBody className="min-h-0 flex-1 overflow-auto p-3">
        {editing && editingText && !item.locked ? (
          <Textarea
            size="sm"
            minRows={3}
            placeholder={t('dashboard.textPlaceholder')}
            value={item.text || ''}
            onValueChange={onChange}
          />
        ) : (
          <p className="whitespace-pre-wrap text-sm">{item.text || t('dashboard.emptyText')}</p>
        )}
      </CardBody>
    </Card>
  )
}
