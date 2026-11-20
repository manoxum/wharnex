import { readLocalePreference, setLocalePreference, resolveLocale, translate, useTranslation, type LocalePreference } from '../../../lib/workspace/localization'
import { useEffect, useState } from 'react'
import { api } from '../../../lib/transport/http/api'
import { applyInterfaceLanguage, LANGUAGE_OPTIONS, languageLabel } from '../../../lib/project/connections/languageSettings'
import type { LanguageCode, LanguageSettings } from '../../../types'
import { Button, EmptyState, Field, Select, StatusBadge } from '../../presentation/workbench'
import { SettingsGroup, SettingsPage } from './presentation'

export function LanguageSettingsPanel({ onError }: { onError: (message: string) => void }) {
  const t = useTranslation()
  const [preference, setPreference] = useState(readLocalePreference)
  const [settings, setSettings] = useState<LanguageSettings>()
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [loadingError, setLoadingError] = useState('')
  const [revision, setRevision] = useState(0)

  useEffect(() => {
    let alive = true
    setLoadingError('')
    api.languageSettings().then((value) => { if (alive) { setSettings(value); applyInterfaceLanguage(value) } })
      .catch((cause) => { if (alive) { const message = messageOf(cause, translate('Não foi possível carregar as preferências de idioma')); setLoadingError(message); onError(message) } })
    return () => { alive = false }
  }, [onError, revision])

  if (!settings) return loadingError
    ? <EmptyState icon="alert" title={t("Não foi possível carregar os idiomas")} description={loadingError} action={<Button icon="refresh" onClick={() => setRevision((value) => value + 1)}>{t("Tentar novamente")}</Button>}/>
    : <p className="p-6 text-whx-label text-whx-faint" role="status">{t("A carregar idiomas…")}</p>
  const currentSettings = settings

  function toggleTranslation(language: LanguageCode) {
    const enabled = currentSettings.translation_languages.includes(language)
    if (enabled && currentSettings.translation_languages.length === 1) return
    setSaved(false)
    setSettings({
      ...currentSettings,
      translation_languages: enabled
        ? currentSettings.translation_languages.filter((candidate) => candidate !== language)
        : [...currentSettings.translation_languages, language],
    })
  }

  async function save() {
    if (saving) return
    setSaving(true); setSaved(false)
    try {
      const value = await api.updateLanguageSettings({ ...currentSettings, interface_language: resolveLocale(preference) })
      setSettings(value); setLocalePreference(preference); applyInterfaceLanguage(value); setSaved(true)
    } catch (cause) {
      onError(messageOf(cause, t('Não foi possível guardar as preferências de idioma')))
    } finally { setSaving(false) }
  }

  return <SettingsPage title={t("Idioma")} description={t("Defina o idioma da interface e os destinos disponíveis nos visualizadores Markdown.")}>
    <Field label="Interface"><Select aria-label={t("Idioma da interface")} value={preference} onChange={(event) => { const next = event.target.value as LocalePreference; setSaved(false); setPreference(next) }}><option value="system">{t('Detetar idioma do computador')} ({resolveLocale('system').toUpperCase()})</option>{LANGUAGE_OPTIONS.map((item) => <option key={item.code} value={item.code}>{item.label}</option>)}</Select></Field>
    <SettingsGroup title={t("Traduzir documentos Markdown para")}>
      <div className="grid grid-cols-3 gap-3 max-[760px]:grid-cols-1">{LANGUAGE_OPTIONS.map((item) => <label key={item.code} className="flex min-h-12 cursor-pointer items-center gap-3 rounded-md bg-whx-surface p-3 text-whx-label"><input className="size-4 accent-whx-accent" type="checkbox" checked={settings.translation_languages.includes(item.code)} disabled={settings.translation_languages.length === 1 && settings.translation_languages.includes(item.code)} onChange={() => toggleTranslation(item.code)}/><span><strong className="font-medium">{item.label}</strong><small className="ml-2 text-whx-caption text-whx-faint">{item.code.toUpperCase()}</small></span></label>)}</div>
      <p className="!m-0 !text-whx-caption !leading-relaxed !text-whx-faint">{t("Pelo menos um idioma deve permanecer selecionado. O documento original nunca é alterado pela tradução.")}</p>
    </SettingsGroup>
    <div className="flex flex-wrap items-center gap-3"><Button icon="save" tone="primary" disabled={saving} onClick={() => void save()}>{saving ? t("A guardar…") : t("Guardar idiomas")}</Button>{saved && <StatusBadge tone="success" icon="check">{t('Configuração guardada')} · {settings.translation_languages.map(languageLabel).join(', ')}</StatusBadge>}</div>
  </SettingsPage>
}

function messageOf(error: unknown, fallback: string) { return error instanceof Error ? error.message : fallback }
