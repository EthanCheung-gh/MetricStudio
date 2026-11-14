import { useEffect, useId, useRef, useState } from 'react'
import {
  Button,
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
  Spinner,
} from '@heroui/react'
import { useTranslation } from 'react-i18next'
import { Copy, Download, Pencil, Plus, RefreshCw, Trash2, Upload } from 'lucide-react'
import { api } from '@/api/client'
import { useCustomChartStore } from '@/stores/customChartStore'
import { useUIStore } from '@/stores/uiStore'
import { chartTypeLabel } from '@/utils/chartTypeLabel'
import { CustomChartWorkbench } from '@/components/chart/CustomChartWorkbench'
import type { CustomChartItem, CustomChartManifest } from '@/types/customChart'

/**
 * Manage the declarative charts in `~/.metricstudio/charts/`: list, create,
 * edit, duplicate, export, delete, and import a JSON manifest. Authoring happens
 * in the full-screen `CustomChartWorkbench`; this dialog only opens it and
 * refreshes the list afterwards. The backend owns validation, so an invalid
 * manifest is rejected with its `detail` (shown inline) and a rejected file on
 * disk simply shows up under "invalid" with the reasons.
 */

interface CustomChartsDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

const ERROR_BOX =
  'rounded border border-danger/40 bg-danger/10 px-2 py-1.5 text-[11px] text-danger break-words'

/** Mirrors the backend's own manifest cap; refuse anything larger before reading. */
const MAX_IMPORT_BYTES = 256 * 1024

