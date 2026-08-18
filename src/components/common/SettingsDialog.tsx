import { useEffect, useState } from 'react'
import { Button, Checkbox, Input, Modal, ModalBody, ModalContent, ModalFooter, ModalHeader, Select, SelectItem } from '@heroui/react'
import { Keyboard, Save } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import i18n from '@/i18n'
import { api } from '@/api/client'
import { useUIStore } from '@/stores/uiStore'
import { useWorkspaceStore } from '@/stores/workspaceStore'

interface LLMConfig {
  base_url: string
  model: string
  api_key: string
}

const EMPTY_CONFIG: LLMConfig = { base_url: '', model: '', api_key: '' }

export function SettingsDialog() {
  const { t } = useTranslation()
  const open = useUIStore((s) => s.settingsOpen)
  const setOpen = useUIStore((s) => s.setSettingsOpen)
  const language = useUIStore((s) => s.language)
  const setLanguage = useUIStore((s) => s.setLanguage)
  const addNotification = useUIStore((s) => s.addNotification)
  const theme = useWorkspaceStore((s) => s.theme)
  const setTheme = useWorkspaceStore((s) => s.setTheme)
  const [config, setConfig] = useState<LLMConfig>(EMPTY_CONFIG)
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [clearApiKey, setClearApiKey] = useState(false)

  useEffect(() => {
    if (!open) return
    let active = true
    setLoading(true)
    setClearApiKey(false)
    api.getLLMConfig()
      .then((value) => { if (active) setConfig(value) })
      .catch((error) => {
        if (active) addNotification('error', error instanceof Error ? error.message : i18n.t('settings.llmLoadFailed'))
      })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [open, addNotification])

  const save = async () => {
    setSaving(true)
    try {
      const saved = await api.setLLMConfig({ ...config, clear_api_key: clearApiKey })
      setConfig(saved)
      addNotification('success', t('settings.saved'))
      setOpen(false)
    } catch (error) {
      addNotification('error', error instanceof Error ? error.message : t('settings.saveFailed'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal isOpen={open} onClose={() => setOpen(false)} size="lg">
      <ModalContent>
        <ModalHeader>{t('settings.title')}</ModalHeader>
        <ModalBody className="gap-4">
          <section className="flex flex-col gap-2">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted">{t('settings.appearance')}</h3>
            <div className="grid gap-2 sm:grid-cols-2">
              <Select
                size="sm"
                label={t('settings.language')}
                selectedKeys={[language]}
                onSelectionChange={(keys) => {
                  const selected = [...keys][0]
                  if (selected) setLanguage(String(selected) as 'zh' | 'en')
                }}
              >
                <SelectItem key="zh">简体中文</SelectItem>
                <SelectItem key="en">English</SelectItem>
              </Select>
              <Select
                size="sm"
                label={t('settings.theme')}
                selectedKeys={[theme]}
                onSelectionChange={(keys) => {
                  const selected = [...keys][0]
                  if (selected) setTheme(String(selected) as 'dark' | 'light' | 'system')
                }}
              >
                <SelectItem key="system">{t('settings.themeSystem')}</SelectItem>
                <SelectItem key="dark">{t('settings.themeDark')}</SelectItem>
                <SelectItem key="light">{t('settings.themeLight')}</SelectItem>
              </Select>
            </div>
            <Button
              className="self-start"
              size="sm"
              variant="light"
              startContent={<Keyboard className="h-4 w-4" />}
              onPress={() => {
                setOpen(false)
                useUIStore.getState().setShortcutsOpen(true)
              }}
            >
              {t('settings.shortcuts')}
            </Button>
          </section>

          <section className="flex flex-col gap-2 border-t border-border pt-4">
            <div>
              <h3 className="text-xs font-semibold uppercase tracking-wide text-muted">{t('settings.llm')}</h3>
              <p className="mt-1 text-[11px] text-muted">{t('settings.llmHint')}</p>
            </div>
            <Input
              size="sm"
              label={t('nlq.baseUrl')}
              placeholder="http://localhost:11434/v1"
              value={config.base_url}
              onValueChange={(base_url) => setConfig((current) => ({ ...current, base_url }))}
              isDisabled={loading}
            />
            <Input
              size="sm"
              label={t('nlq.model')}
              placeholder="llama3"
              value={config.model}
              onValueChange={(model) => setConfig((current) => ({ ...current, model }))}
              isDisabled={loading}
            />
            <Input
              size="sm"
              label={t('nlq.apiKey')}
              type="password"
              value={config.api_key}
              onValueChange={(api_key) => {
                setClearApiKey(false)
                setConfig((current) => ({ ...current, api_key }))
              }}
              isDisabled={loading || clearApiKey}
            />
            <Checkbox size="sm" isSelected={clearApiKey} onValueChange={setClearApiKey} isDisabled={loading}>
              {t('settings.clearApiKey')}
            </Checkbox>
          </section>
        </ModalBody>
        <ModalFooter>
          <Button variant="light" onPress={() => setOpen(false)}>{t('common.cancel')}</Button>
          <Button color="primary" isLoading={saving || loading} startContent={<Save className="h-4 w-4" />} onPress={save}>
            {t('settings.save')}
          </Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  )
}
