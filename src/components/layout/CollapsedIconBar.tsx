import { Button, Tooltip } from '@heroui/react'
import type { LucideIcon } from 'lucide-react'

interface CollapsedIconBarItemProps {
  icon: LucideIcon
  label: string
  active?: boolean
  onClick: () => void
  tooltip?: string
}

export function CollapsedIconBarItem({ icon: Icon, label, active, onClick, tooltip }: CollapsedIconBarItemProps) {
  const btn = (
    <Button
      isIconOnly
      size="sm"
      variant={active ? 'flat' : 'light'}
      color={active ? 'primary' : 'default'}
      onPress={onClick}
      aria-label={label}
      className={active ? 'text-primary' : ''}
    >
      <Icon className="h-4 w-4" />
    </Button>
  )

  if (tooltip) {
    return (
      <Tooltip content={tooltip} placement="right">
        {btn}
      </Tooltip>
    )
  }

  return btn
}
