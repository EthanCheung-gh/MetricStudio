import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Card, CardBody, Textarea } from '@heroui/react'
import { Pencil, X } from 'lucide-react'
import type { DashboardItem } from '@/types/dashboard'

export interface TextCardProps {
  item: DashboardItem
  onRemove: () => void
  onChange: (text: string) => void
}

export function TextCard({ item, onRemove, onChange }: TextCardProps) {
  const { t } = useTranslation()
  const [editing, setEditing] = useState(!item.text)
  return (
    <Card className="h-full border-border bg-surface">
      <div className="flex shrink-0 items-center justify-between border-b border-border px-2 py-1">
        <span className="drag-handle flex-1 cursor-grab truncate text-xs font-medium text-muted">{t('dashboard.textCard')}</span>
        <div className="flex shrink-0 items-center gap-0.5">
          <button
            className="rounded p-0.5 hover:bg-surface-elevated"
            onClick={() => setEditing((e) => !e)}
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
        </div>
      </div>
      <CardBody className="min-h-0 flex-1 overflow-auto p-3">
        {editing ? (
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
