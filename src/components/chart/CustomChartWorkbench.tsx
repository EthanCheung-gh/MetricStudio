import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Button,
  Checkbox,
  Input,
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
  Select,
  SelectItem,
  Spinner,
  Textarea,
} from '@heroui/react'
import { useTranslation } from 'react-i18next'
import {
  ChevronDown,
  ChevronRight,
  Copy,
  Download,
  Plus,
  Sparkles,
  X,
} from 'lucide-react'
import { api, apiErrorDetail, apiErrorStatus, isLlmUnavailableError } from '@/api/client'
import { LayoutEditor } from '@/components/chart/LayoutEditor'
import { PlotlyRenderer } from '@/components/chart/PlotlyRenderer'
import { TraceEditor } from '@/components/chart/TraceEditor'
import { useCustomChartStore, type CustomChartWorkbenchSession } from '@/stores/customChartStore'
import { useDataStore } from '@/stores/dataStore'
import { useUIStore } from '@/stores/uiStore'
import {
  AGGREGATES,
  CHANNEL_KEYS,
  CHANNEL_TYPES,
  OPTION_TYPES,
  PREVIEW_CHANNELS,
  SPLIT_BY_TRACE_TYPES,
  TRACE_TYPES,
  TRANSFORM_OPS,
  Y_MODES,
  Y_MODE_SLOTS,
  duplicateChartId,
  formToManifest,
  isValidCustomChartId,
  manifestToForm,
  parseValidationErrors,
  previewEncodingFor,
  previewManifestFor,
  reseedPreviewBindings,
  sectionForPath,
  seedFormFor,
  type ChannelForm,
  type ChannelKey,
  type ManifestForm,
  type OptionForm,
  type ParsedValidationError,
  type PreviewBindings,
  type PreviewChannelKey,
  type TraceForm,
  type TransformForm,
  type TransformOp,
} from '@/utils/manifestForm'
import type { ColumnMeta } from '@/types/data'
import type { PlotlyFigure } from '@/types/plotly'
import type { CustomChartDraftRejection, CustomFieldType } from '@/types/customChart'

/**
 * Full-screen authoring workbench for declarative custom charts.
 *
 * Left: the manifest as a form (channels, transforms, traces, layout, options).
 * Right: a live preview of the *unsaved* manifest plus the backend's errors.
 * Nothing is written to disk until "校验并保存"; the backend stays the
 * authority on validity, so its `; `-joined `detail` is split into per-section
 * problems that mark the section they belong to.
 */

const ERROR_BOX =
  'rounded border border-danger/40 bg-danger/10 px-2 py-1.5 text-[11px] text-danger break-words'
const HINT = 'text-[10px] leading-relaxed text-muted'
const FIELD_LABEL = 'text-[10px] uppercase tracking-wide text-muted'

/** Stable empty list: a fresh `[]` per render would restart the preview timer. */
const NO_COLUMNS: ColumnMeta[] = []

/** Let the browser start the download before the blob URL is revoked. */
const EXPORT_REVOKE_DELAY_MS = 1000