export function CustomChartsDialog({ open, onOpenChange }: CustomChartsDialogProps) {
  const { t } = useTranslation()
  // Two instances are mounted at once (`ChartTypeSelector` and
  // `ChartConfigDialog`), so the authoring session has to remember which one
  // opened it: `useId` is stable per instance for the whole mount.
  const owner = useId()
  const workbenchSession = useCustomChartStore((s) => s.workbench)
  const language = useUIStore((s) => s.language)
  const items = useCustomChartStore((s) => s.items)
  const invalid = useCustomChartStore((s) => s.invalid)
  const loading = useCustomChartStore((s) => s.loading)
  const error = useCustomChartStore((s) => s.error)
  const load = useCustomChartStore((s) => s.load)
  const save = useCustomChartStore((s) => s.save)
  const remove = useCustomChartStore((s) => s.remove)
  const openWorkbench = useCustomChartStore((s) => s.openWorkbench)

  const [importError, setImportError] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Files may have changed on disk since the last visit — refresh on open.
  useEffect(() => {
    if (!open) return
    setImportError(null)
    setActionError(null)
    void load(true)
  }, [open, load])

  const importFile = async (files: FileList | null) => {
    const file = files?.[0]
    if (!file) return
    setImportError(null)
    setActionError(null)
    setBusy(true)
    try {
      // `file.text()` on a huge file freezes the tab long before the backend's
      // 256 KB cap can reject it, so enforce the cap client-side first.
      if (file.size > MAX_IMPORT_BYTES) {
        setImportError(t('chart.custom.importError', { message: 'file is larger than 256 KB' }))
        return
      }
      const text = await file.text()
      // Parse failures and backend rejections share one inline error slot.
      const parsed: unknown = JSON.parse(text)
      // A manifest is a JSON object; arrays and scalars would only come back as a
      // confusing backend rejection.
      if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
        setImportError(t('chart.custom.importError', { message: 'manifest must be a JSON object' }))
        return
      }
      const result = await save(parsed as CustomChartManifest)
      if (!result.ok) setImportError(t('chart.custom.importError', { message: result.message }))
    } catch (err) {
      setImportError(t('chart.custom.importError', {
        message: err instanceof Error ? err.message : String(err),
      }))
    } finally {
      setBusy(false)
      // Allow re-importing the same file name after a fix.
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  const exportChart = async (item: CustomChartItem) => {
    setActionError(null)
    try {
      const manifest = await api.getCustomChart(item.id)
      const blob = new Blob([JSON.stringify(manifest, null, 2)], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = `${item.id}.json`
      anchor.click()
      URL.revokeObjectURL(url)
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err))
    }
  }

  const deleteChart = async (item: CustomChartItem) => {
    const name = chartTypeLabel(item.id, language, t)
    if (!window.confirm(t('chart.custom.confirmDelete', { name }))) return
    setActionError(null)
    const ok = await remove(item.id)
    if (!ok) setActionError(useCustomChartStore.getState().error ?? '')
  }

  return (
    <>
      <Modal isOpen={open} onOpenChange={onOpenChange} size="lg" scrollBehavior="inside">
        <ModalContent>
          <ModalHeader>{t('chart.custom.manage')}</ModalHeader>
          <ModalBody className="gap-3">
            <div className="flex flex-col gap-1">
              <p className="text-[11px] leading-relaxed text-muted">{t('chart.custom.folderHint')}</p>
              <p className="text-[11px] leading-relaxed text-muted">{t('chart.custom.fileHint')}</p>
            </div>

            {error && <div className={ERROR_BOX}>{error}</div>}
            {importError && <div className={ERROR_BOX}>{importError}</div>}
            {actionError && <div className={ERROR_BOX}>{actionError}</div>}

            {loading && items.length === 0 && (
              <div className="flex justify-center py-2">
                <Spinner size="sm" />
              </div>
            )}

            {!loading && items.length === 0 && invalid.length === 0 && !error && (
              <div className="rounded border border-dashed border-border p-3 text-center text-xs text-muted">
                {t('chart.custom.empty')}
              </div>
            )}

            {items.length > 0 && (
              <div className="flex flex-col gap-1">
                {items.map((item) => (
                  <div
                    key={item.id}
                    className="flex items-center gap-2 rounded border border-border bg-surface px-2 py-1.5"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-xs font-semibold">
                        {chartTypeLabel(item.id, language, t)}
                      </div>
                      <div className="truncate text-[10px] text-muted">{item.id}</div>
                      <div className="truncate text-[10px] text-muted">
                        {t('chart.custom.source')}: {item.file}
                      </div>
                    </div>
                    <Button
                      isIconOnly
                      size="sm"
                      variant="light"
                      className="h-6 w-6 min-w-0 shrink-0"
                      aria-label={t('chart.workbench.edit')}
                      onPress={() => openWorkbench(owner, item, 'edit')}
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      isIconOnly
                      size="sm"
                      variant="light"
                      className="h-6 w-6 min-w-0 shrink-0"
                      aria-label={t('chart.workbench.duplicate')}
                      onPress={() => openWorkbench(owner, item, 'duplicate')}
                    >
                      <Copy className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      isIconOnly
                      size="sm"
                      variant="light"
                      className="h-6 w-6 min-w-0 shrink-0"
                      aria-label={t('chart.custom.export')}
                      onPress={() => void exportChart(item)}
                    >
                      <Download className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      isIconOnly
                      size="sm"
                      variant="light"
                      color="danger"
                      className="h-6 w-6 min-w-0 shrink-0"
                      aria-label={t('chart.custom.delete')}
                      onPress={() => void deleteChart(item)}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                ))}
              </div>
            )}

            {invalid.length > 0 && (
              <div className="flex flex-col gap-1">
                <span className="text-[10px] font-semibold uppercase tracking-wide text-muted">
                  {t('chart.custom.invalid')}
                </span>
                {invalid.map((entry) => (
                  <div
                    key={`${entry.file}:${entry.id}`}
                    className="rounded border border-warning/40 bg-warning/10 px-2 py-1.5"
                  >
                    <div className="truncate text-xs font-semibold text-warning">
                      {entry.id || entry.file}
                    </div>
                    <div className="truncate text-[10px] text-muted">
                      {t('chart.custom.source')}: {entry.file}
                    </div>
                    <ul className="mt-1 list-disc pl-4 text-[10px] text-muted">
                      {entry.errors.map((message, index) => (
                        <li key={index}>{message}</li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            )}
          </ModalBody>
          <ModalFooter className="gap-2">
            <input
              ref={fileInputRef}
              type="file"
              accept="application/json,.json"
              className="hidden"
              onChange={(e) => void importFile(e.target.files)}
            />
            <Button
              size="sm"
              color="primary"
              className="text-xs"
              startContent={<Plus className="h-3 w-3" />}
              onPress={() => openWorkbench(owner, null, 'new')}
            >
              {t('chart.workbench.new')}
            </Button>
            <Button
              size="sm"
              variant="flat"
              className="text-xs"
              isLoading={loading}
              startContent={!loading && <RefreshCw className="h-3 w-3" />}
              onPress={() => void load(true)}
            >
              {t('chart.custom.reload')}
            </Button>
            <Button
              size="sm"
              variant="flat"
              className="text-xs"
              isLoading={busy}
              startContent={!busy && <Upload className="h-3 w-3" />}
              onPress={() => fileInputRef.current?.click()}
            >
              {t('chart.custom.import')}
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
      {/* Sibling, not a child: the workbench is its own full-screen modal and
          must outlive this dialog's open/close cycle. Gated on `open` because a
          second CustomChartsDialog instance may be mounted elsewhere in the
          workspace — only the owner of the authoring session renders it. */}
      {open && workbenchSession?.owner === owner && <CustomChartWorkbench owner={owner} />}
    </>
  )
}
