import { useEffect, useState } from 'react'
import { Button, Checkbox, Input, Modal, ModalBody, ModalContent, ModalFooter, ModalHeader, Select, SelectItem } from '@heroui/react'
import { Keyboard, Plus, PlugZap, Save, Trash2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import i18n from '@/i18n'
import { api } from '@/api/client'
import type { LLMDataScope, LLMProfileView, LLMProviderKind } from '@/api/client'
import { useDataStore } from '@/stores/dataStore'
import { useUIStore } from '@/stores/uiStore'
import { useWorkspaceStore } from '@/stores/workspaceStore'

const NEW_PROFILE = '__new__'

interface EditableProfileForm {
  name: string
  base_url: string
  model: string
  api_key: string
  provider: LLMProviderKind
  data_scope: LLMDataScope
}

const EMPTY_FORM: EditableProfileForm = { name: '', base_url: '', model: '', api_key: '', provider: 'local', data_scope: 'all' }

function formFromProfile(profile: LLMProfileView): EditableProfileForm {
  return {
    name: profile.name,
    base_url: profile.base_url,
    model: profile.model,
    api_key: '',
    provider: profile.provider,
    data_scope: profile.data_scope,
  }
}

export function SettingsDialog() {
  const { t } = useTranslation()
  const open = useUIStore((s) => s.settingsOpen)
  const setOpen = useUIStore((s) => s.setSettingsOpen)
  const language = useUIStore((s) => s.language)
  const setLanguage = useUIStore((s) => s.setLanguage)
  const addNotification = useUIStore((s) => s.addNotification)
  const theme = useWorkspaceStore((s) => s.theme)
  const setTheme = useWorkspaceStore((s) => s.setTheme)
  const activeDataFrameId = useDataStore((s) => s.activeDataFrameId)
  const [profiles, setProfiles] = useState<LLMProfileView[]>([])
  const [activeId, setActiveId] = useState('')
  const [selectedId, setSelectedId] = useState<string>(NEW_PROFILE)
  const [form, setForm] = useState<EditableProfileForm>(EMPTY_FORM)
  const [savedHint, setSavedHint] = useState('')
  const [sensitiveColumns, setSensitiveColumns] = useState<string[]>([])
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<{ ok: boolean; text: string } | null>(null)
  const [clearApiKey, setClearApiKey] = useState(false)
  const [confirmingDelete, setConfirmingDelete] = useState(false)

  const selectedProfile = profiles.find((p) => p.id === selectedId) ?? null
  const isNew = selectedId === NEW_PROFILE
  const canSave = form.name.trim() !== '' && form.base_url.trim() !== '' && form.model.trim() !== ''

  const applyStore = (store: { active_id: string; profiles: LLMProfileView[] }) => {
    setProfiles(store.profiles)
    setActiveId(store.active_id)
  }

  const selectProfile = (id: string) => {
    setSelectedId(id)
    setClearApiKey(false)
    setTestResult(null)
    setConfirmingDelete(false)
    setSavedHint('')
    if (id === NEW_PROFILE) {
      setForm(EMPTY_FORM)
      return
    }
    const profile = profiles.find((p) => p.id === id)
    if (profile) setForm(formFromProfile(profile))
  }

  useEffect(() => {
    if (!open) return
    let active = true
    setLoading(true)
    setClearApiKey(false)
    setSensitiveColumns([])
    setTestResult(null)
    setConfirmingDelete(false)
    if (activeDataFrameId) {
      void api.getPrivacySummary(activeDataFrameId).then((value) => {
        if (active) setSensitiveColumns(value.sensitive_columns)
      })
    }
    api.getLLMProfiles()
      .then((store) => {
        if (!active) return
        applyStore(store)
        const activeProfile = store.profiles.find((p) => p.id === store.active_id) ?? store.profiles[0] ?? null
        if (activeProfile) {
          setSelectedId(activeProfile.id)
          setForm(formFromProfile(activeProfile))
          setSavedHint(activeProfile.has_api_key ? activeProfile.api_key_hint : '')
        } else {
          setSelectedId(NEW_PROFILE)
          setForm(EMPTY_FORM)
        }
      })
      .catch((error) => {
        if (active) addNotification('error', error instanceof Error ? error.message : i18n.t('settings.llmProfilesLoadFailed'))
      })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [open, activeDataFrameId, addNotification])

  const save = async () => {
    if (!canSave) {
      addNotification('info', t('settings.llmProfileIncomplete'))
      return
    }
    setSaving(true)
    try {
      const payload = {
        name: form.name.trim(),
        base_url: form.base_url.trim(),
        model: form.model.trim(),
        api_key: form.api_key.trim(),
        provider: form.provider,
        data_scope: form.data_scope,
        clear_api_key: clearApiKey,
      }
      if (isNew) {
        const store = await api.createLLMProfile(payload)
        applyStore(store)
        setSelectedId(store.created_id)
        setSavedHint(store.profiles.find((p) => p.id === store.created_id)?.api_key_hint ?? '')
      } else {
        let store = await api.updateLLMProfile(selectedId, payload)
        if (store.active_id !== selectedId) {
          store = await api.activateLLMProfile(selectedId)
        }
        applyStore(store)
        setSavedHint(store.profiles.find((p) => p.id === selectedId)?.api_key_hint ?? '')
      }
      setForm((current) => ({ ...current, api_key: '' }))
      setClearApiKey(false)
      setTestResult(null)
      addNotification('success', t('settings.saved'))
    } catch (error) {
      addNotification('error', error instanceof Error ? error.message : t('settings.saveFailed'))
    } finally {
      setSaving(false)
    }
  }

  const removeProfile = async () => {
    if (!confirmingDelete) {
      setConfirmingDelete(true)
      window.setTimeout(() => setConfirmingDelete(false), 3000)
      return
    }
    try {
      const store = await api.deleteLLMProfile(selectedId)
      applyStore(store)
      const nextProfile = store.profiles.find((p) => p.id === store.active_id) ?? store.profiles[0] ?? null
      if (nextProfile) {
        setSelectedId(nextProfile.id)
        setForm(formFromProfile(nextProfile))
        setSavedHint(nextProfile.has_api_key ? nextProfile.api_key_hint : '')
      } else {
        setSelectedId(NEW_PROFILE)
        setForm(EMPTY_FORM)
        setSavedHint('')
      }
      addNotification('success', t('settings.llmProfileDeleted'))
    } catch (error) {
      addNotification('error', error instanceof Error ? error.message : t('settings.llmDeleteFailed'))
    } finally {
      setConfirmingDelete(false)
    }
  }

  const runTest = async () => {
    setTesting(true)
    setTestResult(null)
    try {
      const result = await api.testLLMConnection({
        base_url: form.base_url.trim() || undefined,
        model: form.model.trim() || undefined,
        api_key: form.api_key.trim() || undefined,
      })
      setTestResult(
        result.ok
          ? { ok: true, text: t('settings.llmTestOk', { latency: result.latency_ms }) }
          : { ok: false, text: t('settings.llmTestFail', { error: result.error }) },
      )
    } catch (error) {
      setTestResult({ ok: false, text: error instanceof Error ? error.message : t('settings.llmTestFail', { error: '' }) })
    } finally {
      setTesting(false)
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
            <div className="flex items-end gap-2">
              <Select
                size="sm"
                label={t('settings.llmProfiles')}
                selectedKeys={[selectedId]}
                onSelectionChange={(keys) => {
                  const selected = [...keys][0]
                  if (selected) selectProfile(String(selected))
                }}
                isDisabled={loading}
              >
                {[...profiles.map((profile) => (
                  <SelectItem key={profile.id} textValue={profile.name}>
                    {profile.id === activeId ? `${profile.name} · ${t('settings.llmActiveBadge')}` : profile.name}
                  </SelectItem>
                )), (
                  <SelectItem key={NEW_PROFILE} textValue={t('settings.llmNewProfile')} className="text-primary">
                    {t('settings.llmNewProfile')}
                  </SelectItem>
                )]}
              </Select>
              <Button
                isIconOnly
                size="sm"
                variant="flat"
                aria-label={t('settings.llmNewProfile')}
                title={t('settings.llmNewProfile')}
                isDisabled={loading}
                onPress={() => selectProfile(NEW_PROFILE)}
              >
                <Plus className="h-4 w-4" />
              </Button>
              <Button
                isIconOnly
                size="sm"
                variant="flat"
                color={confirmingDelete ? 'danger' : 'default'}
                aria-label={t('settings.llmDeleteProfile')}
                title={confirmingDelete ? t('settings.llmConfirmDelete') : t('settings.llmDeleteProfile')}
                isDisabled={loading || isNew}
                onPress={() => void removeProfile()}
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
            <Input
              size="sm"
              label={t('settings.llmProfileName')}
              placeholder="DeepSeek / Ollama / …"
              value={form.name}
              onValueChange={(name) => setForm((current) => ({ ...current, name }))}
              isDisabled={loading}
            />
            <div className="grid gap-2 sm:grid-cols-2">
              <Select size="sm" label={t('settings.modelLocation')} selectedKeys={[form.provider]} onSelectionChange={(keys) => {
                const provider = [...keys][0]
                if (provider) setForm((current) => ({ ...current, provider: String(provider) as LLMProviderKind }))
              }}>
                <SelectItem key="local">{t('settings.localModel')}</SelectItem>
                <SelectItem key="cloud">{t('settings.cloudModel')}</SelectItem>
              </Select>
              <Select size="sm" label={t('settings.dataScope')} selectedKeys={[form.data_scope]} onSelectionChange={(keys) => {
                const data_scope = [...keys][0]
                if (data_scope) setForm((current) => ({ ...current, data_scope: String(data_scope) as LLMDataScope }))
              }}>
                <SelectItem key="all">{t('settings.dataScopeAll')}</SelectItem>
                <SelectItem key="redact_sensitive">{t('settings.dataScopeRedact')}</SelectItem>
                <SelectItem key="exclude_sensitive">{t('settings.dataScopeExclude')}</SelectItem>
              </Select>
            </div>
            {sensitiveColumns.length > 0 && (
              <p className="text-[11px] text-warning">{t('settings.sensitiveColumns', { columns: sensitiveColumns.join(', ') })}</p>
            )}
            <Input
              size="sm"
              label={t('nlq.baseUrl')}
              placeholder="http://localhost:11434/v1"
              value={form.base_url}
              onValueChange={(base_url) => setForm((current) => ({ ...current, base_url }))}
              isDisabled={loading}
            />
            <Input
              size="sm"
              label={t('nlq.model')}
              placeholder="llama3"
              value={form.model}
              onValueChange={(model) => setForm((current) => ({ ...current, model }))}
              isDisabled={loading}
            />
            <Input
              size="sm"
              label={t('nlq.apiKey')}
              type="password"
              value={form.api_key}
              placeholder={
                !isNew && selectedProfile?.has_api_key
                  ? t('settings.apiKeySaved', { hint: savedHint || selectedProfile.api_key_hint })
                  : ''
              }
              onValueChange={(api_key) => {
                setClearApiKey(false)
                setForm((current) => ({ ...current, api_key }))
              }}
              isDisabled={loading || clearApiKey}
            />
            {!isNew && selectedProfile?.has_api_key && (
              <Checkbox size="sm" isSelected={clearApiKey} onValueChange={setClearApiKey} isDisabled={loading}>
                {t('settings.clearApiKey')}
              </Checkbox>
            )}
            <div className="flex items-center gap-3">
              <Button
                size="sm"
                variant="flat"
                isLoading={testing}
                isDisabled={loading || form.base_url.trim() === '' || form.model.trim() === ''}
                startContent={<PlugZap className="h-4 w-4" />}
                onPress={() => void runTest()}
              >
                {t('settings.llmTestConnection')}
              </Button>
              {testResult && (
                <span className={`truncate text-xs ${testResult.ok ? 'text-success' : 'text-danger'}`} title={testResult.text}>
                  {testResult.text}
                </span>
              )}
            </div>
          </section>
        </ModalBody>
        <ModalFooter>
          <Button variant="light" onPress={() => setOpen(false)}>{t('common.cancel')}</Button>
          <Button color="primary" isLoading={saving || loading} isDisabled={!canSave} startContent={<Save className="h-4 w-4" />} onPress={() => void save()}>
            {t('settings.save')}
          </Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  )
}
