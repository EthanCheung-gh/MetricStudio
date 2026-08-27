import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button, Select, SelectItem } from '@heroui/react'
import { GitBranch, Power, RotateCcw } from 'lucide-react'
import { api } from '@/api/client'
import type { DataDiffResult, DataPreview, LineageEdge, LineageNode, LineageResponse } from '@/types/data'

const NODE_W = 84
const NODE_H = 34
const GAP_X = 30
const MAIN_Y = 52
const JOIN_Y = 132

function summarizeParams(params: Record<string, unknown>): string {
  const pick: [string, string][] = [
    ['column', 'col'],
    ['operator', 'op'],
    ['value', 'value'],
    ['columns', 'cols'],
    ['mappings', 'map'],
    ['expression', 'expr'],
    ['how', 'how'],
    ['on', 'on'],
    ['right_dataset_id', 'right'],
    ['right_step', 'at'],
  ]
  const parts: string[] = []
  for (const [key, label] of pick) {
    const v = params[key]
    if (v === undefined || v === null) continue
    if (typeof v === 'object') parts.push(`${label}=${JSON.stringify(v)}`)
    else parts.push(`${label}=${v}`)
  }
  return parts.join('  ')
}

interface ChainItem {
  node: LineageNode
  joinTarget: { edge: LineageEdge; node: LineageNode | null } | null
}

