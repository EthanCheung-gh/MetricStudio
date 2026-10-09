import { AlertTriangle } from 'lucide-react'
import { Button, Modal, ModalContent, ModalHeader, ModalBody, ModalFooter } from '@heroui/react'
import { useTranslation } from 'react-i18next'
import { useUIStore } from '@/stores/uiStore'

/** v1.15.0 (from the OHOS port): prominent reminder shown when clean/ask/chart
 * calls fail because the AI service is not configured (or unreachable).
 * 「去配置」 jumps straight into the settings dialog where LLM profiles live. */
export function LlmSetupPrompt() {
  const open = useUIStore((s) => s.llmSetupPromptOpen)
  const setOpen = useUIStore((s) => s.setLlmSetupPromptOpen)
  const setSettingsOpen = useUIStore((s) => s.setSettingsOpen)
  const { t } = useTranslation()

  return (
    <Modal isOpen={open} onClose={() => setOpen(false)} size="sm">
      <ModalContent>
        <ModalHeader className="flex items-center gap-2">
          <AlertTriangle className="h-5 w-5 text-warning" />
          {t('ai.setupTitle')}
        </ModalHeader>
        <ModalBody>
          <p className="text-xs leading-relaxed text-muted">{t('ai.setupHint')}</p>
        </ModalBody>
        <ModalFooter>
          <Button variant="light" onPress={() => setOpen(false)}>
            {t('ai.setupLater')}
          </Button>
          <Button
            color="primary"
            onPress={() => {
              setOpen(false)
              setSettingsOpen(true)
            }}
          >
            {t('ai.setupGo')}
          </Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  )
}
