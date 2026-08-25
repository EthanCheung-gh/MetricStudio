import { useCallback, useEffect, useRef, useState } from 'react'
import { api, initBackendPort } from '@/api/client'
import { useUIStore } from '@/stores/uiStore'

// Spec §3.2: runtime health check every 30s; §3.3: declare disconnect after 3 consecutive failures
const HEALTH_INTERVAL = 30_000
const STARTUP_RETRY_INTERVAL = 1_000
const MAX_CONSECUTIVE_FAILURES = 3

export function useBackend() {
  const [connected, setConnected] = useState(false)
  const connectedRef = useRef(connected)
  connectedRef.current = connected
  const failuresRef = useRef(0)

  // Stable store actions — never change identity, safe to omit from deps
  const setBackendStatus = useUIStore((s) => s.setBackendStatus)

  const check = useCallback(async () => {
    try {
      await api.health()
      failuresRef.current = 0
      if (!connectedRef.current) {
        connectedRef.current = true
        setConnected(true)
        setBackendStatus(true)
      }
    } catch {
      failuresRef.current += 1
      if (!connectedRef.current) {
        setBackendStatus(false, `Backend unavailable — retrying (${failuresRef.current})`)
      } else if (failuresRef.current >= MAX_CONSECUTIVE_FAILURES) {
        connectedRef.current = false
        setConnected(false)
        setBackendStatus(false, 'Connection lost — retrying')
      }
    }
  }, [setBackendStatus])

  const healthIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const startupIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    // Discover the sidecar port first (Tauri), then start health checks.
    let cancelled = false
    const initialize = async () => {
      try {
        await initBackendPort()
      } catch (error) {
        if (!cancelled) setBackendStatus(false, error instanceof Error ? error.message : 'Backend initialization failed')
      }
      if (cancelled) return
      void check()
      startupIntervalRef.current = setInterval(() => {
        if (!connectedRef.current) void check()
      }, STARTUP_RETRY_INTERVAL)
      healthIntervalRef.current = setInterval(() => {
        if (connectedRef.current) void check()
      }, HEALTH_INTERVAL)
    }
    void initialize()
    return () => {
      cancelled = true
      if (startupIntervalRef.current) clearInterval(startupIntervalRef.current)
      if (healthIntervalRef.current) clearInterval(healthIntervalRef.current)
    }
  }, [check, setBackendStatus])

  return { connected, recheck: check }
}
