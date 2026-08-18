import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button, Card, CardBody, Input, Select, SelectItem } from '@heroui/react'
import { RotateCcw } from 'lucide-react'
import { useDataStore } from '@/stores/dataStore'
import { api } from '@/api/client'
import { useUIStore } from '@/stores/uiStore'
import { globalUndo } from '@/utils/globalHistory'

const operators = [
  { key: 'eq', label: '=' },
  { key: 'ne', label: '!=' },
  { key: 'gt', label: '>' },
  { key: 'gte', label: '>=' },
  { key: 'lt', label: '<' },
  { key: 'lte', label: '<=' },
  { key: 'contains', label: 'contains' },
]

export function TransformPanel() {
  const { t } = useTranslation();
  const activeId = useDataStore((s) => s.activeDataFrameId)
  const columns = useDataStore((s) => s.columns)
  const setPreview = useDataStore((s) => s.refreshActiveDataFrame)
  const addNotification = useUIStore((s) => s.addNotification)
  const [filterCol, setFilterCol] = useState('')
  const [filterOp, setFilterOp] = useState('eq')
  const [filterVal, setFilterVal] = useState('')
  const [sortCol, setSortCol] = useState('')
  const [sortAsc, setSortAsc] = useState(true)
  const [renameFrom, setRenameFrom] = useState('')
  const [renameTo, setRenameTo] = useState('')
  const [computeName, setComputeName] = useState('')
  const [computeExpr, setComputeExpr] = useState('')
  const [computePreviewValues, setComputePreviewValues] = useState<(string | number | boolean | null)[] | null>(null)

  // Live read-only preview of the compute expression (debounced 300ms)
  useEffect(() => {
    if (!activeId || !computeExpr.trim()) {
      setComputePreviewValues(null)
      return
    }
    const timer = setTimeout(async () => {
      try {
        const { values } = await api.computePreview(activeId, computeExpr)
        setComputePreviewValues(values)
      } catch {
        setComputePreviewValues(null)
      }
    }, 300)
    return () => clearTimeout(timer)
  }, [activeId, computeExpr])

  const insertField = (name: string) => {
    setComputeExpr((prev) => (prev.trim() && !prev.endsWith(' ') ? prev + ' ' : prev) + name)
  }
  const dataFrames = useDataStore((s) => s.dataFrames)
  const [pivotIndex, setPivotIndex] = useState('')
  const [pivotColumns, setPivotColumns] = useState('')
  const [pivotValues, setPivotValues] = useState('')
  const [pivotAgg, setPivotAgg] = useState('sum')
  const [meltIdVars, setMeltIdVars] = useState<string[]>([])
  const [dropCols, setDropCols] = useState<string[]>([])
  const [strCol, setStrCol] = useState('')
  const [strAction, setStrAction] = useState('trim')
  const [strNewCol, setStrNewCol] = useState('')
  const [groupByCols, setGroupByCols] = useState<string[]>([])
  const [groupValueCol, setGroupValueCol] = useState('')
  const [groupAgg, setGroupAgg] = useState('sum')
  const [sampleN, setSampleN] = useState('')
  const [joinRight, setJoinRight] = useState('')
  const [joinOn, setJoinOn] = useState('')
  const [joinHow, setJoinHow] = useState('inner')
  const [loading, setLoading] = useState(false)
  const [undoing, setUndoing] = useState(false)

  const handleFilter = async () => {
    if (!activeId || !filterCol || !filterVal) return
    setLoading(true)
    try {
      await api.filter(activeId, { column: filterCol, operator: filterOp as never, value: filterVal })
      await setPreview()
      addNotification('success', t('transform.filterApplied'))
    } catch (err) {
      addNotification('error', err instanceof Error ? err.message : t('transform.filterFailed'))
    } finally {
      setLoading(false)
    }
  }

  const handleSort = async () => {
    if (!activeId || !sortCol) return
    setLoading(true)
    try {
      await api.sort(activeId, { column: sortCol, ascending: sortAsc })
      await setPreview()
      addNotification('success', t('transform.sortApplied'))
    } catch (err) {
      addNotification('error', err instanceof Error ? err.message : t('transform.sortFailed'))
    } finally {
      setLoading(false)
    }
  }

  const handleDropNa = async () => {
    if (!activeId) return
    setLoading(true)
    try {
      await api.dropNa(activeId)
      await setPreview()
      addNotification('success', t('transform.dropNaApplied'))
    } catch (err) {
      addNotification('error', err instanceof Error ? err.message : t('transform.dropNaFailed'))
    } finally {
      setLoading(false)
    }
  }

  const handleRename = async () => {
    if (!activeId || !renameFrom || !renameTo) return
    setLoading(true)
    try {
      await api.rename(activeId, { mappings: { [renameFrom]: renameTo } })
      await setPreview()
      addNotification('success', t('transform.renameApplied'))
    } catch (err) {
      addNotification('error', err instanceof Error ? err.message : t('transform.renameFailed'))
    } finally {
      setLoading(false)
    }
  }

  const handleCompute = async () => {
    if (!activeId || !computeName || !computeExpr) return
    setLoading(true)
    try {
      await api.compute(activeId, computeName, computeExpr)
      await setPreview()
      setComputeName('')
      setComputeExpr('')
      addNotification('success', t('transform.computeApplied'))
    } catch (err) {
      addNotification('error', err instanceof Error ? err.message : t('transform.computeFailed'))
    } finally {
      setLoading(false)
    }
  }

  const handlePivot = async () => {
    if (!activeId || !pivotIndex || !pivotColumns || !pivotValues) return
    setLoading(true)
    try {
      await api.pivot(activeId, { index: pivotIndex, columns: pivotColumns, values: pivotValues, aggfunc: pivotAgg })
      await setPreview()
      addNotification('success', t('transform.pivotApplied'))
    } catch (err) {
      addNotification('error', err instanceof Error ? err.message : t('transform.pivotFailed'))
    } finally {
      setLoading(false)
    }
  }

  const handleMelt = async () => {
    if (!activeId || meltIdVars.length === 0) return
    setLoading(true)
    try {
      await api.melt(activeId, { id_vars: meltIdVars })
      await setPreview()
      addNotification('success', t('transform.meltApplied'))
    } catch (err) {
      addNotification('error', err instanceof Error ? err.message : t('transform.meltFailed'))
    } finally {
      setLoading(false)
    }
  }

  const handleJoin = async () => {
    if (!activeId || !joinRight || !joinOn) return
    setLoading(true)
    try {
      await api.join(activeId, { right_dataset_id: joinRight, on: joinOn, how: joinHow })
      await setPreview()
      addNotification('success', t('transform.joinApplied'))
    } catch (err) {
      addNotification('error', err instanceof Error ? err.message : t('transform.joinFailed'))
    } finally {
      setLoading(false)
    }
  }

  const handleDrop = async () => {
    if (!activeId || dropCols.length === 0) return
    setLoading(true)
    try {
      await api.dropColumns(activeId, dropCols)
      await setPreview()
      addNotification('success', t('transform.dropApplied'))
    } catch (err) {
      addNotification('error', err instanceof Error ? err.message : t('transform.dropFailed'))
    } finally {
      setLoading(false)
    }
  }

  const handleStrClean = async () => {
    if (!activeId || !strCol) return
    setLoading(true)
    try {
      await api.strClean(activeId, strCol, strAction as 'trim' | 'lower' | 'upper', strNewCol || undefined)
      await setPreview()
      addNotification('success', t('transform.strCleanApplied'))
    } catch (err) {
      addNotification('error', err instanceof Error ? err.message : t('transform.strCleanFailed'))
    } finally {
      setLoading(false)
    }
  }

  const handleGroupby = async () => {
    if (!activeId || groupByCols.length === 0 || !groupValueCol) return
    setLoading(true)
    try {
      await api.groupby(activeId, groupByCols, groupValueCol, groupAgg)
      await setPreview()
      addNotification('success', t('transform.groupbyApplied'))
    } catch (err) {
      addNotification('error', err instanceof Error ? err.message : t('transform.groupbyFailed'))
    } finally {
      setLoading(false)
    }
  }

  const handleSample = async () => {
    if (!activeId || !sampleN) return
    setLoading(true)
    try {
      await api.sample(activeId, parseInt(sampleN, 10))
      await setPreview()
      addNotification('success', t('transform.sampleApplied'))
    } catch (err) {
      addNotification('error', err instanceof Error ? err.message : t('transform.sampleFailed'))
    } finally {
      setLoading(false)
    }
  }

  const handleUndo = async () => {
    setUndoing(true)
    try {
      const ok = await globalUndo()
      if (ok) addNotification('success', t('transform.undoApplied'))
      else addNotification('info', t('transform.nothingToUndo'))
    } catch (err) {
      addNotification('error', err instanceof Error ? err.message : t('transform.undoFailed'))
    } finally {
      setUndoing(false)
    }
  }

  if (!activeId) {
    return (
      <Card className="bg-surface-elevated border-border">
        <CardBody>
          <p className="text-xs text-muted">{t('transform.selectDataset')}</p>
        </CardBody>
      </Card>
    )
  }

  return (
    <Card className="bg-surface-elevated border-border">
      <CardBody className="gap-3">
        <div className="text-xs font-semibold text-muted">{t('transform.title')}</div>

        <div className="flex flex-col gap-1">
          <span className="text-[10px] uppercase text-muted">{t('transform.filter')}</span>
          <div className="flex gap-1">
            <Select
              size="sm"
              placeholder={t('transform.column')}
              aria-label={t('transform.column')}
              selectedKeys={filterCol ? [filterCol] : []}
              onSelectionChange={(keys) => setFilterCol(Array.from(keys)[0] as string)}
              className="min-w-[80px]"
            >
              {columns.map((c) => (
                <SelectItem key={c.name}>{c.name}</SelectItem>
              ))}
            </Select>
            <Select
              size="sm"
              aria-label={t('transform.filter')}
              selectedKeys={[filterOp]}
              onSelectionChange={(keys) => setFilterOp(Array.from(keys)[0] as string)}
              className="w-16"
            >
              {operators.map((op) => (
                <SelectItem key={op.key}>{op.label}</SelectItem>
              ))}
            </Select>
          </div>
          <Input
            size="sm"
            placeholder={t('transform.value')}
            value={filterVal}
            onValueChange={setFilterVal}
          />
          <Button size="sm" color="primary" isLoading={loading} onPress={handleFilter}>
            {t('transform.applyFilter')}
          </Button>
        </div>

        <div className="flex flex-col gap-1">
          <span className="text-[10px] uppercase text-muted">{t('transform.sort')}</span>
          <div className="flex gap-1">
            <Select
              size="sm"
              placeholder={t('transform.column')}
              aria-label={t('transform.column')}
              selectedKeys={sortCol ? [sortCol] : []}
              onSelectionChange={(keys) => setSortCol(Array.from(keys)[0] as string)}
              className="flex-1"
            >
              {columns.map((c) => (
                <SelectItem key={c.name}>{c.name}</SelectItem>
              ))}
            </Select>
            <Button size="sm" variant="flat" onPress={() => setSortAsc((v) => !v)}>
              {sortAsc ? t('transform.asc') : t('transform.desc')}
            </Button>
          </div>
          <Button size="sm" color="primary" isLoading={loading} onPress={handleSort}>
            {t('transform.applySort')}
          </Button>
        </div>

        <div className="flex flex-col gap-1">
          <span className="text-[10px] uppercase text-muted">{t('transform.dropNa')}</span>
          <Button size="sm" color="warning" isLoading={loading} onPress={handleDropNa}>
            {t('transform.dropMissing')}
          </Button>
        </div>

        <div className="flex flex-col gap-1">
          <span className="text-[10px] uppercase text-muted">{t('transform.rename')}</span>
          <div className="flex gap-1">
            <Select
              size="sm"
              placeholder={t('transform.from')}
              aria-label={t('transform.from')}
              selectedKeys={renameFrom ? [renameFrom] : []}
              onSelectionChange={(keys) => setRenameFrom(Array.from(keys)[0] as string)}
              className="flex-1"
            >
              {columns.map((c) => (
                <SelectItem key={c.name}>{c.name}</SelectItem>
              ))}
            </Select>
            <Input
              size="sm"
              placeholder={t('transform.to')}
              value={renameTo}
              onValueChange={setRenameTo}
              className="flex-1"
            />
          </div>
          <Button size="sm" color="primary" isLoading={loading} onPress={handleRename}>
            {t('transform.renameColumn')}
          </Button>
        </div>

        <div className="flex flex-col gap-1">
          <span className="text-[10px] uppercase text-muted">{t('transform.compute')}</span>
          <Input
            size="sm"
            placeholder={t('transform.newColumn')}
            value={computeName}
            onValueChange={setComputeName}
          />
          <Input
            size="sm"
            placeholder={t('transform.expression')}
            value={computeExpr}
            onValueChange={setComputeExpr}
          />
          <div className="flex flex-wrap gap-1">
            {columns.map((c) => (
              <button
                key={c.name}
                className="rounded bg-surface-elevated px-1.5 py-0.5 text-[10px] text-muted hover:bg-primary/15 hover:text-primary"
                onClick={() => insertField(c.name)}
                title={t('transform.insertField', { name: c.name })}
              >
                {c.name}
              </button>
            ))}
          </div>
          {computePreviewValues !== null && (
            <div className="rounded border border-border/60 bg-surface-elevated/40 px-2 py-1 font-mono text-[10px] text-muted">
              {t('transform.preview')}: {computePreviewValues.map((v) => String(v ?? '∅')).join(', ')}
            </div>
          )}
          <Button size="sm" color="primary" isLoading={loading} onPress={handleCompute}>
            {t('transform.addComputed')}
          </Button>
        </div>

        <div className="flex flex-col gap-1">
          <span className="text-[10px] uppercase text-muted">{t('transform.pivot')}</span>
          <div className="flex gap-1">
            <Select
              size="sm"
              placeholder={t('transform.index')}
              aria-label={t('transform.index')}
              selectedKeys={pivotIndex ? [pivotIndex] : []}
              onSelectionChange={(keys) => setPivotIndex(Array.from(keys)[0] as string)}
              className="flex-1"
            >
              {columns.map((c) => (
                <SelectItem key={c.name}>{c.name}</SelectItem>
              ))}
            </Select>
            <Select
              size="sm"
              placeholder={t('table.columns')}
              aria-label={t('table.columns')}
              selectedKeys={pivotColumns ? [pivotColumns] : []}
              onSelectionChange={(keys) => setPivotColumns(Array.from(keys)[0] as string)}
              className="flex-1"
            >
              {columns.map((c) => (
                <SelectItem key={c.name}>{c.name}</SelectItem>
              ))}
            </Select>
          </div>
          <div className="flex gap-1">
            <Select
              size="sm"
              placeholder={t('transform.value')}
              aria-label={t('transform.value')}
              selectedKeys={pivotValues ? [pivotValues] : []}
              onSelectionChange={(keys) => setPivotValues(Array.from(keys)[0] as string)}
              className="flex-1"
            >
              {columns.map((c) => (
                <SelectItem key={c.name}>{c.name}</SelectItem>
              ))}
            </Select>
            <Select
              size="sm"
              selectedKeys={[pivotAgg]}
              onSelectionChange={(keys) => setPivotAgg(Array.from(keys)[0] as string)}
              className="w-20"
              aria-label={t('transform.aggregation')}
            >
              {['sum', 'mean', 'count', 'min', 'max'].map((a) => (
                <SelectItem key={a}>{a}</SelectItem>
              ))}
            </Select>
          </div>
          <Button size="sm" color="primary" isLoading={loading} onPress={handlePivot}>
            {t('transform.applyPivot')}
          </Button>
        </div>

        <div className="flex flex-col gap-1">
          <span className="text-[10px] uppercase text-muted">{t('transform.melt')}</span>
          <Select
            size="sm"
            selectionMode="multiple"
            placeholder={t('transform.idColumns')}
            aria-label={t('transform.idColumns')}
            selectedKeys={new Set(meltIdVars)}
            onSelectionChange={(keys) => setMeltIdVars(Array.from(keys) as string[])}
          >
            {columns.map((c) => (
              <SelectItem key={c.name}>{c.name}</SelectItem>
            ))}
          </Select>
          <Button size="sm" color="primary" isLoading={loading} onPress={handleMelt}>
            {t('transform.applyMelt')}
          </Button>
        </div>

        <div className="flex flex-col gap-1">
          <span className="text-[10px] uppercase text-muted">{t('transform.join')}</span>
          <Select
            size="sm"
            placeholder={t('transform.rightDataset')}
            aria-label={t('transform.rightDataset')}
            selectedKeys={joinRight ? [joinRight] : []}
            onSelectionChange={(keys) => setJoinRight(Array.from(keys)[0] as string)}
          >
            {dataFrames
              .filter((df) => df.id !== activeId)
              .map((df) => (
                <SelectItem key={df.id}>{df.name}</SelectItem>
              ))}
          </Select>
          <div className="flex gap-1">
            <Select
              size="sm"
              placeholder={t('transform.keyColumn')}
              aria-label={t('transform.keyColumn')}
              selectedKeys={joinOn ? [joinOn] : []}
              onSelectionChange={(keys) => setJoinOn(Array.from(keys)[0] as string)}
              className="flex-1"
            >
              {columns.map((c) => (
                <SelectItem key={c.name}>{c.name}</SelectItem>
              ))}
            </Select>
            <Select
              size="sm"
              selectedKeys={[joinHow]}
              onSelectionChange={(keys) => setJoinHow(Array.from(keys)[0] as string)}
              className="w-24"
              aria-label={t('transform.joinType')}
            >
              {['inner', 'left', 'right', 'outer'].map((h) => (
                <SelectItem key={h}>{h}</SelectItem>
              ))}
            </Select>
          </div>
          <Button size="sm" color="primary" isLoading={loading} onPress={handleJoin}>
            {t('transform.applyJoin')}
          </Button>
        </div>

        <div className="flex flex-col gap-1">
          <span className="text-[10px] uppercase text-muted">{t('transform.drop')}</span>
          <Select
            size="sm"
            selectionMode="multiple"
            placeholder={t('transform.drop')}
            aria-label={t('transform.drop')}
            selectedKeys={new Set(dropCols)}
            onSelectionChange={(keys) => setDropCols(Array.from(keys) as string[])}
          >
            {columns.map((c) => (
              <SelectItem key={c.name}>{c.name}</SelectItem>
            ))}
          </Select>
          <Button size="sm" color="primary" isLoading={loading} onPress={handleDrop}>
            {t('transform.drop')}
          </Button>
        </div>

        <div className="flex flex-col gap-1">
          <span className="text-[10px] uppercase text-muted">{t('transform.strClean')}</span>
          <div className="flex gap-1">
            <Select
              size="sm"
              placeholder={t('transform.column')}
              aria-label={t('transform.column')}
              selectedKeys={strCol ? [strCol] : []}
              onSelectionChange={(keys) => setStrCol(Array.from(keys)[0] as string)}
              className="flex-1"
            >
              {columns.map((c) => (
                <SelectItem key={c.name}>{c.name}</SelectItem>
              ))}
            </Select>
            <Select
              size="sm"
              selectedKeys={[strAction]}
              onSelectionChange={(keys) => setStrAction(Array.from(keys)[0] as string)}
              className="w-24"
              aria-label={t('transform.cleanMethod')}
            >
              {['trim', 'lower', 'upper'].map((a) => (
                <SelectItem key={a}>{a}</SelectItem>
              ))}
            </Select>
          </div>
          <Input size="sm" placeholder={t('transform.newColumn')} value={strNewCol} onValueChange={setStrNewCol} />
          <Button size="sm" color="primary" isLoading={loading} onPress={handleStrClean}>
            {t('transform.strClean')}
          </Button>
        </div>

        <div className="flex flex-col gap-1">
          <span className="text-[10px] uppercase text-muted">{t('transform.groupby')}</span>
          <Select
            size="sm"
            selectionMode="multiple"
            placeholder={t('transform.groupColumns')}
            aria-label={t('transform.groupColumns')}
            selectedKeys={new Set(groupByCols)}
            onSelectionChange={(keys) => setGroupByCols(Array.from(keys) as string[])}
          >
            {columns.map((c) => (
              <SelectItem key={c.name}>{c.name}</SelectItem>
            ))}
          </Select>
          <div className="flex gap-1">
            <Select
              size="sm"
              placeholder={t('transform.valueColumn')}
              aria-label={t('transform.valueColumn')}
              selectedKeys={groupValueCol ? [groupValueCol] : []}
              onSelectionChange={(keys) => setGroupValueCol(Array.from(keys)[0] as string)}
              className="flex-1"
            >
              {columns.map((c) => (
                <SelectItem key={c.name}>{c.name}</SelectItem>
              ))}
            </Select>
            <Select
              size="sm"
              selectedKeys={[groupAgg]}
              onSelectionChange={(keys) => setGroupAgg(Array.from(keys)[0] as string)}
              className="w-24"
              aria-label={t('transform.aggregation')}
            >
              {['sum', 'mean', 'count', 'min', 'max'].map((a) => (
                <SelectItem key={a}>{a}</SelectItem>
              ))}
            </Select>
          </div>
          <Button size="sm" color="primary" isLoading={loading} onPress={handleGroupby}>
            {t('transform.groupby')}
          </Button>
        </div>

        <div className="flex flex-col gap-1">
          <span className="text-[10px] uppercase text-muted">{t('transform.sample')}</span>
          <Input size="sm" placeholder={t('transform.sampleN')} value={sampleN} onValueChange={setSampleN} />
          <Button size="sm" color="primary" isLoading={loading} onPress={handleSample}>
            {t('transform.sample')}
          </Button>
        </div>

        <div className="flex flex-col gap-1">
          <span className="text-[10px] uppercase text-muted">{t('transform.undo')}</span>
          <Button
            size="sm"
            color="warning"
            variant="flat"
            isLoading={undoing}
            startContent={<RotateCcw className="h-3 w-3" />}
            onPress={handleUndo}
          >
            {t('transform.undo')}
          </Button>
        </div>
      </CardBody>
    </Card>
  )
}
