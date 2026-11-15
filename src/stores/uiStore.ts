import { create } from 'zustand';
import { generateId } from '@/utils/id';
import type { ReportTemplate } from '@/types/data';
import i18n, { type Language } from '@/i18n';
import { persist } from 'zustand/middleware';

export interface Notification {
  id: string;
  type: 'success' | 'error' | 'info' | 'warning';
  message: string;
}

/** v1.12.0 notification center: persisted toast history, newest first. */
export interface NotificationRecord {
  id: string;
  type: Notification['type'];
  message: string;
  /** epoch ms */
  createdAt: number;
}

export type NotificationFilter = 'all' | Notification['type'];

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
  /** v1.12.0: notification-center history (persisted, newest first, capped). */
  notificationHistory: NotificationRecord[];
  /** Unread count for the bell badge; session-scoped (reset on reload). */
  unreadCount: number;
  notificationFilter: NotificationFilter;
  importModalOpen: boolean;
  chartConfigDialogOpen: boolean;
  saveProjectModalOpen: boolean;
  loadProjectModalOpen: boolean;
  reportDialogOpen: boolean;
  reportNotesDraft: string;
  settingsOpen: boolean;
  shortcutsOpen: boolean;
  /** v1.15.0: prominent reminder when AI calls fail because the LLM is not
   * configured/unreachable; session-scoped (from the OHOS port). */
  llmSetupPromptOpen: boolean;
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
  /** Bottom AI command bar visibility; toggled from the status bar. */
  aiBarVisible: boolean;

  setAutoSaveTarget: (path: string, name: string) => void;
  setAutoSaveTime: (savedAt: string) => void;
  setAiBarVisible: (visible: boolean) => void;

  addNotification: (type: Notification['type'], message: string) => void;
  removeNotification: (id: string) => void;
  removeNotificationRecord: (id: string) => void;
  clearNotificationHistory: () => void;
  markAllNotificationsRead: () => void;
  setNotificationFilter: (filter: NotificationFilter) => void;
  setShortcutOverride: (actionId: string, key: ShortcutKey | null) => void;
  resetShortcuts: () => void;
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
  setLlmSetupPromptOpen: (open: boolean) => void;
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

/** Persisted notification history keeps at most this many records. */
const NOTIFICATION_HISTORY_CAP = 100;

export const useUIStore = create<UIState>()(
  persist(
    (set) => ({
  notifications: [],
  notificationHistory: [],
  unreadCount: 0,
  notificationFilter: 'all',
  importModalOpen: false,
  chartConfigDialogOpen: false,
  saveProjectModalOpen: false,
  loadProjectModalOpen: false,
  reportDialogOpen: false,
  storyDialogOpen: false,
  reportNotesDraft: '',
  settingsOpen: false,
  llmSetupPromptOpen: false,
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
  aiBarVisible: true,

  setAutoSaveTarget: (path, name) =>
    set({ autoSave: { path, name, lastSavedAt: null } }),
  setAutoSaveTime: (lastSavedAt) =>
    set((state) => ({ autoSave: { ...state.autoSave, lastSavedAt } })),
  setAiBarVisible: (aiBarVisible) => set({ aiBarVisible }),

  addNotification: (type, message) => {
    const id = `${++notificationId}`;
    const record: NotificationRecord = { id, type, message, createdAt: Date.now() };
    set((state) => ({
      notifications: [...state.notifications, { id, type, message }],
      notificationHistory: [record, ...state.notificationHistory].slice(0, NOTIFICATION_HISTORY_CAP),
      unreadCount: state.unreadCount + 1,
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

  removeNotificationRecord: (id) =>
    set((state) => ({
      notificationHistory: state.notificationHistory.filter((n) => n.id !== id),
    })),

  clearNotificationHistory: () => set({ notificationHistory: [] }),

  markAllNotificationsRead: () => set({ unreadCount: 0 }),

  setNotificationFilter: (notificationFilter) => set({ notificationFilter }),

  setImportModalOpen: (open) => set({ importModalOpen: open }),
  setChartConfigDialogOpen: (open) => set({ chartConfigDialogOpen: open }),
  setSaveProjectModalOpen: (open) => set({ saveProjectModalOpen: open }),
  setLoadProjectModalOpen: (open) => set({ loadProjectModalOpen: open }),
  setReportDialogOpen: (open) => set({ reportDialogOpen: open }),
  setStoryDialogOpen: (storyDialogOpen) => set({ storyDialogOpen }),
  setReportNotesDraft: (reportNotesDraft) => set({ reportNotesDraft }),
  setSettingsOpen: (open) => set({ settingsOpen: open }),
  setShortcutsOpen: (open) => set({ shortcutsOpen: open }),
  setLlmSetupPromptOpen: (open) => set({ llmSetupPromptOpen: open }),
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
      // Session-scoped (never persisted): toasts, unread count, backend status,
      // the autosave target, the AI bar visibility and **every dialog-open
      // flag** (importModalOpen, chartConfigDialogOpen, saveProjectModalOpen,
      // loadProjectModalOpen, reportDialogOpen, storyDialogOpen, settingsOpen,
      // shortcutsOpen, llmSetupPromptOpen, diffModalOpen).
      // Persisted: the report notes draft, recent projects, report templates,
      // language, shortcut overrides, the sample-wizard dismissal and the
      // notification history (v1.12.0).
      partialize: (state) => ({
        reportNotesDraft: state.reportNotesDraft,
        recentProjects: state.recentProjects,
        reportTemplates: state.reportTemplates,
        language: state.language,
        shortcutOverrides: state.shortcutOverrides,
        sampleWizardDismissed: state.sampleWizardDismissed,
        notificationHistory: state.notificationHistory,
      }),
      // Builds ≤ 1.15.1 persisted `chartConfigDialogOpen`, so a reload restored
      // "open" while nothing was on screen: the panel looked broken because
      // clicking 图表配置 only set `true` again. A stored `true` must never
      // survive hydration — force the flag off while keeping every other
      // persisted field intact.
      merge: (persisted, current) => ({
        ...current,
        ...((persisted ?? {}) as Partial<UIState>),
        chartConfigDialogOpen: false,
      }),
    },
  ),
);
