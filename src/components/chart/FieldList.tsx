import { useDraggable } from '@dnd-kit/core'
import { CSS } from '@dnd-kit/utilities'
import { GripVertical } from 'lucide-react'
import type { ColumnMeta } from '@/types/data'

interface FieldListProps {
  columns: ColumnMeta[]
}

function DraggableField({ column }: { column: ColumnMeta }) {
  const { attributes, listeners, setNodeRef, transform } = useDraggable({
    id: `field-${column.name}`,
    data: { field: column.name, type: column.inferredType },
  })

  const style = {
    transform: CSS.Translate.toString(transform),
  }

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...listeners}
      {...attributes}
      className="flex cursor-grab items-center gap-1 rounded border border-border bg-surface px-2 py-1 text-xs hover:border-primary"
    >
      <GripVertical className="h-3 w-3 text-muted" />
      <span className="truncate">{column.name}</span>
      <span className="ml-auto text-[10px] text-muted">{column.inferredType[0].toUpperCase()}</span>
    </div>
  )
}

export function FieldList({ columns }: FieldListProps) {
  return (
    <div className="flex flex-col gap-1">
      <div className="text-xs font-semibold text-muted">Fields</div>
      {columns.length === 0 && <p className="text-xs text-muted">No fields available.</p>}
      <div className="grid grid-cols-1 gap-1">
        {columns.map((col) => (
          <DraggableField key={col.name} column={col} />
        ))}
      </div>
    </div>
  )
}