export function LineageView({ datasetId }: { datasetId: string | null }) {
  const { t } = useTranslation()
  const [lineage, setLineage] = useState<LineageResponse | null>(null)
  const [selected, setSelected] = useState<number | null>(null)
  const [baselineStep, setBaselineStep] = useState(-1)
  const [preview, setPreview] = useState<DataPreview | null>(null)
  const [diffResult, setDiffResult] = useState<DataDiffResult | null>(null)
  const [loadingPreview, setLoadingPreview] = useState(false)
  const [loadingDiff, setLoadingDiff] = useState(false)
  const [disabledSteps, setDisabledSteps] = useState<Record<number, boolean>>({})

  useEffect(() => {
    setLineage(null)
    setSelected(null)
    setBaselineStep(-1)
    setPreview(null)
    setDiffResult(null)
    setDisabledSteps({})
    if (!datasetId) return
    api
      .lineage()
      .then(setLineage)
      .catch(() => {})
    api
      .history(datasetId)
      .then((items) =>
        setDisabledSteps(Object.fromEntries(items.map((item, index) => [index, Boolean(item.disabled)]))),
      )
      .catch(() => {})
  }, [datasetId])

  const toggleStep = async (step: number) => {
    if (!datasetId || step < 0) return
    const next = !disabledSteps[step]
    try {
      await api.setStepDisabled(datasetId, step, next)
      setDisabledSteps((current) => ({ ...current, [step]: next }))
      const items = await api.history(datasetId).catch(() => [])
      setDisabledSteps(Object.fromEntries(items.map((item, index) => [index, Boolean(item.disabled)])))
      api
        .lineage()
        .then(setLineage)
        .catch(() => {})
    } catch {
      /* keep previous state on failure */
    }
  }

  const chain: ChainItem[] = useMemo(() => {
    if (!lineage || !datasetId) return []
    const nodes = lineage.nodes
      .filter((n) => n.dataset_id === datasetId)
      .sort((a, b) => a.step - b.step)
    const byId = new Map(lineage.nodes.map((n) => [n.id, n]))
    return nodes.map((node) => {
      const cross = lineage.edges.find((e) => e.cross && e.source === node.id)
      return {
        node,
        joinTarget: cross ? { edge: cross, node: byId.get(cross.target) ?? null } : null,
      }
    })
  }, [lineage, datasetId])

  const selectedNode = chain.find((c) => c.node.step === selected)?.node ?? null

  const selectNode = async (item: ChainItem) => {
    setSelected(item.node.step)
    setPreview(null)
    setDiffResult(null)
    if (!datasetId) return
    setLoadingPreview(true)
    try {
      const p = await api.previewDataFrame(datasetId, { limit: 20, at: item.node.step })
      setPreview(p)
    } catch {
      /* ignore */
    } finally {
      setLoadingPreview(false)
    }
  }

  const compareSteps = async () => {
    if (!datasetId || selected === null || selected === baselineStep) return
    setLoadingDiff(true)
    try {
      setDiffResult(await api.diffSteps(datasetId, baselineStep, selected))
    } catch {
      setDiffResult(null)
    } finally {
      setLoadingDiff(false)
    }
  }

  if (!datasetId) {
    return (
      <div className="flex h-full items-center justify-center text-xs text-muted">
        No dataset selected
      </div>
    )
  }

  if (!lineage) {
    return (
      <div className="flex h-full items-center justify-center text-xs text-muted">
        Loading lineage…
      </div>
    )
  }

  if (chain.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 text-muted">
        <GitBranch className="h-8 w-8 opacity-30" />
        <p className="text-xs">No transform history for this dataset</p>
      </div>
    )
  }

  const width = Math.max(320, chain.length * (NODE_W + GAP_X) + 24)
  const hasJoin = chain.some((c) => c.joinTarget)
  const height = hasJoin ? 200 : 120

  return (
    <div className="flex h-full min-h-0 flex-col overflow-auto">
      <div className="flex-1 p-3">
        <svg width={width} height={height} className="select-none">
          {/* main chain edges */}
          {chain.slice(1).map((item, i) => {
            const x0 = (i - 1) * (NODE_W + GAP_X) + NODE_W
            const x1 = i * (NODE_W + GAP_X)
            return (
              <line
                key={`edge-${item.node.id}`}
                x1={x0}
                y1={MAIN_Y + NODE_H / 2}
                x2={x1}
                y2={MAIN_Y + NODE_H / 2}
                className="stroke-border"
                strokeWidth={1.5}
              />
            )
          })}
          {/* join cross edges */}
          {chain.map((item, i) => {
            if (!item.joinTarget) return null
            const x = i * (NODE_W + GAP_X) + NODE_W / 2
            const y1 = MAIN_Y + NODE_H
            const y2 = JOIN_Y - 6
            return (
              <path
                key={`cross-${item.node.id}`}
                d={`M ${x} ${y1} C ${x} ${(y1 + y2) / 2}, ${x} ${(y1 + y2) / 2}, ${x} ${y2}`}
                className="stroke-primary/60"
                strokeWidth={1.5}
                fill="none"
                style={{ strokeDasharray: '4 3' }}
              />
            )
          })}
          {/* main chain nodes */}
          {chain.map((item, i) => {
            const x = i * (NODE_W + GAP_X)
            const active = selected === item.node.step
            const isImport = item.node.step === -1
            const isJoin = item.node.op === 'join'
            const isDisabled = !isImport && disabledSteps[item.node.step]
            return (
              <g key={item.node.id} className="cursor-pointer" onClick={() => selectNode(item)}>
                <rect
                  x={x}
                  y={MAIN_Y}
                  width={NODE_W}
                  height={NODE_H}
                  rx={6}
                  className={
                    isDisabled
                      ? active
                        ? 'fill-warning/15 stroke-warning'
                        : 'fill-surface stroke-border opacity-50'
                      : isImport
                        ? 'fill-primary/20 stroke-primary'
                        : isJoin
                          ? 'fill-accent/20 stroke-accent'
                          : active
                            ? 'fill-primary/15 stroke-primary'
                            : 'fill-surface stroke-border'
                  }
                  strokeWidth={active ? 2 : 1}
                />
                <text
                  x={x + NODE_W / 2}
                  y={MAIN_Y + NODE_H / 2 + 4}
                  textAnchor="middle"
                  className={isDisabled ? 'text-muted' : 'text-foreground'}
                  style={{ fill: 'currentColor', textDecoration: isDisabled ? 'line-through' : undefined }}
                  fontSize={11}
                  fontWeight={active ? 600 : 400}
                >
                  {isImport ? 'import' : item.node.op}
                </text>
              </g>
            )
          })}
          {/* join ghost nodes (right table reference) */}
          {chain.map((item, i) => {
            if (!item.joinTarget) return null
            const x = i * (NODE_W + GAP_X)
            const t = item.joinTarget.node
            const label = t ? `${t.dataset_name} #${t.step}` : 'right table'
            return (
              <g key={`ghost-${item.node.id}`}>
                <rect
                  x={x}
                  y={JOIN_Y}
                  width={NODE_W}
                  height={NODE_H}
                  rx={6}
                  className="fill-surface stroke-border"
                  style={{ strokeDasharray: '4 3' }}
                />
                <text
                  x={x + NODE_W / 2}
                  y={JOIN_Y + NODE_H / 2 + 4}
                  textAnchor="middle"
                  className="text-muted"
                  style={{ fill: 'currentColor' }}
                  fontSize={10}
                >
                  {label}
                </text>
              </g>
            )
          })}
        </svg>
      </div>

      {/* detail panel */}
      {selectedNode && (
        <div className="border-t border-border p-3 text-xs">
          <div className="flex flex-col gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-semibold">
                {selectedNode.step === -1 ? 'import' : selectedNode.op}
              </span>
              <span className="text-muted">{summarizeParams(selectedNode.params)}</span>
              {selectedNode.step >= 0 && (
                <>
                  {disabledSteps[selectedNode.step] && (
                    <span className="rounded bg-warning/15 px-1.5 py-0.5 text-[10px] text-warning">{t('lineage.stepDisabled')}</span>
                  )}
                  <Button
                    isIconOnly
                    size="sm"
                    variant="light"
                    className="h-6 w-6 min-w-0"
                    startContent={
                      disabledSteps[selectedNode.step]
                        ? <RotateCcw className="h-3.5 w-3.5 text-primary" />
                        : <Power className="h-3.5 w-3.5 text-warning" />
                    }
                    onPress={() => toggleStep(selectedNode.step)}
                    aria-label={disabledSteps[selectedNode.step] ? t('lineage.enableStep') : t('lineage.disableStep')}
                  />
                </>
              )}
            </div>
            {selectedNode.rows !== null && (
              <div className="text-muted">
                {selectedNode.rows} rows × {selectedNode.cols} cols
              </div>
            )}
            <div className="flex flex-wrap items-end gap-2 rounded border border-border bg-surface p-2">
              <Select
                size="sm"
                className="w-56"
                label={t('diff.baselineStep')}
                selectedKeys={[String(baselineStep)]}
                onSelectionChange={(keys) => {
                  const value = Array.from(keys)[0]
                  if (value !== undefined) {
                    setBaselineStep(Number(value))
                    setDiffResult(null)
                  }
                }}
              >
                {chain.map((item) => (
                  <SelectItem key={String(item.node.step)} textValue={item.node.step === -1 ? t('diff.importStep') : t('diff.stepLabel', { step: item.node.step + 1, op: item.node.op })}>
                    {item.node.step === -1
                      ? t('diff.importStep')
                      : t('diff.stepLabel', { step: item.node.step + 1, op: item.node.op })}
                  </SelectItem>
                ))}
              </Select>
              <Button
                size="sm"
                color="primary"
                isLoading={loadingDiff}
                isDisabled={selected === baselineStep}
                onPress={compareSteps}
              >
                {t('diff.compareSteps')}
              </Button>
              {selected === baselineStep && <span className="text-muted">{t('diff.sameVersion')}</span>}
            </div>
            {diffResult && (
              <div className="flex flex-col gap-2 rounded border border-border p-2">
                <div className="flex flex-wrap gap-4 text-muted">
                  <span>{t('diff.rows')}: {diffResult.left_rows} → {diffResult.right_rows}</span>
                  <span>{t('diff.cols')}: {diffResult.left_cols} → {diffResult.right_cols}</span>
                </div>
                {(diffResult.only_left.length > 0 || diffResult.only_right.length > 0) ? (
                  <div className="flex flex-wrap gap-4">
                    <span className="text-danger">{t('diff.onlyLeft')}: {diffResult.only_left.join(', ') || '—'}</span>
                    <span className="text-success">{t('diff.onlyRight')}: {diffResult.only_right.join(', ') || '—'}</span>
                  </div>
                ) : diffResult.left_rows === diffResult.right_rows && diffResult.left_cols === diffResult.right_cols ? (
                  <span className="text-muted">{t('diff.noStructuralChanges')}</span>
                ) : null}
                {diffResult.numeric_diff.length > 0 && (
                  <div className="flex flex-col gap-1">
                    <span className="font-semibold text-muted">{t('diff.numericMeanDiff')}</span>
                    {diffResult.numeric_diff.map((item) => (
                      <div key={item.column} className="flex gap-4">
                        <span className="w-24">{item.column}</span>
                        <span>{item.left_mean} → {item.right_mean}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
            {loadingPreview && <div className="text-muted">Loading preview…</div>}
            {preview && (
              <div className="overflow-auto rounded border border-border">
                <table className="w-full text-[11px]">
                  <thead className="bg-surface text-left text-muted">
                    <tr>
                      {preview.columns.map((c) => (
                        <th key={c} className="px-2 py-1 font-medium">
                          {c}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {preview.rows.slice(0, 8).map((row, ri) => (
                      <tr key={ri} className="border-t border-border">
                        {row.map((cell, ci) => (
                          <td key={ci} className="px-2 py-1">
                            {String(cell ?? '')}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
