import { useEffect, useState } from 'react'
import { Button, Modal, ModalBody, ModalContent, ModalHeader } from '@heroui/react'
import { useTranslation } from 'react-i18next'
import { RotateCcw } from 'lucide-react'
import { useUIStore, type ShortcutKey } from '@/stores/uiStore'
import { SHORTCUT_ACTIONS, effectiveKey, formatKey } from '@/utils/shortcuts'

export function ShortcutsPanel() {
  const { t } = useTranslation()
  const open = useUIStore((s) => s.shortcutsOpen)
  const setOpen = useUIStore((s) => s.setShortcutsOpen)
  const overrides = useUIStore((s) => s.shortcutOverrides)
  const setShortcutOverride = useUIStore((s) => s.setShortcutOverride)
  const resetShortcuts = useUIStore((s) => s.resetShortcuts)
  const [recording, setRecording] = useState<string | null>(null)

  // While recording, capture the next key combo as the new binding (capture phase
  // so the global handler doesn't fire it; Esc cancels).
  useEffect(() => {
    if (!recording) return
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault()
      e.stopPropagation()
      const key = e.key.toLowerCase()
      if (key === 'escape') {
        setRecording(null)
        return
      }
      if (['control', 'meta', 'shift', 'alt'].includes(key)) return // wait for a non-modifier key
      const combo: ShortcutKey = { key, mod: e.metaKey || e.ctrlKey, shift: e.shiftKey }
      setShortcutOverride(recording, combo)
      setRecording(null)
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [recording, setShortcutOverride])

  return (
    <Modal isOpen={open} onClose={() => setOpen(false)} size="sm">
      <ModalContent>
        <ModalHeader>{t('shortcut.title')}</ModalHeader>
        <ModalBody className="gap-1 pb-4">
          <div className="mb-1 flex items-center justify-between gap-2">
            <p className="text-[11px] text-muted">{t('shortcut.rebindHint')}</p>
            <Button size="sm" variant="light" startContent={<RotateCcw className="h-3 w-3" />} onPress={resetShortcuts}>
              {t('shortcut.reset')}
            </Button>
          </div>
          {SHORTCUT_ACTIONS.map((a) => {
            const key = effectiveKey(a.id, overrides)
            const isRecording = recording === a.id
            return (
              <div key={a.id} className="flex items-center justify-between border-b border-border/50 py-1.5 text-xs">
                <span className="text-muted">{t(a.descKey)}</span>
                <button
                  className={`rounded border px-1.5 py-0.5 font-mono text-[10px] transition-colors ${
                    isRecording
                      ? 'border-primary bg-primary/15 text-primary'
                      : 'border-border bg-surface-elevated hover:border-primary/50'
                  }`}
                  onClick={() => setRecording(isRecording ? null : a.id)}
                >
                  {isRecording ? t('shortcut.pressKeys') : formatKey(key)}
                </button>
              </div>
            )
          })}
        </ModalBody>
      </ModalContent>
    </Modal>
  )
}
