import { create } from 'zustand';
import { generateId } from '@/utils/id';
import type { ReportTemplate } from '@/types/data';
import i18n, { type Language } from '@/i18n';
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

export interface ShortcutKey {
  key: string;
  mod: boolean;
  shift?: boolean;
}

/** Session-scoped autosave state for the current project (not persisted). */
export interface AutoSaveState {
  path: string | null;
  name: string | null;
  lastSavedAt: string | null;
}

interface UIState {
  notifications: Notification[];
  importModalOpen: boolean;
  chartConfigDialogOpen: boolean;
  saveProjectModalOpen: boolean;
  loadProjectModalOpen: boolean;
  reportDialogOpen: boolean;
  reportNotesDraft: string;
  settingsOpen: boolean;
  shortcutsOpen: boolean;
  diffModalOpen: boolean;
  backendConnected: boolean;
  backendStatusMessage: string;
  recentProjects: RecentProject[];
  cleaningScanVersion: number;
  reportTemplates: ReportTemplate[];
  language: Language;
  shortcutOverrides: Record<string, ShortcutKey | null>;
  sampleWizardDismissed: boolean;
  autoSave: AutoSaveState;

  setAutoSaveTarget: (path: string, name: string) => void;
  setAutoSaveTime: (savedAt: string) => void;

  addNotification: (type: Notification['type'], message: string) => void;
  setShortcutOverride: (actionId: string, key: ShortcutKey | null) => void;
  resetShortcuts: () => void;
  removeNotification: (id: string) => void;
  setImportModalOpen: (open: boolean) => void;
  setChartConfigDialogOpen: (open: boolean) => void;
  setSaveProjectModalOpen: (open: boolean) => void;
  setLoadProjectModalOpen: (open: boolean) => void;
  setReportDialogOpen: (open: boolean) => void;
  storyDialogOpen: boolean;
  setStoryDialogOpen: (open: boolean) => void;
  setReportNotesDraft: (notes: string) => void;
  setSettingsOpen: (open: boolean) => void;
  setShortcutsOpen: (open: boolean) => void;
  setDiffModalOpen: (open: boolean) => void;
  setBackendStatus: (connected: boolean, message?: string) => void;
  addRecentProject: (project: RecentProject) => void;
  bumpCleaningScan: () => void;
  saveReportTemplate: (t: Omit<ReportTemplate, 'id'>) => void;
  removeReportTemplate: (id: string) => void;
  setLanguage: (lang: Language) => void;
  setSampleWizardDismissed: (dismissed: boolean) => void;
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
  storyDialogOpen: false,
  reportNotesDraft: '',
  settingsOpen: false,
  shortcutsOpen: false,
  diffModalOpen: false,
  backendConnected: false,
  backendStatusMessage: 'Initializing...',
  recentProjects: [],
  cleaningScanVersion: 0,
  reportTemplates: [],
  language: 'zh',
  shortcutOverrides: {},
  sampleWizardDismissed: false,
  autoSave: { path: null, name: null, lastSavedAt: null },

  setAutoSaveTarget: (path, name) =>
    set({ autoSave: { path, name, lastSavedAt: null } }),
  setAutoSaveTime: (lastSavedAt) =>
    set((state) => ({ autoSave: { ...state.autoSave, lastSavedAt } })),

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
  setStoryDialogOpen: (storyDialogOpen) => set({ storyDialogOpen }),
  setReportNotesDraft: (reportNotesDraft) => set({ reportNotesDraft }),
  setSettingsOpen: (open) => set({ settingsOpen: open }),
  setShortcutsOpen: (open) => set({ shortcutsOpen: open }),
  setDiffModalOpen: (open) => set({ diffModalOpen: open }),
  addRecentProject: (project) =>
    set((state) => ({
      recentProjects: [
        project,
        ...state.recentProjects.filter((p) => p.path !== project.path),
      ].slice(0, 5),
    })),
  bumpCleaningScan: () => set((s) => ({ cleaningScanVersion: s.cleaningScanVersion + 1 })),
  saveReportTemplate: (t) =>
    set((s) => ({ reportTemplates: [...s.reportTemplates, { ...t, id: generateId() }] })),
  removeReportTemplate: (id) =>
    set((s) => ({ reportTemplates: s.reportTemplates.filter((t) => t.id !== id) })),
  setLanguage: (language) => {
    set({ language });
    // Drive i18next directly so switching never depends on a component-level effect
    void i18n.changeLanguage(language);
  },
  setSampleWizardDismissed: (sampleWizardDismissed) => set({ sampleWizardDismissed }),
  setBackendStatus: (connected, message) =>
    set({ backendConnected: connected, backendStatusMessage: message || (connected ? 'Connected' : 'Disconnected') }),
  setShortcutOverride: (actionId, key) =>
    set((s) => ({ shortcutOverrides: { ...s.shortcutOverrides, [actionId]: key } })),
  resetShortcuts: () => set({ shortcutOverrides: {} }),
    }),
    {
      name: 'metricstudio-ui',
      // Notifications/backend status are session-scoped; persist dialog + recent projects
      partialize: (state) => ({
        chartConfigDialogOpen: state.chartConfigDialogOpen,
        reportNotesDraft: state.reportNotesDraft,
        recentProjects: state.recentProjects,
        reportTemplates: state.reportTemplates,
        language: state.language,
        shortcutOverrides: state.shortcutOverrides,
        sampleWizardDismissed: state.sampleWizardDismissed,
      }),
    },
  ),
);
