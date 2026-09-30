import { useEffect, useState } from 'react'
import { api } from '../../../lib/transport/http/api'
import { applyInterfaceLanguage, LANGUAGE_OPTIONS, languageLabel } from '../../../lib/project/connections/languageSettings'
import type { LanguageCode, LanguageSettings } from '../../../types'
import { Icon } from '../../presentation/chrome/Icon'

export function LanguageSettingsPanel({ onError }: { onError: (message: string) => void }) {
  const [settings, setSettings] = useState<LanguageSettings>()
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    let alive = true
    api.languageSettings().then((value) => { if (alive) { setSettings(value); applyInterfaceLanguage(value) } })
      .catch((cause) => { if (alive) onError(messageOf(cause, 'Não foi possível carregar as preferências de idioma')) })
    return () => { alive = false }
  }, [onError])

  if (!settings) return <div className="settings-loading"><span className="settings-spinner"/>A carregar idiomas…</div>
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
      const value = await api.updateLanguageSettings(currentSettings)
      setSettings(value); applyInterfaceLanguage(value); setSaved(true)
    } catch (cause) {
      onError(messageOf(cause, 'Não foi possível guardar as preferências de idioma'))
    } finally { setSaving(false) }
  }

  return <section className="language-settings-section">
    <div className="context-section-title"><div><strong>Idioma</strong><span>Defina o idioma da interface e os destinos disponíveis nos visualizadores Markdown.</span></div><code>{settings.interface_language.toUpperCase()}</code></div>
    <label className="language-interface-select"><span><strong>Interface</strong><small>Idiomas suportados nesta versão: Português, English e Français.</small></span><select aria-label="Idioma da interface" value={settings.interface_language} onChange={(event) => { setSaved(false); setSettings({ ...settings, interface_language: event.target.value as LanguageCode }) }}>{LANGUAGE_OPTIONS.map((item) => <option key={item.code} value={item.code}>{item.label}</option>)}</select></label>
    <div className="language-translation-settings">
      <div><strong>Traduzir documentos Markdown para</strong><span>Escolha um ou vários idiomas. Esta lista alimenta o seletor de tradução em todos os visualizadores Markdown.</span></div>
      <div className="language-target-grid">{LANGUAGE_OPTIONS.map((item) => <label key={item.code} className="language-target-option"><input type="checkbox" checked={settings.translation_languages.includes(item.code)} onChange={() => toggleTranslation(item.code)}/><span><strong>{item.label}</strong><small>{item.code.toUpperCase()}</small></span></label>)}</div>
      <small>Pelo menos um idioma deve permanecer selecionado. O documento original nunca é alterado pela tradução.</small>
    </div>
    <div className="context-config-actions"><button className="primary-button" disabled={saving} onClick={() => void save()}><Icon name="save" size={15}/>{saving ? 'A guardar…' : 'Guardar idiomas'}</button>{saved && <span className="settings-save-success">Configuração guardada · {settings.translation_languages.map(languageLabel).join(', ')}</span>}</div>
  </section>
}

function messageOf(error: unknown, fallback: string) { return error instanceof Error ? error.message : fallback }
