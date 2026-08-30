import { useTranslation } from 'react-i18next'
import { ChevronLeft, ChevronRight, BarChart3, Settings } from 'lucide-react'
import { Button } from '@heroui/react'
import { PropertyEditor } from '@/components/chart/PropertyEditor'
import { useWorkspaceStore } from '@/stores/workspaceStore'
import { useUIStore } from '@/stores/uiStore'
import { CollapsedIconBarItem } from './CollapsedIconBar'

export function RightPanel() {
  const { t } = useTranslation()
  const toggle = useWorkspaceStore((s) => s.togglePanel)
  const activeSection = useWorkspaceStore((s) => s.rightActiveSection)

  return (
    <div className="flex h-full flex-col bg-surface">
      <div className="flex h-9 items-center justify-between border-b border-border px-2">
        <span className="text-xs font-semibold uppercase tracking-wider text-muted">
          {activeSection === 'properties' ? t('panel.properties') : t('nav.chart')}
        </span>
        <Button isIconOnly size="sm" variant="light" onPress={() => toggle('right')} aria-label={t('layout.collapseSidebar')}>
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
  const { t } = useTranslation()
  const toggle = useWorkspaceStore((s) => s.togglePanel)
  const activateSection = useWorkspaceStore((s) => s.activatePanelSection)
  const activeSection = useWorkspaceStore((s) => s.rightActiveSection)
  const setChartConfigDialogOpen = useUIStore((s) => s.setChartConfigDialogOpen)

  return (
    <div className="flex h-full w-10 flex-col items-center border-l border-border bg-surface py-2">
      <CollapsedIconBarItem
        icon={ChevronLeft}
        label={t('layout.expandSidebar')}
        onClick={() => toggle('right')}
        tooltip={t('layout.expandSidebar')}
      />
      <CollapsedIconBarItem
        icon={BarChart3}
        label={t('layout.chartConfig')}
        active={activeSection === 'chartType'}
        onClick={() => setChartConfigDialogOpen(true)}
        tooltip={t('layout.chartConfig')}
      />
      <CollapsedIconBarItem
        icon={Settings}
        label={t('panel.properties')}
        active={activeSection === 'properties'}
        onClick={() => activateSection('right', 'properties')}
        tooltip={t('panel.properties')}
      />
    </div>
  )
}
