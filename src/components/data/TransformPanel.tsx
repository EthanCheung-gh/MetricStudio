import { useEffect, useState } from 'react'
import { Button, Card, CardBody, Input, Select, SelectItem } from '@heroui/react'
import { RotateCcw } from 'lucide-react'
import { useDataStore } from '@/stores/dataStore'
import { api } from '@/api/client'
import { useUIStore } from '@/stores/uiStore'
import { globalUndo } from '@/utils/globalHistory'
import type { DataPreview } from '@/types/data'

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

  const updatePreview = (preview: DataPreview) => {
    useDataStore.setState({ preview })
  }

  const handleFilter = async () => {
    if (!activeId || !filterCol || !filterVal) return
    setLoading(true)
    try {
      const preview = await api.filter(activeId, { column: filterCol, operator: filterOp as never, value: filterVal })
      updatePreview(preview)
      addNotification('success', 'Filter applied')
    } catch (err) {
      addNotification('error', err instanceof Error ? err.message : 'Filter failed')
    } finally {
      setLoading(false)
    }
  }

  const handleSort = async () => {
    if (!activeId || !sortCol) return
    setLoading(true)
    try {
      const preview = await api.sort(activeId, { column: sortCol, ascending: sortAsc })
      updatePreview(preview)
      addNotification('success', 'Sort applied')
    } catch (err) {
      addNotification('error', err instanceof Error ? err.message : 'Sort failed')
    } finally {
      setLoading(false)
    }
  }

  const handleDropNa = async () => {
    if (!activeId) return
    setLoading(true)
    try {
      const preview = await api.dropNa(activeId)
      updatePreview(preview)
      addNotification('success', 'Dropped missing values')
    } catch (err) {
      addNotification('error', err instanceof Error ? err.message : 'Drop NA failed')
    } finally {
      setLoading(false)
    }
  }

  const handleRename = async () => {
    if (!activeId || !renameFrom || !renameTo) return
    setLoading(true)
    try {
      const preview = await api.rename(activeId, { mappings: { [renameFrom]: renameTo } })
      updatePreview(preview)
      setPreview()
      addNotification('success', 'Column renamed')
    } catch (err) {
      addNotification('error', err instanceof Error ? err.message : 'Rename failed')
    } finally {
      setLoading(false)
    }
  }

  const handleCompute = async () => {
    if (!activeId || !computeName || !computeExpr) return
    setLoading(true)
    try {
      const preview = await api.compute(activeId, computeName, computeExpr)
      updatePreview(preview)
      setPreview()
      setComputeName('')
      setComputeExpr('')
      addNotification('success', 'Computed column added')
    } catch (err) {
      addNotification('error', err instanceof Error ? err.message : 'Compute failed')
    } finally {
      setLoading(false)
    }
  }

  const handlePivot = async () => {
    if (!activeId || !pivotIndex || !pivotColumns || !pivotValues) return
    setLoading(true)
    try {
      const preview = await api.pivot(activeId, { index: pivotIndex, columns: pivotColumns, values: pivotValues, aggfunc: pivotAgg })
      updatePreview(preview)
      setPreview()
      addNotification('success', 'Pivot applied')
    } catch (err) {
      addNotification('error', err instanceof Error ? err.message : 'Pivot failed')
    } finally {
      setLoading(false)
    }
  }

  const handleMelt = async () => {
    if (!activeId || meltIdVars.length === 0) return
    setLoading(true)
    try {
      const preview = await api.melt(activeId, { id_vars: meltIdVars })
      updatePreview(preview)
      setPreview()
      addNotification('success', 'Melt applied')
    } catch (err) {
      addNotification('error', err instanceof Error ? err.message : 'Melt failed')
    } finally {
      setLoading(false)
    }
  }

  const handleJoin = async () => {
    if (!activeId || !joinRight || !joinOn) return
    setLoading(true)
    try {
      const preview = await api.join(activeId, { right_dataset_id: joinRight, on: joinOn, how: joinHow })
      updatePreview(preview)
      setPreview()
      addNotification('success', 'Join applied')
    } catch (err) {
      addNotification('error', err instanceof Error ? err.message : 'Join failed')
    } finally {
      setLoading(false)
    }
  }

  const handleDrop = async () => {
    if (!activeId || dropCols.length === 0) return
    setLoading(true)
    try {
      const preview = await api.dropColumns(activeId, dropCols)
      updatePreview(preview)
      setPreview()
      addNotification('success', '删除列已应用')
    } catch (err) {
      addNotification('error', err instanceof Error ? err.message : '删除列失败')
    } finally {
      setLoading(false)
    }
  }

  const handleStrClean = async () => {
    if (!activeId || !strCol) return
    setLoading(true)
    try {
      const preview = await api.strClean(activeId, strCol, strAction as 'trim' | 'lower' | 'upper', strNewCol || undefined)
      updatePreview(preview)
      setPreview()
      addNotification('success', '字符串清理已应用')
    } catch (err) {
      addNotification('error', err instanceof Error ? err.message : '字符串清理失败')
    } finally {
      setLoading(false)
    }
  }

  const handleGroupby = async () => {
    if (!activeId || groupByCols.length === 0 || !groupValueCol) return
    setLoading(true)
    try {
      const preview = await api.groupby(activeId, groupByCols, groupValueCol, groupAgg)
      updatePreview(preview)
      setPreview()
      addNotification('success', '分组聚合已应用')
    } catch (err) {
      addNotification('error', err instanceof Error ? err.message : '分组聚合失败')
    } finally {
      setLoading(false)
    }
  }

  const handleSample = async () => {
    if (!activeId || !sampleN) return
    setLoading(true)
    try {
      const preview = await api.sample(activeId, parseInt(sampleN, 10))
      updatePreview(preview)
      setPreview()
      addNotification('success', '抽样已应用')
    } catch (err) {
      addNotification('error', err instanceof Error ? err.message : '抽样失败')
    } finally {
      setLoading(false)
    }
  }

  const handleUndo = async () => {
    setUndoing(true)
    try {
      const ok = await globalUndo()
      if (ok) addNotification('success', 'Undo applied')
      else addNotification('info', 'Nothing to undo')
    } catch (err) {
      addNotification('error', err instanceof Error ? err.message : 'Undo failed')
    } finally {
      setUndoing(false)
    }
  }

  if (!activeId) {
    return (
      <Card className="bg-surface-elevated border-border">
        <CardBody>
          <p className="text-xs text-muted">Select a dataset to transform.</p>
        </CardBody>
      </Card>
    )
  }

  return (
    <Card className="bg-surface-elevated border-border">
      <CardBody className="gap-3">
        <div className="text-xs font-semibold text-muted">Transform</div>

        <div className="flex flex-col gap-1">
          <span className="text-[10px] uppercase text-muted">Filter</span>
          <div className="flex gap-1">
            <Select
              size="sm"
              placeholder="Column"
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
            placeholder="Value"
            value={filterVal}
            onValueChange={setFilterVal}
          />
          <Button size="sm" color="primary" isLoading={loading} onPress={handleFilter}>
            Apply Filter
          </Button>
        </div>

        <div className="flex flex-col gap-1">
          <span className="text-[10px] uppercase text-muted">Sort</span>
          <div className="flex gap-1">
            <Select
              size="sm"
              placeholder="Column"
              selectedKeys={sortCol ? [sortCol] : []}
              onSelectionChange={(keys) => setSortCol(Array.from(keys)[0] as string)}
              className="flex-1"
            >
              {columns.map((c) => (
                <SelectItem key={c.name}>{c.name}</SelectItem>
              ))}
            </Select>
            <Button size="sm" variant="flat" onPress={() => setSortAsc((v) => !v)}>
              {sortAsc ? 'Asc' : 'Desc'}
            </Button>
          </div>
          <Button size="sm" color="primary" isLoading={loading} onPress={handleSort}>
            Apply Sort
          </Button>
        </div>

        <div className="flex flex-col gap-1">
          <span className="text-[10px] uppercase text-muted">Drop NA</span>
          <Button size="sm" color="warning" isLoading={loading} onPress={handleDropNa}>
            Drop Missing Values
          </Button>
        </div>

        <div className="flex flex-col gap-1">
          <span className="text-[10px] uppercase text-muted">Rename</span>
          <div className="flex gap-1">
            <Select
              size="sm"
              placeholder="From"
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
              placeholder="To"
              value={renameTo}
              onValueChange={setRenameTo}
              className="flex-1"
            />
          </div>
          <Button size="sm" color="primary" isLoading={loading} onPress={handleRename}>
            Rename Column
          </Button>
        </div>

        <div className="flex flex-col gap-1">
          <span className="text-[10px] uppercase text-muted">Compute Column</span>
          <Input
            size="sm"
            placeholder="New column name"
            value={computeName}
            onValueChange={setComputeName}
          />
          <Input
            size="sm"
            placeholder="Expression, e.g. sales - profit"
            value={computeExpr}
            onValueChange={setComputeExpr}
          />
          <div className="flex flex-wrap gap-1">
            {columns.map((c) => (
              <button
                key={c.name}
                className="rounded bg-surface-elevated px-1.5 py-0.5 text-[10px] text-muted hover:bg-primary/15 hover:text-primary"
                onClick={() => insertField(c.name)}
                title={`Insert ${c.name}`}
              >
                {c.name}
              </button>
            ))}
          </div>
          {computePreviewValues !== null && (
            <div className="rounded border border-border/60 bg-surface-elevated/40 px-2 py-1 font-mono text-[10px] text-muted">
              预览: {computePreviewValues.map((v) => String(v ?? '∅')).join(', ')}
            </div>
          )}
          <Button size="sm" color="primary" isLoading={loading} onPress={handleCompute}>
            Add Computed Column
          </Button>
        </div>

        <div className="flex flex-col gap-1">
          <span className="text-[10px] uppercase text-muted">Pivot</span>
          <div className="flex gap-1">
            <Select
              size="sm"
              placeholder="Index"
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
              placeholder="Columns"
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
              placeholder="Values"
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
              aria-label="Aggregation"
            >
              {['sum', 'mean', 'count', 'min', 'max'].map((a) => (
                <SelectItem key={a}>{a}</SelectItem>
              ))}
            </Select>
          </div>
          <Button size="sm" color="primary" isLoading={loading} onPress={handlePivot}>
            Apply Pivot
          </Button>
        </div>

        <div className="flex flex-col gap-1">
          <span className="text-[10px] uppercase text-muted">Melt</span>
          <Select
            size="sm"
            selectionMode="multiple"
            placeholder="ID columns (kept as-is)"
            selectedKeys={new Set(meltIdVars)}
            onSelectionChange={(keys) => setMeltIdVars(Array.from(keys) as string[])}
          >
            {columns.map((c) => (
              <SelectItem key={c.name}>{c.name}</SelectItem>
            ))}
          </Select>
          <Button size="sm" color="primary" isLoading={loading} onPress={handleMelt}>
            Apply Melt
          </Button>
        </div>

        <div className="flex flex-col gap-1">
          <span className="text-[10px] uppercase text-muted">Join</span>
          <Select
            size="sm"
            placeholder="Right dataset"
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
              placeholder="Key column"
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
              aria-label="Join type"
            >
              {['inner', 'left', 'right', 'outer'].map((h) => (
                <SelectItem key={h}>{h}</SelectItem>
              ))}
            </Select>
          </div>
          <Button size="sm" color="primary" isLoading={loading} onPress={handleJoin}>
            Apply Join
          </Button>
        </div>

        <div className="flex flex-col gap-1">
          <span className="text-[10px] uppercase text-muted">Drop Columns</span>
          <Select
            size="sm"
            selectionMode="multiple"
            placeholder="删除列"
            selectedKeys={new Set(dropCols)}
            onSelectionChange={(keys) => setDropCols(Array.from(keys) as string[])}
          >
            {columns.map((c) => (
              <SelectItem key={c.name}>{c.name}</SelectItem>
            ))}
          </Select>
          <Button size="sm" color="primary" isLoading={loading} onPress={handleDrop}>
            删除列
          </Button>
        </div>

        <div className="flex flex-col gap-1">
          <span className="text-[10px] uppercase text-muted">String Clean</span>
          <div className="flex gap-1">
            <Select
              size="sm"
              placeholder="列"
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
              aria-label="清理方式"
            >
              {['trim', 'lower', 'upper'].map((a) => (
                <SelectItem key={a}>{a}</SelectItem>
              ))}
            </Select>
          </div>
          <Input size="sm" placeholder="新列名（可选）" value={strNewCol} onValueChange={setStrNewCol} />
          <Button size="sm" color="primary" isLoading={loading} onPress={handleStrClean}>
            字符串清理
          </Button>
        </div>

        <div className="flex flex-col gap-1">
          <span className="text-[10px] uppercase text-muted">Group By</span>
          <Select
            size="sm"
            selectionMode="multiple"
            placeholder="分组列"
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
              placeholder="值列"
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
              aria-label="聚合"
            >
              {['sum', 'mean', 'count', 'min', 'max'].map((a) => (
                <SelectItem key={a}>{a}</SelectItem>
              ))}
            </Select>
          </div>
          <Button size="sm" color="primary" isLoading={loading} onPress={handleGroupby}>
            分组聚合
          </Button>
        </div>

        <div className="flex flex-col gap-1">
          <span className="text-[10px] uppercase text-muted">Sample</span>
          <Input size="sm" placeholder="行数" value={sampleN} onValueChange={setSampleN} />
          <Button size="sm" color="primary" isLoading={loading} onPress={handleSample}>
            随机抽样
          </Button>
        </div>

        <div className="flex flex-col gap-1">
          <span className="text-[10px] uppercase text-muted">Undo</span>
          <Button
            size="sm"
            color="warning"
            variant="flat"
            isLoading={undoing}
            startContent={<RotateCcw className="h-3 w-3" />}
            onPress={handleUndo}
          >
            Undo
          </Button>
        </div>
      </CardBody>
    </Card>
  )
}
