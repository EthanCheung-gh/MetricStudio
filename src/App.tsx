import { useEffect, useRef } from 'react'
import { DndContext, type DragEndEvent } from '@dnd-kit/core'
import { AppShell } from '@/components/layout/AppShell'
import { ErrorBoundary } from '@/components/common/ErrorBoundary'
import { BackendBanner } from '@/components/common/BackendBanner'
import { useBackend } from '@/hooks/useBackend'
import { useDataStore } from '@/stores/dataStore'
import { useChartStore } from '@/stores/chartStore'
import { useUIStore } from '@/stores/uiStore'
import { useCommandPaletteStore } from '@/stores/commandPaletteStore'
import { useWorkspaceStore } from '@/stores/workspaceStore'
import { globalUndo, globalRedo } from '@/utils/globalHistory'
import type { FieldType } from '@/types/encoding'

function App() {
  const { connected, recheck } = useBackend()
  const loadDataFrames = useDataStore((s) => s.loadDataFrames)
  const addNotification = useUIStore((s) => s.addNotification)
  const columns = useDataStore((s) => s.columns)
  const activeChartId = useChartStore((s) => s.activeChartId)
  const updateEncoding = useChartStore((s) => s.updateEncoding)
  const theme = useWorkspaceStore((s) => s.theme)

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

  // Global keyboard shortcuts (Ctrl/Cmd+K palette, Ctrl+Z undo, Ctrl+S save, …)
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey
      if (!mod) return
      const target = e.target as HTMLElement
      const isTyping =
        target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable
      const key = e.key.toLowerCase()

      // Ctrl+K / Ctrl+P -> command palette
      if (key === 'k' || key === 'p') {
        e.preventDefault()
        useCommandPaletteStore.getState().toggle()
        return
      }
      // Ctrl+S -> save project dialog
      if (key === 's' && !isTyping) {
        e.preventDefault()
        useUIStore.getState().setSaveProjectModalOpen(true)
        return
      }
      // Ctrl+Z -> global undo (skip while typing in a field)
      if (key === 'z' && !e.shiftKey && !isTyping) {
        e.preventDefault()
        globalUndo()
        return
      }
      // Ctrl+Shift+Z / Ctrl+Y -> global redo
      if ((key === 'z' && e.shiftKey) || key === 'y') {
        e.preventDefault()
        globalRedo()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  useEffect(() => {
    if (connected) {
      // (Re)load on startup AND on recovery after a disconnect (spec §3.3)
      loadDataFrames()
        .then(() => useDataStore.getState().refreshActiveDataFrame())
        .catch((err) => {
          addNotification('error', err.message)
        })
    }
  }, [connected, loadDataFrames, addNotification])

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
