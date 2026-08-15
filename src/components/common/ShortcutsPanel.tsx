import { Modal, ModalBody, ModalContent, ModalHeader } from '@heroui/react'
import { useUIStore } from '@/stores/uiStore'

const SHORTCUTS = [
  { keys: 'Ctrl/Cmd + K', desc: '命令面板' },
  { keys: 'Ctrl/Cmd + P', desc: '命令面板' },
  { keys: 'Ctrl/Cmd + S', desc: '保存项目' },
  { keys: 'Ctrl/Cmd + Z', desc: '全局撤销' },
  { keys: 'Ctrl/Cmd + Shift + Z', desc: '全局重做' },
  { keys: 'Ctrl/Cmd + Y', desc: '全局重做' },
  { keys: '?', desc: '快捷键面板' },
  { keys: 'Esc', desc: '关闭弹窗' },
]

export function ShortcutsPanel() {
  const open = useUIStore((s) => s.shortcutsOpen)
  const setOpen = useUIStore((s) => s.setShortcutsOpen)

  return (
    <Modal isOpen={open} onClose={() => setOpen(false)} size="sm">
      <ModalContent>
        <ModalHeader>快捷键</ModalHeader>
        <ModalBody className="gap-1 pb-4">
          {SHORTCUTS.map((s) => (
            <div key={s.keys} className="flex items-center justify-between border-b border-border/50 py-1.5 text-xs">
              <span className="text-muted">{s.desc}</span>
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
