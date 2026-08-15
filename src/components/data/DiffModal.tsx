import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button, Modal, ModalBody, ModalContent, ModalHeader, Select, SelectItem } from '@heroui/react'
import { useUIStore } from '@/stores/uiStore'
import { useDataStore } from '@/stores/dataStore'
import { api } from '@/api/client'

interface DiffResult {
  left_rows: number
  right_rows: number
  left_cols: number
  right_cols: number
  only_left: string[]
  only_right: string[]
  numeric_diff: { column: string; left_mean: number; right_mean: number }[]
}

export function DiffModal() {
  const { t } = useTranslation()
  const open = useUIStore((s) => s.diffModalOpen)
  const setOpen = useUIStore((s) => s.setDiffModalOpen)
  const dataFrames = useDataStore((s) => s.dataFrames)
  const [leftId, setLeftId] = useState('')
  const [rightId, setRightId] = useState('')
  const [result, setResult] = useState<DiffResult | null>(null)
  const [loading, setLoading] = useState(false)

  const diff = async () => {
    if (!leftId || !rightId) return
    setLoading(true)
    try {
      setResult(await api.diffDatasets(leftId, rightId))
    } finally {
      setLoading(false)
    }
  }

  return (
    <Modal isOpen={open} onClose={() => setOpen(false)} size="lg">
      <ModalContent>
        <ModalHeader>{t('diff.title')}</ModalHeader>
        <ModalBody className="gap-3 pb-4">
          <div className="flex gap-2">
            <Select size="sm" label={t('diff.leftDataset')} selectedKeys={leftId ? [leftId] : []} onSelectionChange={(k) => setLeftId(Array.from(k)[0] as string)}>
              {dataFrames.map((d) => <SelectItem key={d.id}>{d.name}</SelectItem>)}
            </Select>
            <Select size="sm" label={t('diff.rightDataset')} selectedKeys={rightId ? [rightId] : []} onSelectionChange={(k) => setRightId(Array.from(k)[0] as string)}>
              {dataFrames.map((d) => <SelectItem key={d.id}>{d.name}</SelectItem>)}
            </Select>
          </div>
          <Button size="sm" color="primary" isLoading={loading} onPress={diff}>
            {t('diff.compare')}
          </Button>

          {result && (
            <div className="flex flex-col gap-2 text-xs">
              <div className="flex gap-4 text-muted">
                <span>{t('diff.rows')}: {result.left_rows} → {result.right_rows}</span>
                <span>{t('diff.cols')}: {result.left_cols} → {result.right_cols}</span>
              </div>
              {(result.only_left.length > 0 || result.only_right.length > 0) && (
                <div className="flex gap-4">
                  <span className="text-danger">{t('diff.onlyLeft')}: {result.only_left.join(', ') || '—'}</span>
                  <span className="text-success">{t('diff.onlyRight')}: {result.only_right.join(', ') || '—'}</span>
                </div>
              )}
              {result.numeric_diff.length > 0 && (
                <div className="flex flex-col gap-1 rounded border border-border p-2">
                  <span className="font-semibold text-muted">{t('diff.numericMeanDiff')}</span>
                  {result.numeric_diff.map((n) => (
                    <div key={n.column} className="flex gap-4">
                      <span className="w-24">{n.column}</span>
                      <span>{n.left_mean} → {n.right_mean}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </ModalBody>
      </ModalContent>
    </Modal>
  )
}
