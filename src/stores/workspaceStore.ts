import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type PanelKey = 'left' | 'right';
export type LeftSection = 'charts' | 'datasets' | null;
export type RightSection = 'chartType' | 'properties' | null;

interface WorkspaceState {
  leftPanelCollapsed: boolean;
  rightPanelCollapsed: boolean;
  leftActiveSection: LeftSection;
  rightActiveSection: RightSection;
  activeTab: 'data' | 'chart';
  theme: 'dark' | 'light' | 'system';
  leftPanelSize: number;
  rightPanelSize: number;
  panelResizeVersion: number;

  // Chart tab management
  openChartTabs: string[];
  activeChartTabIdx: number;

  togglePanel: (panel: PanelKey) => void;
  setPanelCollapsed: (panel: PanelKey, collapsed: boolean) => void;
  setActiveTab: (tab: 'data' | 'chart') => void;
  setTheme: (theme: 'dark' | 'light' | 'system') => void;
  setPanelSize: (panel: PanelKey, size: number) => void;
  notifyPanelResize: () => void;

  // Section management (VS Code activity bar style)
  activatePanelSection: (panel: PanelKey, section: string) => void;
  setLeftSection: (section: LeftSection) => void;
  setRightSection: (section: RightSection) => void;

  // Chart tab management
  openChartTab: (chartId: string) => void;
  closeChartTab: (chartId: string) => void;
  setActiveChartTab: (idx: number) => void;
}

export const useWorkspaceStore = create<WorkspaceState>()(
  persist(
    (set, get) => ({
      leftPanelCollapsed: false,
      rightPanelCollapsed: false,
      leftActiveSection: null,
      rightActiveSection: null,
      activeTab: 'data',
      theme: 'system',
      leftPanelSize: 20,
      rightPanelSize: 25,
      panelResizeVersion: 0,
      openChartTabs: [],
      activeChartTabIdx: 0,

      notifyPanelResize: () => set((state) => ({ panelResizeVersion: state.panelResizeVersion + 1 })),

      togglePanel: (panel) =>
        set((state) => ({
          [`${panel}PanelCollapsed`]: !state[`${panel}PanelCollapsed`],
        } as Partial<WorkspaceState>)),

      setPanelCollapsed: (panel, collapsed) =>
        set({ [`${panel}PanelCollapsed`]: collapsed } as Partial<WorkspaceState>),

      setActiveTab: (tab) => set({ activeTab: tab }),
      setTheme: (theme) => set({ theme }),
      setPanelSize: (panel, size) => set({ [`${panel}PanelSize`]: size } as Partial<WorkspaceState>),

      // VS Code activity bar style: click icon to expand/switch/collapse
      activatePanelSection: (panel, section) => {
        const state = get();
        const collapsedKey = panel === 'left' ? 'leftPanelCollapsed' : 'rightPanelCollapsed';
        const sectionKey = panel === 'left' ? 'leftActiveSection' : 'rightActiveSection';
        const currentSection = state[sectionKey];

        if (state[collapsedKey]) {
          // Currently collapsed: expand and set section
          set({
            [collapsedKey]: false,
            [sectionKey]: section,
          } as Partial<WorkspaceState>);
        } else if (currentSection === section) {
          // Currently expanded with same section: collapse
          set({
            [collapsedKey]: true,
            [sectionKey]: null,
          } as Partial<WorkspaceState>);
        } else {
          // Currently expanded with different section: switch
          set({
            [sectionKey]: section,
          } as Partial<WorkspaceState>);
        }
      },

      setLeftSection: (section) => set({ leftActiveSection: section }),
      setRightSection: (section) => set({ rightActiveSection: section }),

      openChartTab: (chartId) => {
        const { openChartTabs } = get();
        if (openChartTabs.includes(chartId)) {
          // Already open: just activate it (and make sure the chart view is shown)
          const idx = openChartTabs.indexOf(chartId);
          set({ activeChartTabIdx: idx, activeTab: 'chart' });
        } else {
          // Add new tab and activate
          set((state) => ({
            openChartTabs: [...state.openChartTabs, chartId],
            activeChartTabIdx: state.openChartTabs.length,
            activeTab: 'chart',
          }));
        }
      },

      closeChartTab: (chartId) => {
        const { openChartTabs, activeChartTabIdx } = get();
        const idx = openChartTabs.indexOf(chartId);
        if (idx === -1) return;

        const newTabs = openChartTabs.filter((id) => id !== chartId);
        // Adjust active index if closing current or earlier tab
        let newActiveIdx = activeChartTabIdx;
        if (idx === activeChartTabIdx) {
          newActiveIdx = Math.max(0, Math.min(activeChartTabIdx, newTabs.length - 1));
        } else if (idx < activeChartTabIdx) {
          newActiveIdx = activeChartTabIdx - 1;
        }
        set({
          openChartTabs: newTabs,
          activeChartTabIdx: newActiveIdx,
          // No chart tabs left: fall back to the Data view so the closed chart doesn't linger
          ...(newTabs.length === 0 ? { activeTab: 'data' as const } : {}),
        });
      },

      setActiveChartTab: (idx) => set({ activeChartTabIdx: idx }),
    }),
    {
      name: 'metricstudio-workspace',
      partialize: (state) => ({
        leftPanelCollapsed: state.leftPanelCollapsed,
        rightPanelCollapsed: state.rightPanelCollapsed,
        activeTab: state.activeTab,
        theme: state.theme,
        leftPanelSize: state.leftPanelSize,
        rightPanelSize: state.rightPanelSize,
      }),
    }
  )
);
