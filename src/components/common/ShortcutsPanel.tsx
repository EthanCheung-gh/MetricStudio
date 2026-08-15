import { Modal, ModalBody, ModalContent, ModalHeader } from '@heroui/react'
import { useTranslation } from 'react-i18next'
import { useUIStore } from '@/stores/uiStore'

const SHORTCUTS = [
  { keys: 'Ctrl/Cmd + K', descKey: 'shortcut.commandPalette' },
  { keys: 'Ctrl/Cmd + P', descKey: 'shortcut.commandPalette' },
  { keys: 'Ctrl/Cmd + S', descKey: 'shortcut.saveProject' },
  { keys: 'Ctrl/Cmd + Z', descKey: 'shortcut.globalUndo' },
  { keys: 'Ctrl/Cmd + Shift + Z', descKey: 'shortcut.globalRedo' },
  { keys: 'Ctrl/Cmd + Y', descKey: 'shortcut.globalRedo' },
  { keys: '?', descKey: 'shortcut.shortcutsPanel' },
  { keys: 'Esc', descKey: 'shortcut.closeModal' },
]

export function ShortcutsPanel() {
  const { t } = useTranslation()
  const open = useUIStore((s) => s.shortcutsOpen)
  const setOpen = useUIStore((s) => s.setShortcutsOpen)

  return (
    <Modal isOpen={open} onClose={() => setOpen(false)} size="sm">
      <ModalContent>
        <ModalHeader>{t('shortcut.title')}</ModalHeader>
        <ModalBody className="gap-1 pb-4">
          {SHORTCUTS.map((s) => (
            <div key={s.keys} className="flex items-center justify-between border-b border-border/50 py-1.5 text-xs">
              <span className="text-muted">{t(s.descKey)}</span>
              <kbd className="rounded border border-border bg-surface-elevated px-1.5 py-0.5 font-mono text-[10px]">
                {s.keys}
              </kbd>
            </div>
          ))}
        </ModalBody>
      </ModalContent>
    </Modal>
  )
}
