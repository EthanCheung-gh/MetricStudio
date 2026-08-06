import { useRef, useState } from 'react'
import { Database, FileJson, FolderOpen, History, Save, Upload } from 'lucide-react'
import { Button, Modal, ModalContent, ModalHeader, ModalBody, ModalFooter, Input } from '@heroui/react'
import { useUIStore } from '@/stores/uiStore'
import { useChartStore } from '@/stores/chartStore'
import { api } from '@/api/client'
import { loadProjectByPath } from '@/utils/project'

export function TitleBar() {
  const setImportModalOpen = useUIStore((s) => s.setImportModalOpen)
  const saveProjectModalOpen = useUIStore((s) => s.saveProjectModalOpen)
  const loadProjectModalOpen = useUIStore((s) => s.loadProjectModalOpen)
  const setSaveProjectModalOpen = useUIStore((s) => s.setSaveProjectModalOpen)
  const setLoadProjectModalOpen = useUIStore((s) => s.setLoadProjectModalOpen)
  const recentProjects = useUIStore((s) => s.recentProjects)
  const addNotification = useUIStore((s) => s.addNotification)
  const [projectPath, setProjectPath] = useState('project.metricstudio')
  const [projectName, setProjectName] = useState('Untitled')
  const [saving, setSaving] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const handleSave = async () => {
    setSaving(true)
    try {
      const charts = useChartStore.getState().charts
      const result = await api.saveProject({ path: projectPath, name: projectName, charts })
      addNotification('success', `Project saved: ${result.datasets} dataset(s) to ${result.path}`)
      setSaveProjectModalOpen(false)
    } catch (err) {
      addNotification('error', err instanceof Error ? err.message : 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  const handleLoadPath = async (path: string) => {
    setSaving(true)
    try {
      const result = await loadProjectByPath(path)
      addNotification('success', `Loaded project: ${result.name} (${result.restored} dataset(s) restored)`)
      setLoadProjectModalOpen(false)
    } catch (err) {
      addNotification('error', err instanceof Error ? err.message : 'Load failed')
    } finally {
      setSaving(false)
    }
  }

  const handleUpload = async (file: File | undefined) => {
    if (!file) return
    setSaving(true)
    try {
      const uploaded = await api.uploadProject(file)
      await handleLoadPath(uploaded.path)
    } catch (err) {
      addNotification('error', err instanceof Error ? err.message : 'Upload failed')
      setSaving(false)
    }
  }

  return (
    <>
      <div
        data-tauri-drag-region
        className="flex h-10 items-center justify-between border-b border-border bg-surface px-3 select-none"
      >
        <div className="flex items-center gap-2" data-tauri-drag-region>
          <Database className="h-5 w-5 text-primary" />
          <span className="font-semibold text-sm">MetricStudio</span>
        </div>
        <div className="flex items-center gap-1">
          <Button isIconOnly size="sm" variant="light" aria-label="Open project" onPress={() => setLoadProjectModalOpen(true)}>
            <FolderOpen className="h-4 w-4" />
          </Button>
          <Button isIconOnly size="sm" variant="light" aria-label="Save project" onPress={() => setSaveProjectModalOpen(true)}>
            <Save className="h-4 w-4" />
          </Button>
          <Button
            isIconOnly
            size="sm"
            variant="light"
            aria-label="Import data"
            onPress={() => setImportModalOpen(true)}
          >
            <FileJson className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <Modal isOpen={saveProjectModalOpen} onClose={() => setSaveProjectModalOpen(false)}>
        <ModalContent>
          <ModalHeader>Save Project</ModalHeader>
          <ModalBody>
            <Input
              label="Project Name"
              value={projectName}
              onValueChange={setProjectName}
              size="sm"
            />
            <Input
              label="File Path"
              value={projectPath}
              onValueChange={setProjectPath}
              size="sm"
              description=".metricstudio extension"
            />
          </ModalBody>
          <ModalFooter>
            <Button variant="light" onPress={() => setSaveProjectModalOpen(false)}>
              Cancel
            </Button>
            <Button color="primary" isLoading={saving} onPress={handleSave}>
              Save
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>

      <Modal isOpen={loadProjectModalOpen} onClose={() => setLoadProjectModalOpen(false)}>
        <ModalContent>
          <ModalHeader>Load Project</ModalHeader>
          <ModalBody className="gap-3">
            {recentProjects.length > 0 && (
              <div className="flex flex-col gap-1">
                <div className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-muted">
                  <History className="h-3 w-3" /> Recent
                </div>
                {recentProjects.map((p) => (
                  <button
                    key={p.path}
                    className="flex items-center gap-2 rounded px-2 py-1 text-left text-xs hover:bg-surface"
                    disabled={saving}
                    onClick={() => handleLoadPath(p.path)}
                  >
                    <FolderOpen className="h-3 w-3 shrink-0 text-muted" />
                    <span className="truncate">{p.name}</span>
                  </button>
                ))}
              </div>
            )}
            <Button
              size="sm"
              variant="bordered"
              startContent={<Upload className="h-4 w-4" />}
              isLoading={saving}
              onPress={() => fileInputRef.current?.click()}
            >
              Upload project file…
            </Button>
            <input
              ref={fileInputRef}
              type="file"
              accept=".metricstudio,application/zip"
              className="hidden"
              onChange={(e) => handleUpload(e.target.files?.[0])}
            />
            <Input
              label="File Path"
              value={projectPath}
              onValueChange={setProjectPath}
              size="sm"
              description="Server-side path (advanced)"
            />
          </ModalBody>
          <ModalFooter>
            <Button variant="light" onPress={() => setLoadProjectModalOpen(false)}>
              Cancel
            </Button>
            <Button color="primary" isLoading={saving} onPress={() => handleLoadPath(projectPath)}>
              Load
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
    </>
  )
}
