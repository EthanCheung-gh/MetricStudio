import { useEffect } from 'react'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { useWorkspaceStore } from '@/stores/workspaceStore'

export type ResolvedTheme = 'dark' | 'light'

const isTauriRuntime = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window

/**
 * Resolve the effective theme for a preference.
 * 'system' defers to the OS theme tracked by useSystemThemeSync.
 */
export function resolvedTheme(
  theme: 'dark' | 'light' | 'system',
  systemTheme: ResolvedTheme,
): ResolvedTheme {
  return theme === 'system' ? systemTheme : theme
}

/**
 * Keep workspaceStore.systemTheme in sync with the OS theme.
 *
 * Two channels, both writing the same store state (idempotent):
 * - prefers-color-scheme media query: authoritative in browsers.
 * - Tauri window theme events: authoritative on desktop — webkitgtk does
 *   not reliably map the OS color scheme into CSS media queries, so the
 *   native onThemeChanged event is what makes "follow system" work there.
 */
export function useSystemThemeSync(): void {
  const setSystemTheme = useWorkspaceStore((s) => s.setSystemTheme)

  useEffect(() => {
    let disposed = false
    let unlistenTauri: (() => void) | undefined

    const apply = (theme: ResolvedTheme) => {
      if (!disposed) setSystemTheme(theme)
    }

    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const fromMediaQuery = () => apply(mq.matches ? 'dark' : 'light')
    fromMediaQuery()
    mq.addEventListener('change', fromMediaQuery)

    if (isTauriRuntime) {
      void getCurrentWindow()
        .theme()
        .then((theme) => {
          if (theme === 'dark' || theme === 'light') apply(theme)
        })
        .catch(() => {})
      void getCurrentWindow()
        .onThemeChanged(({ payload }) => {
          if (payload === 'dark' || payload === 'light') apply(payload)
        })
        .then((unlisten) => {
          if (disposed) unlisten()
          else unlistenTauri = unlisten
        })
        .catch(() => {})
    }

    return () => {
      disposed = true
      mq.removeEventListener('change', fromMediaQuery)
      unlistenTauri?.()
    }
  }, [setSystemTheme])
}
