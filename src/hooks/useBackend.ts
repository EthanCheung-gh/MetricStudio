import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from '@/api/client'
import { useUIStore } from '@/stores/uiStore'

// Spec §3.2: runtime health check every 30s; §3.3: declare disconnect after 3 consecutive failures
const HEALTH_INTERVAL = 30_000
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
      // Only declare disconnect after N consecutive failures (spec §3.3)
      if (failuresRef.current >= MAX_CONSECUTIVE_FAILURES && connectedRef.current) {
        connectedRef.current = false
        setConnected(false)
        setBackendStatus(false, 'Connection lost')
      }
    }
  }, [setBackendStatus])

  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    // initial check
    check()
    intervalRef.current = setInterval(check, HEALTH_INTERVAL)
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current)
    }
  }, [check])

  return { connected, recheck: check }
}
