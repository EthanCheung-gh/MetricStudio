import { ChevronLeft, ChevronRight, BarChart3, Settings } from 'lucide-react'
import { Button } from '@heroui/react'
import { PropertyEditor } from '@/components/chart/PropertyEditor'
import { useWorkspaceStore } from '@/stores/workspaceStore'
import { useUIStore } from '@/stores/uiStore'
import { CollapsedIconBarItem } from './CollapsedIconBar'

export function RightPanel() {
  const toggle = useWorkspaceStore((s) => s.togglePanel)
  const activeSection = useWorkspaceStore((s) => s.rightActiveSection)

  return (
    <div className="flex h-full flex-col bg-surface">
      <div className="flex h-9 items-center justify-between border-b border-border px-2">
        <span className="text-xs font-semibold uppercase tracking-wider text-muted">
          {activeSection === 'properties' ? 'Properties' : 'Chart'}
        </span>
        <Button isIconOnly size="sm" variant="light" onPress={() => toggle('right')} aria-label="Collapse right panel">
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>
      <div className="flex-1 overflow-auto p-2">
        {activeSection === 'properties' && <PropertyEditor />}
        {!activeSection && <PropertyEditor />}
      </div>
    </div>
  )
}

export function RightPanelCollapsed() {
  const toggle = useWorkspaceStore((s) => s.togglePanel)
  const activateSection = useWorkspaceStore((s) => s.activatePanelSection)
  const activeSection = useWorkspaceStore((s) => s.rightActiveSection)
  const setChartConfigDialogOpen = useUIStore((s) => s.setChartConfigDialogOpen)

  return (
    <div className="flex h-full w-10 flex-col items-center border-l border-border bg-surface py-2">
      <CollapsedIconBarItem
        icon={ChevronLeft}
        label="Expand"
        onClick={() => toggle('right')}
        tooltip="Expand sidebar"
      />
      <CollapsedIconBarItem
        icon={BarChart3}
        label="Chart Config"
        active={activeSection === 'chartType'}
        onClick={() => setChartConfigDialogOpen(true)}
        tooltip="Chart configuration"
      />
      <CollapsedIconBarItem
        icon={Settings}
        label="Properties"
        active={activeSection === 'properties'}
        onClick={() => activateSection('right', 'properties')}
        tooltip="Properties"
      />
    </div>
  )
}
