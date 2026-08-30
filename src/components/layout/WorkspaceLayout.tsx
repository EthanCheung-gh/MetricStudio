import { useEffect } from 'react'
import { Panel, PanelGroup, PanelResizeHandle } from 'react-resizable-panels'
import { LeftPanel, LeftPanelCollapsed } from './LeftPanel'
import { CenterArea } from './CenterArea'
import { RightPanel, RightPanelCollapsed } from './RightPanel'
import { useWorkspaceStore } from '@/stores/workspaceStore'

export function WorkspaceLayout() {
  const leftCollapsed = useWorkspaceStore((s) => s.leftPanelCollapsed)
  const rightCollapsed = useWorkspaceStore((s) => s.rightPanelCollapsed)
  const notifyPanelResize = useWorkspaceStore((s) => s.notifyPanelResize)

  useEffect(() => {
    notifyPanelResize()
  }, [leftCollapsed, rightCollapsed, notifyPanelResize])

  return (
    <div className="flex h-full w-full">
      {/* Activity bar is always visible (VS Code style); clicking the active icon collapses the panel */}
      <LeftPanelCollapsed />
      <PanelGroup direction="horizontal" className="h-full flex-1" autoSaveId="metricstudio-workspace-layout">
        {!leftCollapsed && (
          <>
            <Panel id="left" defaultSize={20} minSize={15} maxSize={35} order={1}>
              <div className="h-full overflow-auto">
                <LeftPanel />
              </div>
            </Panel>
            <PanelResizeHandle className="w-1 bg-border hover:bg-primary transition-colors" />
          </>
        )}
        <Panel id="center" minSize={30} order={2} onResize={() => useWorkspaceStore.getState().notifyPanelResize()}>
          <div className="h-full overflow-hidden">
            <CenterArea />
          </div>
        </Panel>
        {!rightCollapsed && (
          <>
            <PanelResizeHandle className="w-1 bg-border hover:bg-primary transition-colors" />
            <Panel id="right" defaultSize={25} minSize={18} maxSize={40} order={3}>
              <div className="h-full overflow-auto">
                <RightPanel />
              </div>
            </Panel>
          </>
        )}
      </PanelGroup>
      <RightPanelCollapsed />
    </div>
  )
}
