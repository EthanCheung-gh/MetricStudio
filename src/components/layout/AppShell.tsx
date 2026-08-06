import { WorkspaceLayout } from './WorkspaceLayout'
import { StatusBar } from './StatusBar'
import { TitleBar } from './TitleBar'
import { NotificationContainer } from '@/components/common/NotificationContainer'
import { ImportModal } from '@/components/data/ImportModal'
import { ChartConfigDialog } from '@/components/chart/ChartConfigDialog'
import { CommandPalette } from '@/components/common/CommandPalette'
import { ReportDialog } from '@/components/common/ReportDialog'

export function AppShell() {
  return (
    <div className="flex h-screen w-full flex-col bg-background text-foreground">
      <TitleBar />
      <div className="min-h-0 flex-1 overflow-hidden">
        <WorkspaceLayout />
      </div>
      <StatusBar />
      <NotificationContainer />
      <ImportModal />
      <ChartConfigDialog />
      <CommandPalette />
      <ReportDialog />
    </div>
  )
}