/** A manifest error, whichever side produced it. */
interface WorkbenchProblem {
  path: string
  message: string
  section: ParsedValidationError['section']
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Text worth showing in the error panel: a 400 body is the backend's joined
 * validation/render detail, anything else (404 while the endpoint does not
 * exist, connection failures) is more useful with its status and path.
 */
function backendErrorText(err: unknown): string {
  const detail = apiErrorDetail(err)
  if (apiErrorStatus(err) === 400 && typeof detail === 'string' && detail.trim() !== '') {
    return detail
  }
  return err instanceof Error ? err.message : String(err)
}

function emptyTransform(op: TransformOp): TransformForm {
  return {
    op,
    slots: '',
    by: '',
    descending: false,
    count: '',
    from: 'top',
    groupBy: '',
    field: '',
    agg: 'sum',
    as: '',
  }
}

function emptyOption(): OptionForm {
  return { key: '', type: 'text', default: '', labelZh: '', labelEn: '', choices: '' }
}

function moveItem<T>(items: T[], from: number, to: number): T[] {
  if (to < 0 || to >= items.length) return items
  const next = [...items]
  const [item] = next.splice(from, 1)
  next.splice(to, 0, item)
  return next
}

function initialFormFor(session: CustomChartWorkbenchSession): ManifestForm {
  // One rule decides whether this session may write to the seed's file: only
  // "另存为副本" blanks the id (see `seedFormFor`).
  return seedFormFor(session).form
}

/**
 * Mount/unmount boundary: a fresh session always means a fresh form.
 *
 * `owner` is the id of the `CustomChartsDialog` instance that opened the
 * session. Every mounted dialog renders this component, but only the owner
 * (with a live session) renders the modal, so two dialogs can never mount two
 * workbenches.
 */
export function CustomChartWorkbench({ owner }: { owner: string }) {
  const session = useCustomChartStore((s) => s.workbench)
  if (!session || session.owner !== owner) return null
  return <WorkbenchModal key={session.serial} session={session} />
}

function WorkbenchModal({ session }: { session: CustomChartWorkbenchSession }) {
  const { t } = useTranslation()
  const closeWorkbench = useCustomChartStore((s) => s.closeWorkbench)
  const save = useCustomChartStore((s) => s.save)
  // Reserved ids the save would overwrite; only consulted when the id is unlocked.
  const savedItems = useCustomChartStore((s) => s.items)
  const dataFrames = useDataStore((s) => s.dataFrames)
  const activeDataFrameId = useDataStore((s) => s.activeDataFrameId)

  const [form, setForm] = useState<ManifestForm>(() => initialFormFor(session))
  const initialForm = useRef(form)
  const [suggestedId, setSuggestedId] = useState(() => seedFormFor(session).suggestedId)
  const [dataset, setDataset] = useState(activeDataFrameId ?? dataFrames[0]?.id ?? '')
  const [bindings, setBindings] = useState<PreviewBindings>({ fields: {}, yFields: [] })
  // Columns are tagged with the dataset they came from, so a switch can never
  // seed bindings from the previous dataset's columns.
  const [columnsState, setColumnsState] = useState<{ dataset: string; columns: ColumnMeta[] }>({
    dataset: '',
    columns: NO_COLUMNS,
  })
  const columns = columnsState.dataset === dataset ? columnsState.columns : NO_COLUMNS
  const [figure, setFigure] = useState<PlotlyFigure | null>(null)
  const [previewError, setPreviewError] = useState<string | null>(null)
  const [previewProblems, setPreviewProblems] = useState<WorkbenchProblem[]>([])
  const [previewBusy, setPreviewBusy] = useState(false)
  /** Last preview succeeded but drew nothing (unbound required channel …). */
  const [previewEmpty, setPreviewEmpty] = useState(false)
  const [saveProblems, setSaveProblems] = useState<WorkbenchProblem[]>([])
  const [saving, setSaving] = useState(false)
  const [aiRequest, setAiRequest] = useState('')
  const [aiBusy, setAiBusy] = useState(false)
  const [aiProblems, setAiProblems] = useState<string[]>([])
  const [aiMessage, setAiMessage] = useState<string | null>(null)

  // Derived manifest + JSON-textarea/number problems, recomputed on every edit.
  const { manifest, errors: formErrors } = useMemo(() => formToManifest(form), [form])
  const idLocked = session.mode === 'edit'

  const dirty = useMemo(
    () => JSON.stringify(form) !== JSON.stringify(initialForm.current),
    [form],
  )

  const columnTypes = useMemo(() => {
    const map: Record<string, CustomFieldType> = {}
    for (const column of columns) {
      if (column.inferredType !== 'unknown') map[column.name] = column.inferredType
    }
    return map
  }, [columns])

  const allProblems: WorkbenchProblem[] = useMemo(() => {
    const problems: WorkbenchProblem[] = Object.entries(formErrors).map(([path, message]) => ({
      path,
      message,
      section: sectionForPath(path),
    }))
    problems.push(...saveProblems)
    problems.push(...previewProblems)
    return problems
  }, [formErrors, saveProblems, previewProblems])

  const flaggedSections = useMemo(
    () => new Set(allProblems.map((problem) => problem.section)),
    [allProblems],
  )

  // Pick a dataset once the store has listed them (the modal can open before).
  useEffect(() => {
    if (dataset !== '') return
    const fallback = activeDataFrameId ?? dataFrames[0]?.id
    if (fallback) setDataset(fallback)
  }, [dataset, activeDataFrameId, dataFrames])

  // Columns of the previewed dataset: seed bindings and type the encoding.
  useEffect(() => {
    if (!dataset) {
      setColumnsState({ dataset: '', columns: [] })
      return
    }
    let cancelled = false
    api
      .getColumns(dataset)
      .then((next) => {
        if (!cancelled) setColumnsState({ dataset, columns: next })
      })
      .catch(() => {
        if (!cancelled) setColumnsState({ dataset, columns: [] })
      })
    return () => {
      cancelled = true
    }
  }, [dataset])

  // Bindings are dataset-specific: start over when the dataset changes.
  useEffect(() => {
    setBindings({ fields: {}, yFields: [] })
  }, [dataset])

  /**
   * Structural fingerprint of the manifest: the declared channel keys and the
   * Y-field arity. Re-seeding keys off this (not the whole form) so ordinary
   * edits keep the user's wiring, while an AI apply, a duplicate or a channel
   * toggle prunes what the new manifest can no longer use.
   */
  const channelSignature = useMemo(
    () => `${form.yMode}|${CHANNEL_KEYS.filter((key) => form.channels[key].enabled).join(',')}`,
    [form.channels, form.yMode],
  )

  /**
   * Latest form, read by the structural re-seed below. A ref rather than a
   * dependency: only the form's *structure* may rebind, so a keystroke in a
   * label must not restart the seeding.
   */
  const formRef = useRef(form)
  formRef.current = form

  // Seed / re-seed bindings: drop removed channels, Y slots past the arity and
  // names the dataset no longer has; fill the holes from its columns.
  useEffect(() => {
    if (columns.length === 0) return
    setBindings((current) => {
      const next = reseedPreviewBindings(formRef.current, current, columns)
      return JSON.stringify(next) === JSON.stringify(current) ? current : next
    })
    // `form` is intentionally not a dependency: only its structure may rebind.
  }, [channelSignature, columns])

  // Debounced live preview of the unsaved manifest (300 ms after the last edit).
  const previewSeq = useRef(0)
  useEffect(() => () => {
    previewSeq.current += 1
  }, [])
  useEffect(() => {
    if (!dataset) {
      setFigure(null)
      setPreviewError(null)
      setPreviewProblems([])
      setPreviewEmpty(false)
      setPreviewBusy(false)
      return
    }
    const seq = previewSeq.current + 1
    previewSeq.current = seq
    setPreviewBusy(true)
    const timer = setTimeout(() => {
      const encoding = previewEncodingFor(form, bindings, columnTypes)
      // A brand-new/duplicated session has no id yet; the preview endpoint
      // validates one but never persists it, so it previews under the
      // placeholder id. Saving always posts the real id (see `handleSave`).
      api
        .previewCustomChart({
          manifest: previewManifestFor(manifest),
          dataset_id: dataset,
          encoding,
        })
        .then((next) => {
          if (previewSeq.current !== seq) return
          setFigure(next)
          setPreviewError(null)
          setPreviewProblems([])
          setPreviewEmpty((next.data?.length ?? 0) === 0)
        })
        .catch((err: unknown) => {
          if (previewSeq.current !== seq) return
          const text = backendErrorText(err)
          setFigure(null)
          setPreviewError(text)
          setPreviewEmpty(false)
          // Only a 400 body is the backend's `; `-joined validation detail;
          // statuses like 404 (endpoint absent) carry no per-section paths.
          setPreviewProblems(
            apiErrorStatus(err) === 400
              ? parseValidationErrors(text).map((problem) => ({ ...problem }))
              : [],
          )
        })
        .finally(() => {
          if (previewSeq.current === seq) setPreviewBusy(false)
        })
    }, 300)
    return () => clearTimeout(timer)
  }, [form, manifest, dataset, bindings, columnTypes])

  const patch = (next: Partial<ManifestForm>) => setForm((current) => ({ ...current, ...next }))

  const patchChannel = (key: ChannelKey, next: Partial<ChannelForm>) =>
    setForm((current) => ({
      ...current,
      channels: { ...current.channels, [key]: { ...current.channels[key], ...next } },
    }))

  const patchTransform = (index: number, next: Partial<TransformForm>) =>
    setForm((current) => ({
      ...current,
      transforms: current.transforms.map((item, i) => (i === index ? { ...item, ...next } : item)),
    }))

  const patchTrace = (index: number, next: Partial<TraceForm>) =>
    setForm((current) => ({
      ...current,
      traces: current.traces.map((item, i) => (i === index ? { ...item, ...next } : item)),
    }))

  const patchOption = (index: number, next: Partial<OptionForm>) =>
    setForm((current) => ({
      ...current,
      options: current.options.map((item, i) => (i === index ? { ...item, ...next } : item)),
    }))

  const dirtyRef = useRef(dirty)
  dirtyRef.current = dirty

  /** Replacing the form discards edits; ask first (draft apply, AI load). */
  const canReplaceForm = () =>
    !dirtyRef.current || window.confirm(t('chart.workbench.discard'))

  /**
   * Replace the whole form (AI draft, validation-rejected draft). Returns
   * `false` when the user keeps their edits instead of the incoming manifest.
   */
  const applyForm = (next: ManifestForm): boolean => {
    if (!canReplaceForm()) return false
    setSaveProblems([])
    // The id input is locked while editing: a draft must not retarget the save
    // onto a new file and leave the chart being edited untouched.
    const applied = idLocked ? { ...next, id: form.id } : next
    setForm(applied)
    // An applied draft can declare channels (or a Y arity) the current
    // bindings cannot serve; re-seed so the preview follows the draft instead
    // of keeping wiring that no longer maps onto it.
    if (columns.length > 0) {
      setBindings((current) => reseedPreviewBindings(applied, current, columns))
    }
    return true
  }

  const requestClose = () => {
    if (dirty && !window.confirm(t('chart.workbench.discard'))) return
    closeWorkbench()
  }

  /**
   * Id the save will actually use. A blank field falls back to the suggested
   * `-copy` id, so "另存为副本" → "校验并保存" works without retyping.
   */
  const effectiveId = manifest.id !== '' ? manifest.id : suggestedId

  const handleSave = async () => {
    setSaveProblems([])
    const problems: WorkbenchProblem[] = Object.entries(formErrors).map(([path, message]) => ({
      path,
      message,
      section: sectionForPath(path),
    }))
    if (!isValidCustomChartId(effectiveId)) {
      problems.unshift({
        path: 'id',
        message: t('chart.workbench.invalidId'),
        section: 'manifest',
      })
    }
    if (problems.length > 0) {
      setSaveProblems(problems)
      return
    }
    // A blank id asks the backend to write a *new* file; reusing a saved id
    // silently replaces it (the endpoint answers `replaced: true`). An `edit`
    // session is exempt: replacing its own file is the whole point.
    if (
      !idLocked &&
      savedItems.some((item) => item.id === effectiveId) &&
      !window.confirm(t('chart.workbench.overwrite', { id: effectiveId }))
    ) {
      return
    }
    setSaving(true)
    try {
      const payload = manifest.id === effectiveId ? manifest : { ...manifest, id: effectiveId }
      const result = await save(payload)
      if (result.ok) {
        closeWorkbench()
        return
      }
      // The store already strips fetchJson's prefix; what is left is the
      // backend's `; `-joined validation detail.
      setSaveProblems(parseValidationErrors(result.message).map((problem) => ({ ...problem })))
    } finally {
      setSaving(false)
    }
  }

  const handleDuplicate = () => {
    const nextId = duplicateChartId(form.id !== '' ? form.id : (session.seed?.id ?? ''))
    setSuggestedId(nextId)
    patch({ id: '' })
  }

  const handleExport = () => {
    if (Object.keys(formErrors).length > 0) {
      setSaveProblems(
        Object.entries(formErrors).map(([path, message]) => ({
          path,
          message,
          section: sectionForPath(path),
        })),
      )
      return
    }
    const blob = new Blob([JSON.stringify(manifest, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `${manifest.id !== '' ? manifest.id : 'custom-chart'}.json`
    anchor.click()
    // Revoking in the same tick can cancel the download before the browser has
    // read the blob, so give it a moment.
    setTimeout(() => URL.revokeObjectURL(url), EXPORT_REVOKE_DELAY_MS)
  }

  const handleDraft = async () => {
    const request = aiRequest.trim()
    if (request === '') return
    setAiBusy(true)
    setAiProblems([])
    setAiMessage(null)
    try {
      const result = await api.draftCustomChart(request, dataset !== '' ? dataset : undefined)
      applyForm(manifestToForm(result.manifest))
    } catch (err) {
      const detail = apiErrorDetail(err)
      if (apiErrorStatus(err) === 422 && isRecord(detail)) {
        const rejection = detail as unknown as CustomChartDraftRejection
        if (rejection.draft) applyForm(manifestToForm(rejection.draft))
        setAiMessage(t('chart.workbench.ai.draftRejected'))
        setAiProblems(
          Array.isArray(rejection.errors) && rejection.errors.length > 0
            ? rejection.errors
            : parseValidationErrors(String(rejection.message ?? '')).map((p) => p.message),
        )
      } else {
        // 502 (LLM unavailable) also raises the app's LLM setup prompt, the same
        // guidance the cleaning/ask panels give; the raw detail stays on screen
        // either way so a non-502 failure is still diagnosable.
        if (isLlmUnavailableError(err)) {
          useUIStore.getState().setLlmSetupPromptOpen(true)
        }
        setAiMessage(t('chart.workbench.ai.failed', { message: backendErrorText(err) }))
      }
    } finally {
      setAiBusy(false)
    }
  }

  const ySlotCount = Y_MODE_SLOTS[form.yMode]

  return (
    <Modal
      isOpen
      size="full"
      scrollBehavior="normal"
      onOpenChange={(open) => {
        if (!open) requestClose()
      }}
      classNames={{ base: 'h-[92vh] max-h-[92vh]' }}
    >
      <ModalContent>
        <ModalHeader className="flex items-center gap-2 text-sm">
          <span>{t('chart.workbench.title')}</span>
          <span className="text-[11px] font-normal text-muted">
            {t(
              session.mode === 'edit'
                ? 'chart.workbench.edit'
                : session.mode === 'duplicate'
                  ? 'chart.workbench.duplicate'
                  : 'chart.workbench.new',
            )}
            {form.id !== '' ? ` · ${form.id}` : ''}
          </span>
        </ModalHeader>
        <ModalBody className="grid min-h-0 flex-1 grid-cols-[3fr_2fr] gap-3 overflow-hidden p-0">
          <div className="flex min-h-0 flex-col gap-2 overflow-y-auto p-3">
            {/* 1. basics */}
            <Section
              title={t('chart.workbench.section.basics')}
              flagged={flaggedSections.has('manifest')}
            >
              <div className="grid grid-cols-2 gap-2">
                <Input
                  size="sm"
                  isRequired
                  isReadOnly={idLocked}
                  isDisabled={idLocked}
                  label={t('chart.workbench.field.id')}
                  placeholder={suggestedId || 'my-chart'}
                  value={form.id}
                  onValueChange={(value) => patch({ id: value })}
                  isInvalid={form.id !== '' && !isValidCustomChartId(form.id)}
                  errorMessage={
                    form.id !== '' && !isValidCustomChartId(form.id)
                      ? t('chart.workbench.invalidId')
                      : undefined
                  }
                  classNames={{ input: 'text-xs', inputWrapper: 'h-8 min-h-8', label: FIELD_LABEL }}
                />
                <Input
                  size="sm"
                  label={t('chart.workbench.field.keywords')}
                  value={form.keywords}
                  onValueChange={(value) => patch({ keywords: value })}
                  isInvalid={formErrors.keywords !== undefined}
                  errorMessage={formErrors.keywords}
                  classNames={{ input: 'text-xs', inputWrapper: 'h-8 min-h-8', label: FIELD_LABEL }}
                />
                <Input
                  size="sm"
                  isRequired
                  label={t('chart.workbench.field.labelZh')}
                  value={form.label.zh}
                  onValueChange={(value) => patch({ label: { ...form.label, zh: value } })}
                  classNames={{ input: 'text-xs', inputWrapper: 'h-8 min-h-8', label: FIELD_LABEL }}
                />
                <Input
                  size="sm"
                  isRequired
                  label={t('chart.workbench.field.labelEn')}
                  value={form.label.en}
                  onValueChange={(value) => patch({ label: { ...form.label, en: value } })}
                  classNames={{ input: 'text-xs', inputWrapper: 'h-8 min-h-8', label: FIELD_LABEL }}
                />
                <Input
                  size="sm"
                  label={t('chart.workbench.field.descriptionZh')}
                  value={form.description.zh}
                  onValueChange={(value) =>
                    patch({ description: { ...form.description, zh: value } })
                  }
                  classNames={{ input: 'text-xs', inputWrapper: 'h-8 min-h-8', label: FIELD_LABEL }}
                />
                <Input
                  size="sm"
                  label={t('chart.workbench.field.descriptionEn')}
                  value={form.description.en}
                  onValueChange={(value) =>
                    patch({ description: { ...form.description, en: value } })
                  }
                  classNames={{ input: 'text-xs', inputWrapper: 'h-8 min-h-8', label: FIELD_LABEL }}
                />
              </div>
            </Section>

            {/* 2. channels */}
            <Section
              title={t('chart.workbench.section.channels')}
              flagged={flaggedSections.has('channels')}
              defaultOpen
            >
              <div className="flex flex-col gap-1">
                <div className="grid grid-cols-[64px_56px_56px_minmax(0,1fr)] items-center gap-1.5">
                  <span className={FIELD_LABEL}>channel</span>
                  <span className={FIELD_LABEL}>{t('chart.workbench.field.required')}</span>
                  <span className={FIELD_LABEL}>{t('chart.workbench.field.types')}</span>
                </div>
                {CHANNEL_KEYS.map((key) => {
                  const channel = form.channels[key]
                  return (
                    <div
                      key={key}
                      className="grid grid-cols-[64px_56px_56px_minmax(0,1fr)] items-center gap-1.5"
                    >
                      <Checkbox
                        size="sm"
                        isSelected={channel.enabled}
                        onValueChange={(enabled) => patchChannel(key, { enabled })}
                      >
                        <span className="font-mono text-[11px]">{key}</span>
                      </Checkbox>
                      <Checkbox
                        size="sm"
                        isSelected={channel.required}
                        isDisabled={!channel.enabled}
                        onValueChange={(required) => patchChannel(key, { required })}
                      >
                        <span className="sr-only">{t('chart.workbench.field.required')}</span>
                        <span aria-hidden className="text-[11px]">
                          {channel.required ? '✓' : '—'}
                        </span>
                      </Checkbox>
                      <div className="col-span-2 min-w-0">
                        <Select
                          size="sm"
                          selectionMode="multiple"
                          aria-label={`${key} ${t('chart.workbench.field.types')}`}
                          isDisabled={!channel.enabled}
                          placeholder={t('chart.workbench.field.types')}
                          selectedKeys={new Set(channel.types)}
                          onSelectionChange={(keys) => {
                            const selected = Array.from(keys).map(String)
                            patchChannel(key, {
                              types: CHANNEL_TYPES.filter((type) => selected.includes(type)),
                            })
                          }}
                          classNames={{
                            trigger: 'h-7 min-h-7',
                            value: 'text-[11px]',
                            label: FIELD_LABEL,
                          }}
                        >
                          {CHANNEL_TYPES.map((type) => (
                            <SelectItem key={type} textValue={type}>
                              {type}
                            </SelectItem>
                          ))}
                        </Select>
                      </div>
                    </div>
                  )
                })}
                <div className="mt-1 flex items-center gap-2">
                  <span className="w-[72px] shrink-0 font-mono text-[11px]">yFields</span>
                  <Select
                    size="sm"
                    aria-label={t('chart.workbench.field.yMode')}
                    selectedKeys={[form.yMode]}
                    onSelectionChange={(keys) => {
                      const next = String(Array.from(keys)[0] ?? '')
                      if ((Y_MODES as readonly string[]).includes(next)) {
                        patch({ yMode: next as ManifestForm['yMode'] })
                      }
                    }}
                    classNames={{ trigger: 'h-7 min-h-7', value: 'text-[11px]' }}
                  >
                    {Y_MODES.map((mode) => (
                      <SelectItem key={mode} textValue={mode}>
                        {mode}
                      </SelectItem>
                    ))}
                  </Select>
                </div>
                <div className="mt-1 flex items-center gap-2">
                  <span className="w-[72px] shrink-0 font-mono text-[11px]">facetBy</span>
                  <Select
                    size="sm"
                    aria-label="facetBy"
                    selectedKeys={[form.facetBy === '' ? 'none' : form.facetBy]}
                    onSelectionChange={(keys) => {
                      const next = String(Array.from(keys)[0] ?? 'none')
                      patch({ facetBy: next === '$color' ? '$color' : '' })
                    }}
                    classNames={{ trigger: 'h-7 min-h-7', value: 'text-[11px]' }}
                  >
                    <SelectItem key="none" textValue="none">
                      none
                    </SelectItem>
                    <SelectItem key="$color" textValue="$color">
                      $color
                    </SelectItem>
                  </Select>
                </div>
                <p className={HINT}>{t('chart.workbench.hint.channels')}</p>
              </div>
            </Section>

            {/* 3. transforms */}
            <Section
              title={t('chart.workbench.section.transforms')}
              flagged={flaggedSections.has('transforms')}
              defaultOpen={form.transforms.length > 0}
            >
              <div className="flex flex-col gap-1.5">
                {form.transforms.length === 0 && <p className={HINT}>—</p>}
                {form.transforms.map((transform, index) => (
                  <div
                    key={index}
                    className="flex flex-col gap-1 rounded border border-border bg-surface p-1.5"
                  >
                    <div className="flex items-center gap-1">
                      <span className="w-4 shrink-0 text-[10px] text-muted">{index + 1}</span>
                      <Select
                        size="sm"
                        aria-label={t('chart.workbench.field.op')}
                        selectedKeys={[transform.op]}
                        onSelectionChange={(keys) => {
                          const next = String(Array.from(keys)[0] ?? '')
                          if ((TRANSFORM_OPS as readonly string[]).includes(next)) {
                            patchTransform(index, { op: next as TransformOp })
                          }
                        }}
                        classNames={{ trigger: 'h-7 min-h-7', value: 'text-[11px]' }}
                      >
                        {TRANSFORM_OPS.map((op) => (
                          <SelectItem key={op} textValue={op}>
                            {op}
                          </SelectItem>
                        ))}
                      </Select>
                      <IconButton
                        label="↑"
                        disabled={index === 0}
                        onPress={() =>
                          patch({ transforms: moveItem(form.transforms, index, index - 1) })
                        }
                      />
                      <IconButton
                        label="↓"
                        disabled={index === form.transforms.length - 1}
                        onPress={() =>
                          patch({ transforms: moveItem(form.transforms, index, index + 1) })
                        }
                      />
                      <IconButton
                        label="×"
                        danger
                        onPress={() =>
                          patch({
                            transforms: form.transforms.filter((_, i) => i !== index),
                          })
                        }
                      />
                    </div>
                    <TransformFields
                      transform={transform}
                      onChange={(next) => patchTransform(index, next)}
                    />
                  </div>
                ))}
                <Button
                  size="sm"
                  variant="flat"
                  className="w-full text-xs"
                  startContent={<Plus className="h-3 w-3" />}
                  onPress={() =>
                    patch({ transforms: [...form.transforms, emptyTransform('dropna')] })
                  }
                >
                  {t('chart.workbench.addTransform')}
                </Button>
              </div>
            </Section>

            {/* 4. traces */}
            <Section
              title={t('chart.workbench.section.traces')}
              flagged={flaggedSections.has('traces')}
              defaultOpen
            >
              <div className="flex flex-col gap-1.5">
                <p className={HINT}>
                  {t('chart.workbench.field.traceType')}: {TRACE_TYPES.join(' / ')} · splitBy:{' '}
                  {SPLIT_BY_TRACE_TYPES.join(' / ')}
                </p>
                {form.traces.map((trace, index) => (
                  <div
                    key={index}
                    className="flex flex-col gap-1 rounded border border-border bg-surface p-1.5"
                  >
                    <div className="flex items-center gap-1">
                      <span className="w-4 shrink-0 text-[10px] text-muted">{index + 1}</span>
                      <IconButton
                        label="↑"
                        disabled={index === 0}
                        onPress={() => patch({ traces: moveItem(form.traces, index, index - 1) })}
                      />
                      <IconButton
                        label="↓"
                        disabled={index === form.traces.length - 1}
                        onPress={() => patch({ traces: moveItem(form.traces, index, index + 1) })}
                      />
                      <IconButton
                        label="×"
                        danger
                        onPress={() => patch({ traces: form.traces.filter((_, i) => i !== index) })}
                      />
                    </div>
                    <TraceEditor
                      trace={trace}
                      form={form}
                      error={formErrors[`traces[${index}].json`]}
                      onChange={(next) => patchTrace(index, next)}
                    />
                  </div>
                ))}
                <Button
                  size="sm"
                  variant="flat"
                  className="w-full text-xs"
                  startContent={<Plus className="h-3 w-3" />}
                  onPress={() =>
                    patch({ traces: [...form.traces, { type: 'scatter', json: '' }] })
                  }
                >
                  {t('chart.workbench.addTrace')}
                </Button>
              </div>
            </Section>

            {/* 5. layout */}
            <Section
              title={t('chart.workbench.section.layout')}
              flagged={flaggedSections.has('layout')}
              defaultOpen={false}
            >
              <LayoutEditor
                layout={form.layout}
                options={form.options}
                error={formErrors.layout}
                onChange={(layout) => patch({ layout })}
              />
            </Section>

            {/* 6. options */}
            <Section
              title={t('chart.workbench.section.options')}
              flagged={flaggedSections.has('options')}
              defaultOpen={form.options.length > 0}
            >
              <div className="flex flex-col gap-1.5">
                {form.options.length === 0 && <p className={HINT}>—</p>}
                {form.options.map((option, index) => (
                  <div
                    key={index}
                    className="flex flex-col gap-1 rounded border border-border bg-surface p-1.5"
                  >
                    <div className="flex items-center gap-1">
                      <Input
                        size="sm"
                        placeholder="key"
                        value={option.key}
                        onValueChange={(key) => patchOption(index, { key })}
                        classNames={{ input: 'font-mono text-[11px]', inputWrapper: 'h-7 min-h-7' }}
                      />
                      <Select
                        size="sm"
                        aria-label={`option type ${index + 1}`}
                        selectedKeys={[option.type]}
                        onSelectionChange={(keys) => {
                          const next = String(Array.from(keys)[0] ?? '')
                          if ((OPTION_TYPES as readonly string[]).includes(next)) {
                            patchOption(index, {
                              type: next as OptionForm['type'],
                              choices: next === 'select' ? option.choices : '',
                            })
                          }
                        }}
                        classNames={{ trigger: 'h-7 min-h-7', value: 'text-[11px]' }}
                      >
                        {OPTION_TYPES.map((type) => (
                          <SelectItem key={type} textValue={type}>
                            {type}
                          </SelectItem>
                        ))}
                      </Select>
                      <IconButton
                        label="×"
                        danger
                        onPress={() =>
                          patch({ options: form.options.filter((_, i) => i !== index) })
                        }
                      />
                    </div>
                    <div className="grid grid-cols-3 gap-1.5">
                      <Input
                        size="sm"
                        label="default"
                        value={option.default}
                        onValueChange={(value) => patchOption(index, { default: value })}
                        isInvalid={formErrors[`options[${index}].default`] !== undefined}
                        errorMessage={formErrors[`options[${index}].default`]}
                        classNames={{ input: 'text-[11px]', inputWrapper: 'h-7 min-h-7', label: FIELD_LABEL }}
                      />
                      <Input
                        size="sm"
                        label="zh"
                        value={option.labelZh}
                        onValueChange={(labelZh) => patchOption(index, { labelZh })}
                        classNames={{ input: 'text-[11px]', inputWrapper: 'h-7 min-h-7', label: FIELD_LABEL }}
                      />
                      <Input
                        size="sm"
                        label="en"
                        value={option.labelEn}
                        onValueChange={(labelEn) => patchOption(index, { labelEn })}
                        classNames={{ input: 'text-[11px]', inputWrapper: 'h-7 min-h-7', label: FIELD_LABEL }}
                      />
                    </div>
                    {option.type === 'select' && (
                      <Input
                        size="sm"
                        label="choices"
                        placeholder="a, b, c"
                        value={option.choices}
                        onValueChange={(choices) => patchOption(index, { choices })}
                        isInvalid={formErrors[`options[${index}].choices`] !== undefined}
                        errorMessage={formErrors[`options[${index}].choices`]}
                        classNames={{ input: 'text-[11px]', inputWrapper: 'h-7 min-h-7', label: FIELD_LABEL }}
                      />
                    )}
                  </div>
                ))}
                <Button
                  size="sm"
                  variant="flat"
                  className="w-full text-xs"
                  startContent={<Plus className="h-3 w-3" />}
                  onPress={() => patch({ options: [...form.options, emptyOption()] })}
                >
                  {t('chart.workbench.addOption')}
                </Button>
              </div>
            </Section>
          </div>

          {/* right column: preview + bindings + AI + errors */}
          <div className="flex min-h-0 flex-col gap-2 overflow-y-auto border-l border-border p-3">
            <Select
              size="sm"
              label={t('chart.workbench.previewDataset')}
              aria-label={t('chart.workbench.previewDataset')}
              selectedKeys={dataset !== '' ? [dataset] : []}
              onSelectionChange={(keys) => setDataset(String(Array.from(keys)[0] ?? ''))}
              classNames={{ trigger: 'h-8 min-h-8', value: 'text-xs', label: FIELD_LABEL }}
            >
              {dataFrames.map((frame) => (
                <SelectItem key={frame.id} textValue={frame.name}>
                  {frame.name}
                </SelectItem>
              ))}
            </Select>

            <BindingEditor
              form={form}
              bindings={bindings}
              columns={columns}
              onChange={setBindings}
              ySlotCount={ySlotCount}
            />

            <div className="flex items-center justify-between">
              <span className={FIELD_LABEL}>{t('chart.workbench.preview')}</span>
              {previewBusy && <Spinner size="sm" />}
            </div>
            <div className="min-h-[220px] flex-1 rounded border border-border bg-surface">
              {previewError ? (
                <div className={`m-2 ${ERROR_BOX}`}>{previewError}</div>
              ) : dataset === '' ? (
                <div className="flex h-full items-center justify-center p-3 text-center text-[11px] text-muted">
                  {t('chart.workbench.previewDataset')}
                </div>
              ) : previewEmpty ? (
                // Render succeeded but drew nothing: a required channel is still
                // unbound, so the placeholder is more useful than an empty frame.
                <div className="flex h-full items-center justify-center p-3 text-center text-[11px] text-muted">
                  {t('chart.workbench.previewEmpty')}
                </div>
              ) : (
                <PlotlyRenderer
                  figure={figure}
                  className="h-full min-h-[220px] w-full"
                />
              )}
            </div>

            <div className="flex flex-col gap-1 rounded border border-border p-2">
              <span className="text-xs font-semibold">{t('chart.workbench.ai.title')}</span>
              <Textarea
                size="sm"
                minRows={2}
                placeholder={t('chart.workbench.ai.placeholder')}
                value={aiRequest}
                onValueChange={setAiRequest}
                classNames={{ input: 'text-[11px]' }}
              />
              <Button
                size="sm"
                color="primary"
                variant="flat"
                className="text-xs"
                isLoading={aiBusy}
                isDisabled={aiRequest.trim() === ''}
                startContent={!aiBusy && <Sparkles className="h-3 w-3" />}
                onPress={() => void handleDraft()}
              >
                {t('chart.workbench.ai.generate')}
              </Button>
              {aiMessage && <div className={ERROR_BOX}>{aiMessage}</div>}
              {aiProblems.length > 0 && (
                <ul className="list-disc pl-4 text-[10px] text-danger">
                  {aiProblems.map((problem, index) => (
                    <li key={index}>{problem}</li>
                  ))}
                </ul>
              )}
            </div>

            <div className="flex flex-col gap-1 rounded border border-border p-2">
              <span className="text-xs font-semibold">{t('chart.workbench.errors')}</span>
              {allProblems.length === 0 ? (
                <span className="text-[11px] text-success">{t('chart.workbench.errorsOk')}</span>
              ) : (
                <ul className="flex flex-col gap-0.5 text-[10px] text-danger">
                  {allProblems.map((problem, index) => (
                    <li key={`${problem.path}:${index}`} className="break-words">
                      {problem.path !== '' && (
                        <span className="font-mono text-muted">{problem.path}: </span>
                      )}
                      {problem.message}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </ModalBody>
        <ModalFooter className="gap-2">
          <Button size="sm" variant="light" className="text-xs" onPress={requestClose}>
            {t('chart.workbench.cancel')}
          </Button>
          <Button
            size="sm"
            variant="flat"
            className="text-xs"
            startContent={<Download className="h-3 w-3" />}
            onPress={handleExport}
          >
            {t('chart.workbench.export')}
          </Button>
          <Button
            size="sm"
            variant="flat"
            className="text-xs"
            startContent={<Copy className="h-3 w-3" />}
            onPress={handleDuplicate}
          >
            {t('chart.workbench.duplicate')}
          </Button>
          <Button
            size="sm"
            color="primary"
            className="text-xs"
            isLoading={saving}
            onPress={() => void handleSave()}
          >
            {t('chart.workbench.save')}
          </Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  )
}

/** Collapsible form section; `flagged` renders the error dot next to the title. */
function Section({
  title,
  flagged,
  defaultOpen = true,
  children,
}: {
  title: string
  flagged: boolean
  defaultOpen?: boolean
  children: React.ReactNode
}) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div className="rounded border border-border">
      <button
        type="button"
        className="flex w-full cursor-pointer items-center justify-between bg-surface-elevated px-2 py-1.5 text-xs font-semibold text-muted transition-colors hover:text-foreground"
        onClick={() => setOpen(!open)}
      >
        <span className="flex items-center gap-1.5">
          {title}
          {flagged && (
            <span
              className="h-1.5 w-1.5 rounded-full bg-danger"
              title="errors"
              aria-label="errors"
            />
          )}
        </span>
        {open ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
      </button>
      {open && <div className="p-2">{children}</div>}
    </div>
  )
}

/** Tiny icon-ish button used for the per-row reorder/remove controls. */
function IconButton({
  label,
  onPress,
  disabled = false,
  danger = false,
}: {
  label: string
  onPress: () => void
  disabled?: boolean
  danger?: boolean
}) {
  return (
    <Button
      isIconOnly
      size="sm"
      variant="light"
      color={danger ? 'danger' : 'default'}
      isDisabled={disabled}
      className="h-6 w-6 min-w-0 shrink-0"
      aria-label={label}
      onPress={onPress}
    >
      <span className="text-[11px]">{label}</span>
    </Button>
  )
}

/** Op-specific fields; only the keys the selected op accepts are rendered. */
function TransformFields({
  transform,
  onChange,
}: {
  transform: TransformForm
  onChange: (next: Partial<TransformForm>) => void
}) {
  const cls = {
    input: 'text-[11px]',
    inputWrapper: 'h-7 min-h-7',
    label: FIELD_LABEL,
  }
  switch (transform.op) {
    case 'dropna':
      return (
        <Input
          size="sm"
          label="slots"
          placeholder="x, y0"
          value={transform.slots}
          onValueChange={(slots) => onChange({ slots })}
          classNames={cls}
        />
      )
    case 'sort':
      return (
        <div className="flex items-end gap-1.5">
          <Input
            size="sm"
            label="by"
            placeholder="y0"
            value={transform.by}
            onValueChange={(by) => onChange({ by })}
            classNames={cls}
          />
          <Checkbox
            size="sm"
            isSelected={transform.descending}
            onValueChange={(descending) => onChange({ descending })}
          >
            <span className="text-[11px]">descending</span>
          </Checkbox>
        </div>
      )
    case 'limit':
      return (
        <div className="flex items-end gap-1.5">
          <Input
            size="sm"
            label="count"
            type="number"
            value={transform.count}
            onValueChange={(count) => onChange({ count })}
            classNames={cls}
          />
          <Select
            size="sm"
            aria-label="from"
            selectedKeys={[transform.from]}
            onSelectionChange={(keys) =>
              onChange({ from: String(Array.from(keys)[0] ?? 'top') === 'bottom' ? 'bottom' : 'top' })
            }
            classNames={{ trigger: 'h-7 min-h-7', value: 'text-[11px]' }}
          >
            <SelectItem key="top">top</SelectItem>
            <SelectItem key="bottom">bottom</SelectItem>
          </Select>
        </div>
      )
    case 'group_agg':
      return (
        <div className="grid grid-cols-2 gap-1.5">
          <Input
            size="sm"
            label="groupBy"
            placeholder="x, color"
            value={transform.groupBy}
            onValueChange={(groupBy) => onChange({ groupBy })}
            classNames={cls}
          />
          <Input
            size="sm"
            label="field"
            value={transform.field}
            onValueChange={(field) => onChange({ field })}
            classNames={cls}
          />
          <AggSelect value={transform.agg} onChange={(agg) => onChange({ agg })} />
          <Input
            size="sm"
            label="as"
            value={transform.as}
            onValueChange={(as) => onChange({ as })}
            classNames={cls}
          />
        </div>
      )
    case 'cumulate':
      return (
        <div className="grid grid-cols-2 gap-1.5">
          <Input
            size="sm"
            label="field"
            value={transform.field}
            onValueChange={(field) => onChange({ field })}
            classNames={cls}
          />
          <Input
            size="sm"
            label="as"
            value={transform.as}
            onValueChange={(as) => onChange({ as })}
            classNames={cls}
          />
        </div>
      )
    case 'reduce':
    default:
      return (
        <div className="grid grid-cols-3 gap-1.5">
          <Input
            size="sm"
            label="field"
            value={transform.field}
            onValueChange={(field) => onChange({ field })}
            classNames={cls}
          />
          <AggSelect value={transform.agg} onChange={(agg) => onChange({ agg })} />
          <Input
            size="sm"
            label="as"
            value={transform.as}
            onValueChange={(as) => onChange({ as })}
            classNames={cls}
          />
        </div>
      )
  }
}

function AggSelect({ value, onChange }: { value: string; onChange: (next: string) => void }) {
  return (
    <Select
      size="sm"
      aria-label="agg"
      selectedKeys={[value]}
      onSelectionChange={(keys) => onChange(String(Array.from(keys)[0] ?? 'sum'))}
      classNames={{ trigger: 'h-7 min-h-7', value: 'text-[11px]', label: FIELD_LABEL }}
    >
      {AGGREGATES.map((agg) => (
        <SelectItem key={agg} textValue={agg}>
          {agg}
        </SelectItem>
      ))}
    </Select>
  )
}

/** Preview bindings: one select per declared channel plus the Y slots. */
function BindingEditor({
  form,
  bindings,
  columns,
  onChange,
  ySlotCount,
}: {
  form: ManifestForm
  bindings: PreviewBindings
  columns: ColumnMeta[]
  onChange: (next: PreviewBindings) => void
  ySlotCount: number
}) {
  const { t } = useTranslation()
  const declared = PREVIEW_CHANNELS.filter((key) => form.channels[key].enabled)
  const ySlots = Array.from({ length: ySlotCount }, (_, index) => index)

  const setField = (key: PreviewChannelKey, value: string) =>
    onChange({ ...bindings, fields: { ...bindings.fields, [key]: value } })

  const setYField = (index: number, value: string) => {
    const yFields = [...bindings.yFields]
    while (yFields.length < ySlotCount) yFields.push('')
    yFields[index] = value
    onChange({ ...bindings, yFields })
  }

  return (
    <div className="flex flex-col gap-1 rounded border border-border p-2">
      <span className="text-xs font-semibold">{t('chart.workbench.previewEncoding')}</span>
      {declared.length === 0 && ySlotCount === 0 && (
        <span className="text-[10px] text-muted">—</span>
      )}
      <div className="grid grid-cols-2 gap-1.5">
        {declared.map((key) => (
          <div key={key} className="flex items-center gap-0.5">
            <Select
              size="sm"
              aria-label={key}
              label={key}
              placeholder={key}
              selectedKeys={bindings.fields[key] ? [bindings.fields[key] as string] : []}
              onSelectionChange={(keys) => setField(key, String(Array.from(keys)[0] ?? ''))}
              classNames={{ trigger: 'h-7 min-h-7', value: 'text-[11px]', label: FIELD_LABEL }}
            >
              {columns.map((column) => (
                <SelectItem key={column.name} textValue={column.name}>
                  {column.name}
                </SelectItem>
              ))}
            </Select>
            {bindings.fields[key] && (
              <Button
                isIconOnly
                size="sm"
                variant="light"
                className="h-6 w-5 min-w-0 shrink-0"
                aria-label={`clear ${key}`}
                onPress={() => setField(key, '')}
              >
                <X className="h-3 w-3" />
              </Button>
            )}
          </div>
        ))}
        {ySlots.map((index) => (
          <Select
            key={`y${index}`}
            size="sm"
            aria-label={`y${index}`}
            label={`y${index}`}
            placeholder={`y${index}`}
            selectedKeys={bindings.yFields[index] ? [bindings.yFields[index]] : []}
            onSelectionChange={(keys) => setYField(index, String(Array.from(keys)[0] ?? ''))}
            classNames={{ trigger: 'h-7 min-h-7', value: 'text-[11px]', label: FIELD_LABEL }}
          >
            {columns.map((column) => (
              <SelectItem key={column.name} textValue={column.name}>
                {column.name}
              </SelectItem>
            ))}
          </Select>
        ))}
      </div>
    </div>
  )
}
