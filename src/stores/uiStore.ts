import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export interface Notification {
  id: string;
  type: 'success' | 'error' | 'info';
  message: string;
}

export interface RecentProject {
  path: string;
  name: string;
}

interface UIState {
  notifications: Notification[];
  importModalOpen: boolean;
  chartConfigDialogOpen: boolean;
  saveProjectModalOpen: boolean;
  loadProjectModalOpen: boolean;
  reportDialogOpen: boolean;
  backendConnected: boolean;
  backendStatusMessage: string;
  recentProjects: RecentProject[];
  cleaningScanVersion: number;

  addNotification: (type: Notification['type'], message: string) => void;
  removeNotification: (id: string) => void;
  setImportModalOpen: (open: boolean) => void;
  setChartConfigDialogOpen: (open: boolean) => void;
  setSaveProjectModalOpen: (open: boolean) => void;
  setLoadProjectModalOpen: (open: boolean) => void;
  setReportDialogOpen: (open: boolean) => void;
  setBackendStatus: (connected: boolean, message?: string) => void;
  addRecentProject: (project: RecentProject) => void;
  bumpCleaningScan: () => void;
}

let notificationId = 0;

export const useUIStore = create<UIState>()(
  persist(
    (set) => ({
  notifications: [],
  importModalOpen: false,
  chartConfigDialogOpen: false,
  saveProjectModalOpen: false,
  loadProjectModalOpen: false,
  reportDialogOpen: false,
  backendConnected: false,
  backendStatusMessage: 'Initializing...',
  recentProjects: [],
  cleaningScanVersion: 0,

  addNotification: (type, message) => {
    const id = `${++notificationId}`;
    set((state) => ({
      notifications: [...state.notifications, { id, type, message }],
    }));
    setTimeout(() => {
      set((state) => ({
        notifications: state.notifications.filter((n) => n.id !== id),
      }));
    }, 4000);
  },

  removeNotification: (id) =>
    set((state) => ({
      notifications: state.notifications.filter((n) => n.id !== id),
    })),

  setImportModalOpen: (open) => set({ importModalOpen: open }),
  setChartConfigDialogOpen: (open) => set({ chartConfigDialogOpen: open }),
  setSaveProjectModalOpen: (open) => set({ saveProjectModalOpen: open }),
  setLoadProjectModalOpen: (open) => set({ loadProjectModalOpen: open }),
  setReportDialogOpen: (open) => set({ reportDialogOpen: open }),
  addRecentProject: (project) =>
    set((state) => ({
      recentProjects: [
        project,
        ...state.recentProjects.filter((p) => p.path !== project.path),
      ].slice(0, 5),
    })),
  bumpCleaningScan: () => set((s) => ({ cleaningScanVersion: s.cleaningScanVersion + 1 })),
  setBackendStatus: (connected, message) =>
    set({ backendConnected: connected, backendStatusMessage: message || (connected ? 'Connected' : 'Disconnected') }),
    }),
    {
      name: 'metricstudio-ui',
      // Notifications/backend status are session-scoped; persist dialog + recent projects
      partialize: (state) => ({
        chartConfigDialogOpen: state.chartConfigDialogOpen,
        recentProjects: state.recentProjects,
      }),
    },
  ),
);
