import { applyDocumentLocale } from '../../workspace/localization'
import type { LanguageCode, LanguageSettings } from '../../../types'

export const LANGUAGE_OPTIONS: Array<{ code: LanguageCode; label: string }> = [
  { code: 'pt', label: 'Português' },
  { code: 'en', label: 'English' },
  { code: 'fr', label: 'Français' },
]

export function languageLabel(code: LanguageCode) {
  return LANGUAGE_OPTIONS.find((item) => item.code === code)?.label || code
}

export function applyInterfaceLanguage(settings: Pick<LanguageSettings, 'interface_language'>) {
  applyDocumentLocale()
  window.dispatchEvent(new CustomEvent('wharness:language-settings', { detail: settings }))
}
