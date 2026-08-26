import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button, Input, Textarea } from '@heroui/react'
import { Camera, GitCompare, RotateCcw, Trash2 } from 'lucide-react'
import { api } from '@/api/client'
import { useDataStore } from '@/stores/dataStore'
import { useQAStore } from '@/stores/qaStore'
import { useUIStore } from '@/stores/uiStore'
import type { DataDiffResult, DataPreview, DataSnapshot } from '@/types/data'

export function SnapshotView({ datasetId }: { datasetId: string | null }) {
  const { t } = useTranslation()
  const loadDataFrames = useDataStore((state) => state.loadDataFrames)
  const setActiveDataFrame = useDataStore((state) => state.setActiveDataFrame)
  const snapshotId = useQAStore((state) => state.snapshotId)
  const setSnapshotId = useQAStore((state) => state.setSnapshotId)
  const addNotification = useUIStore((state) => state.addNotification)
  const [snapshots, setSnapshots] = useState<DataSnapshot[]>([])
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [preview, setPreview] = useState<DataPreview | null>(null)
  const [diff, setDiff] = useState<DataDiffResult | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const requestId = useRef(0)

  const load = useCallback(async () => {
    if (!datasetId) return
    try {
      setSnapshots(await api.listSnapshots(datasetId))
    } catch {
      setSnapshots([])
    }
  }, [datasetId])

  useEffect(() => {
    setSnapshots([])
    setSelectedId(null)
    setSnapshotId(null)
    setPreview(null)
    setDiff(null)
    load()
  }, [load, setSnapshotId])

  const create = async () => {
    if (!datasetId || !name.trim()) return
    setLoading(true)
    try {
      await api.createSnapshot(datasetId, name.trim(), description.trim())
      setName('')
      setDescription('')
      await load()
      addNotification('success', t('snapshot.created'))
    } catch (error) {
      addNotification('error', error instanceof Error ? error.message : t('snapshot.createFailed'))
    } finally {
      setLoading(false)
    }
  }

  const select = async (snapshot: DataSnapshot) => {
    const currentRequest = ++requestId.current
    setSelectedId(snapshot.id)
    setSnapshotId(snapshot.id)
    setDiff(null)
    try {
      const result = await api.previewSnapshot(snapshot.id)
      if (currentRequest === requestId.current) setPreview(result)
    } catch {
      if (currentRequest === requestId.current) setPreview(null)
    }
  }

  const compare = async (snapshot: DataSnapshot) => {
    if (!datasetId) return
    const currentRequest = ++requestId.current
    setSelectedId(snapshot.id)
    try {
      const result = await api.diffSnapshot(snapshot.id, datasetId)
      if (currentRequest === requestId.current) setDiff(result)
    } catch (error) {
      if (currentRequest === requestId.current) {
        addNotification('error', error instanceof Error ? error.message : t('snapshot.compareFailed'))
      }
    }
  }

  const restore = async (snapshot: DataSnapshot) => {
    setLoading(true)
    try {
      const restored = await api.restoreSnapshot(snapshot.id)
      await loadDataFrames()
      setActiveDataFrame(restored.id)
      addNotification('success', t('snapshot.restored', { name: restored.name }))
    } catch (error) {
      addNotification('error', error instanceof Error ? error.message : t('snapshot.restoreFailed'))
    } finally {
      setLoading(false)
    }
  }

  const remove = async (snapshot: DataSnapshot) => {
    try {
      await api.deleteSnapshot(snapshot.id)
      if (selectedId === snapshot.id) {
        setSelectedId(null)
        setPreview(null)
        setDiff(null)
      }
      if (snapshotId === snapshot.id) setSnapshotId(null)
      await load()
      addNotification('success', t('snapshot.deleted'))
    } catch (error) {
      addNotification('error', error instanceof Error ? error.message : t('snapshot.deleteFailed'))
    }
  }

  if (!datasetId) return <div className="flex h-full items-center justify-center text-xs text-muted">{t('snapshot.selectDataset')}</div>

  return (
    <div className="flex h-full min-h-0 flex-col overflow-auto p-3">
      <div className="grid gap-3 lg:grid-cols-[280px_1fr]">
        <div className="flex flex-col gap-2 rounded border border-border bg-surface p-3">
          <div className="flex items-center gap-2 text-sm font-semibold"><Camera className="h-4 w-4" />{t('snapshot.createTitle')}</div>
          <Input size="sm" label={t('snapshot.name')} value={name} onValueChange={setName} />
          <Textarea size="sm" label={t('snapshot.description')} value={description} onValueChange={setDescription} minRows={2} />
          <Button size="sm" color="primary" isLoading={loading} isDisabled={!name.trim()} onPress={create}>{t('snapshot.create')}</Button>
          <p className="text-[11px] text-muted">{t('snapshot.immutableHint')}</p>
        </div>

        <div className="flex min-w-0 flex-col gap-2">
          {snapshots.length === 0 ? (
            <div className="flex min-h-40 items-center justify-center rounded border border-dashed border-border text-xs text-muted">{t('snapshot.empty')}</div>
          ) : snapshots.map((snapshot) => (
            <div key={snapshot.id} className={`rounded border p-3 ${selectedId === snapshot.id ? 'border-primary bg-primary/5' : 'border-border bg-surface'}`}>
              <div className="flex items-start justify-between gap-3">
                <button className="min-w-0 flex-1 text-left" onClick={() => select(snapshot)}>
                  <div className="truncate text-sm font-semibold">{snapshot.name}</div>
                  <div className="mt-1 text-[11px] text-muted">{snapshot.rows} × {snapshot.cols} · {new Date(snapshot.created_at).toLocaleString()}</div>
                  {snapshot.description && <div className="mt-1 whitespace-pre-wrap text-xs text-muted">{snapshot.description}</div>}
                </button>
                <div className="flex shrink-0 gap-1">
                  <Button isIconOnly size="sm" variant="light" onPress={() => compare(snapshot)} aria-label={t('snapshot.compareCurrent')}><GitCompare className="h-3.5 w-3.5" /></Button>
                  <Button isIconOnly size="sm" variant="light" isLoading={loading} onPress={() => restore(snapshot)} aria-label={t('snapshot.restore')}><RotateCcw className="h-3.5 w-3.5" /></Button>
                  <Button isIconOnly size="sm" variant="light" onPress={() => remove(snapshot)} aria-label={t('snapshot.delete')}><Trash2 className="h-3.5 w-3.5 text-danger" /></Button>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {diff && (
        <div className="mt-3 flex flex-col gap-2 rounded border border-border p-3 text-xs">
          <div className="font-semibold">{t('snapshot.diffTitle')}</div>
          <div className="flex flex-wrap gap-4 text-muted"><span>{t('diff.rows')}: {diff.left_rows} → {diff.right_rows}</span><span>{t('diff.cols')}: {diff.left_cols} → {diff.right_cols}</span></div>
          {(diff.only_left.length > 0 || diff.only_right.length > 0) && <div className="flex flex-wrap gap-4"><span className="text-danger">{t('diff.onlyLeft')}: {diff.only_left.join(', ') || '—'}</span><span className="text-success">{t('diff.onlyRight')}: {diff.only_right.join(', ') || '—'}</span></div>}
          {diff.numeric_diff.map((item) => <div key={item.column}>{item.column}: {item.left_mean} → {item.right_mean}</div>)}
        </div>
      )}

      {preview && (
        <div className="mt-3 overflow-auto rounded border border-border">
          <table className="w-full text-[11px]">
            <thead className="bg-surface text-left text-muted"><tr>{preview.columns.map((column) => <th key={column} className="px-2 py-1">{column}</th>)}</tr></thead>
            <tbody>{preview.rows.slice(0, 12).map((row, rowIndex) => <tr key={rowIndex} className="border-t border-border">{row.map((cell, columnIndex) => <td key={columnIndex} className="px-2 py-1">{String(cell ?? '')}</td>)}</tr>)}</tbody>
          </table>
        </div>
      )}
    </div>
  )
}
