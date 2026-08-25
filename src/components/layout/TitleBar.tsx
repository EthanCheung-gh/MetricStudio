import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { Database, FileJson, FolderOpen, History, Menu, Minus, Save, Square, Upload, X } from 'lucide-react'
import { Button, Modal, ModalContent, ModalHeader, ModalBody, ModalFooter, Input } from '@heroui/react'
import { useUIStore } from '@/stores/uiStore'
import { useChartStore } from '@/stores/chartStore'
import { useDashboardStore } from '@/stores/dashboardStore'
import { useQAStore } from '@/stores/qaStore'
import { api } from '@/api/client'
import { loadProjectByPath } from '@/utils/project'

const isTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window

export function TitleBar() {
  const { t } = useTranslation();
  const setImportModalOpen = useUIStore((s) => s.setImportModalOpen)
  const saveProjectModalOpen = useUIStore((s) => s.saveProjectModalOpen)
  const loadProjectModalOpen = useUIStore((s) => s.loadProjectModalOpen)
  const setSaveProjectModalOpen = useUIStore((s) => s.setSaveProjectModalOpen)
  const setLoadProjectModalOpen = useUIStore((s) => s.setLoadProjectModalOpen)
  const setSettingsOpen = useUIStore((s) => s.setSettingsOpen)
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
      const dashboards = useDashboardStore.getState().dashboards
      const qaConversations = useQAStore.getState().conversations
      const result = await api.saveProject({ path: projectPath, name: projectName, charts, dashboards, qa_conversations: qaConversations })
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

  const handleMinimize = () => {
    try { getCurrentWindow().minimize() } catch { /* non-Tauri (browser dev) */ }
  }
  const handleToggleMaximize = () => {
    try { getCurrentWindow().toggleMaximize() } catch { /* non-Tauri (browser dev) */ }
  }
  const handleClose = () => {
    try { getCurrentWindow().close() } catch { /* non-Tauri (browser dev) */ }
  }

  return (
    <>
      <div className="flex h-10 items-center justify-between border-b border-border bg-surface px-3 select-none">
        <div data-tauri-drag-region className="flex min-w-0 flex-1 items-center gap-2">
          <Database className="h-5 w-5 text-primary" />
          <span className="font-semibold text-sm">MetricStudio</span>
        </div>
        <div className="flex items-center gap-1">
          <Button isIconOnly size="sm" variant="light" aria-label={t('layout.openProject')} onPress={() => setLoadProjectModalOpen(true)}>
            <FolderOpen className="h-4 w-4" />
          </Button>
          <Button isIconOnly size="sm" variant="light" aria-label={t('layout.saveProject')} onPress={() => setSaveProjectModalOpen(true)}>
            <Save className="h-4 w-4" />
          </Button>
          <Button
            isIconOnly
            size="sm"
            variant="light"
            aria-label={t('layout.importData')}
            onPress={() => setImportModalOpen(true)}
          >
            <FileJson className="h-4 w-4" />
          </Button>
          <Button isIconOnly size="sm" variant="light" aria-label={t('settings.open')} onPress={() => setSettingsOpen(true)}>
            <Menu className="h-4 w-4" />
          </Button>
        </div>
        {isTauri && (
          <div className="ml-1 flex items-center gap-0.5 border-l border-border pl-1">
            <button className="rounded p-1 hover:bg-surface-elevated" onClick={handleMinimize} aria-label="Minimize">
              <Minus className="h-3.5 w-3.5 text-muted" />
            </button>
            <button className="rounded p-1 hover:bg-surface-elevated" onClick={handleToggleMaximize} aria-label="Maximize">
              <Square className="h-3 w-3 text-muted" />
            </button>
            <button className="rounded p-1 hover:bg-danger/20 hover:text-danger" onClick={handleClose} aria-label="Close">
              <X className="h-3.5 w-3.5 text-muted" />
            </button>
          </div>
        )}
      </div>

      <Modal isOpen={saveProjectModalOpen} onClose={() => setSaveProjectModalOpen(false)}>
        <ModalContent>
          <ModalHeader>{t('layout.saveProject')}</ModalHeader>
          <ModalBody>
            <Input
              label={t('layout.projectName')}
              value={projectName}
              onValueChange={setProjectName}
              size="sm"
            />
            <Input
              label={t('layout.filePath')}
              value={projectPath}
              onValueChange={setProjectPath}
              size="sm"
              description=".metricstudio extension"
            />
          </ModalBody>
          <ModalFooter>
            <Button variant="light" onPress={() => setSaveProjectModalOpen(false)}>
              {t('layout.cancel')}
            </Button>
            <Button color="primary" isLoading={saving} onPress={handleSave}>
              {t('layout.save')}
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>

      <Modal isOpen={loadProjectModalOpen} onClose={() => setLoadProjectModalOpen(false)}>
        <ModalContent>
          <ModalHeader>{t('layout.openProject')}</ModalHeader>
          <ModalBody className="gap-3">
            {recentProjects.length > 0 && (
              <div className="flex flex-col gap-1">
                <div className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-muted">
                  <History className="h-3 w-3" /> {t('layout.recent')}
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
              {t('layout.uploadProject')}
            </Button>
            <input
              ref={fileInputRef}
              type="file"
              accept=".metricstudio,application/zip"
              className="hidden"
              onChange={(e) => handleUpload(e.target.files?.[0])}
            />
            <Input
              label={t('layout.filePath')}
              value={projectPath}
              onValueChange={setProjectPath}
              size="sm"
              description={t('layout.serverPath')}
            />
          </ModalBody>
          <ModalFooter>
            <Button variant="light" onPress={() => setLoadProjectModalOpen(false)}>
              {t('layout.cancel')}
            </Button>
            <Button color="primary" isLoading={saving} onPress={() => handleLoadPath(projectPath)}>
              {t('layout.load')}
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
    </>
  )
}
