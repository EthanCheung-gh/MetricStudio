import { useEffect, useRef } from 'react'
import { DndContext, type DragEndEvent } from '@dnd-kit/core'
import { AppShell } from '@/components/layout/AppShell'
import { ErrorBoundary } from '@/components/common/ErrorBoundary'
import { BackendBanner } from '@/components/common/BackendBanner'
import { useBackend } from '@/hooks/useBackend'
import { useDataStore } from '@/stores/dataStore'
import { useChartStore } from '@/stores/chartStore'
import { useUIStore } from '@/stores/uiStore'
import { useWorkspaceStore } from '@/stores/workspaceStore'
import { useTranslation } from 'react-i18next'
import { getEffectiveBindings, matchShortcut } from '@/utils/shortcuts'
import { startAutoSave, stopAutoSave } from '@/utils/autoSave'
import type { FieldType } from '@/types/encoding'

function App() {
  const { connected, recheck } = useBackend()
  const loadDataFrames = useDataStore((s) => s.loadDataFrames)
  const addNotification = useUIStore((s) => s.addNotification)
  const columns = useDataStore((s) => s.columns)
  const activeChartId = useChartStore((s) => s.activeChartId)
  const updateEncoding = useChartStore((s) => s.updateEncoding)
  const theme = useWorkspaceStore((s) => s.theme)
  const language = useUIStore((s) => s.language)
  const { i18n } = useTranslation();

  useEffect(() => {
    if (i18n.isInitialized) {
      i18n.changeLanguage(language)
    } else {
      i18n.init().then(() => i18n.changeLanguage(language))
    }
  }, [language, i18n])

  // Apply light/dark theme to the root element
  useEffect(() => {
    const root = document.documentElement
    const apply = () => {
      const dark =
        theme === 'dark' ||
        (theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches)
      root.classList.toggle('dark', dark)
      root.classList.toggle('light', !dark)
    }
    apply()
    if (theme === 'system') {
      const mq = window.matchMedia('(prefers-color-scheme: dark)')
      mq.addEventListener('change', apply)
      return () => mq.removeEventListener('change', apply)
    }
  }, [theme])

  // Only show the disconnect banner after a connection was previously established
  // (initial startup failure is surfaced in the StatusBar instead)
  const everConnectedRef = useRef(false)
  if (connected) everConnectedRef.current = true

  // Global keyboard shortcuts, driven by the rebindable registry (utils/shortcuts).
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement
      const isTyping =
        target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable
      const bindings = getEffectiveBindings(useUIStore.getState().shortcutOverrides)
      for (const b of bindings) {
        if (!matchShortcut(e, b.key)) continue
        if (isTyping && !b.allowTyping) continue
        e.preventDefault()
        b.run()
        return
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  useEffect(() => {
    if (connected) {
      startAutoSave()
      // (Re)load on startup AND on recovery after a disconnect (spec §3.3)
      loadDataFrames()
        .then(() => Promise.all([
          useDataStore.getState().refreshActiveDataFrame(),
          useDataStore.getState().loadSourceStatuses(),
        ]))
        .catch((err) => {
          addNotification('error', err.message)
        })
    } else {
      stopAutoSave()
    }
  }, [connected, loadDataFrames, addNotification])

  useEffect(() => {
    if (!connected) return
    const checkSources = async () => {
      await useDataStore.getState().loadSourceStatuses()
      const refreshed = await useDataStore.getState().autoRefreshChangedSources()
      if (refreshed.length > 0) {
        addNotification('info', `Auto-refreshed ${refreshed.length} changed source(s): ${refreshed.join(', ')}`)
      }
    }
    void checkSources()
    const interval = window.setInterval(checkSources, 30_000)
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') void checkSources()
    }
    document.addEventListener('visibilitychange', onVisibilityChange)
    return () => {
      window.clearInterval(interval)
      document.removeEventListener('visibilitychange', onVisibilityChange)
    }
  }, [connected, addNotification])

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event
    if (!over || !activeChartId) return
    const channel = String(over.id).replace('channel-', '')
    if (!['x', 'yFields', 'color', 'size', 'facet'].includes(channel)) return
    const field = active.data.current?.field as string
    const type = (active.data.current?.type as FieldType) || 'nominal'
    if (!field) return
    const col = columns.find((c) => c.name === field)
    updateEncoding(activeChartId, {
      [channel]: {
        field,
        type: col?.inferredType || type,
        aggregate: channel === 'y' ? null : undefined,
      },
    })
  }

  return (
    <ErrorBoundary>
      <DndContext onDragEnd={handleDragEnd}>
        <AppShell />
        {everConnectedRef.current && !connected && <BackendBanner onRetry={recheck} />}
      </DndContext>
    </ErrorBoundary>
  )
}

export default App
