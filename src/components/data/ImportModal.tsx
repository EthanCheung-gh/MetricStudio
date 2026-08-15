import { useTranslation } from 'react-i18next'
import { Modal, ModalContent, ModalHeader, ModalBody } from '@heroui/react'
import { useUIStore } from '@/stores/uiStore'
import { DataExplorer } from '@/components/data/DataExplorer'

export function ImportModal() {
  const { t } = useTranslation()
  const open = useUIStore((s) => s.importModalOpen)
  const setOpen = useUIStore((s) => s.setImportModalOpen)

  return (
    <Modal isOpen={open} onClose={() => setOpen(false)} size="lg">
      <ModalContent>
        <ModalHeader>{t('layout.importData')}</ModalHeader>
        <ModalBody className="pb-6">
          <DataExplorer />
        </ModalBody>
      </ModalContent>
    </Modal>
  )
}
