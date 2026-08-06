import { useEffect, useRef, useState } from 'react'
import { Button } from '@heroui/react'
import { RefreshCw, TriangleAlert } from 'lucide-react'

interface BackendBannerProps {
  onRetry: () => Promise<void>
}

const isTauri = typeof window !== 'undefined' && '__TAURI__' in window

/** Ask the Tauri shell to kill and respawn the Python sidecar (no-op in browser mode). */
async function restartSidecar(): Promise<boolean> {
  if (!isTauri) return false
  try {
    const { invoke } = await import('@tauri-apps/api/core')
    await invoke('restart_sidecar')
    return true
  } catch {
    return false
  }
}

/** Non-destructive banner shown when the backend connection is lost (spec §3.3). */
export function BackendBanner({ onRetry }: BackendBannerProps) {
  const [retrying, setRetrying] = useState(false)
  const autoRestartedRef = useRef(false)

  // On disconnect, auto-restart the sidecar once (Tauri only) then re-check health
  useEffect(() => {
    if (autoRestartedRef.current) return
    autoRestartedRef.current = true
    restartSidecar().then((restarted) => {
      if (restarted) {
        // Give the fresh sidecar a moment to bind its port before re-checking
        setTimeout(() => void onRetry(), 2000)
      }
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const handleRetry = async () => {
    setRetrying(true)
    try {
      await restartSidecar()
      await onRetry()
    } finally {
      setRetrying(false)
    }
  }

  return (
    <div className="pointer-events-none fixed inset-x-0 top-10 z-40 flex justify-center px-4">
      <div className="pointer-events-auto flex items-center gap-3 rounded-lg border border-warning/40 bg-warning/10 px-4 py-2 shadow-lg backdrop-blur">
        <TriangleAlert className="h-4 w-4 shrink-0 text-warning" />
        <div className="text-xs">
          <span className="font-semibold text-warning">Backend connection lost.</span>
          <span className="text-muted">
            {isTauri
              ? ' Restarting the backend automatically — your charts and data will reload once it is back.'
              : ' Your charts and data are preserved. Restart the backend process (pnpm backend:dev), then click Retry.'}
          </span>
        </div>
        <Button
          size="sm"
          variant="flat"
          color="warning"
          className="h-6 min-w-0 px-2 text-xs"
          isLoading={retrying}
          startContent={!retrying && <RefreshCw className="h-3 w-3" />}
          onPress={handleRetry}
        >
          Retry
        </Button>
      </div>
    </div>
  )
}
