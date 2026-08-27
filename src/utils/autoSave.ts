import { api } from '@/api/client'
import { useChartStore } from '@/stores/chartStore'
import { useDashboardStore } from '@/stores/dashboardStore'
import { useQAStore } from '@/stores/qaStore'
import { useUIStore } from '@/stores/uiStore'

export const AUTO_SAVE_INTERVAL_MS = 120_000
/** Silence between mutations before an autosave is worth doing again. */
const IDLE_MS = 30_000

let lastActivityAt = Date.now()
let timer: number | null = null
let saving = false

function markActivity(): void {
  lastActivityAt = Date.now()
}

/**
 * Auto-save the current project to its last explicit save location.
 * Quietly skips when no target exists yet, when the user is actively working,
 * or when a save is already in flight. Never surfaces errors as notifications:
 * autosave failures must not interrupt analysis.
 */
export async function runAutoSave(): Promise<boolean> {
  const target = useUIStore.getState().autoSave
  if (!target.path || saving) return false
  if (Date.now() - lastActivityAt < IDLE_MS) return false
  saving = true
  try {
    await api.saveProject({
      path: target.path,
      name: target.name ?? 'Untitled',
      charts: useChartStore.getState().charts,
      dashboards: useDashboardStore.getState().dashboards,
      qa_conversations: useQAStore.getState().conversations,
    })
    const savedAt = new Date().toISOString()
    useUIStore.getState().setAutoSaveTime(savedAt)
    return true
  } catch {
    return false
  } finally {
    saving = false
  }
}

/** Start autosave tracking; call once after backend connect. */
export function startAutoSave(): void {
  if (timer !== null) return
  for (const event of ['pointerdown', 'keydown'] as const) {
    window.addEventListener(event, markActivity, { passive: true })
  }
  timer = window.setInterval(() => {
    void runAutoSave()
  }, AUTO_SAVE_INTERVAL_MS)
}

export function stopAutoSave(): void {
  if (timer !== null) {
    window.clearInterval(timer)
    timer = null
  }
}
