import { Modal, ModalContent, ModalHeader, ModalBody } from '@heroui/react'
import { useUIStore } from '@/stores/uiStore'
import { DataExplorer } from '@/components/data/DataExplorer'

export function ImportModal() {
  const open = useUIStore((s) => s.importModalOpen)
  const setOpen = useUIStore((s) => s.setImportModalOpen)

  return (
    <Modal isOpen={open} onClose={() => setOpen(false)} size="lg">
      <ModalContent>
        <ModalHeader>导入数据</ModalHeader>
        <ModalBody className="pb-6">
          <DataExplorer />
        </ModalBody>
      </ModalContent>
    </Modal>
  )
}
