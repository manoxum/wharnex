export type InterfaceLocale = 'en' | 'pt' | 'fr'
export type LocalePreference = InterfaceLocale | 'system'
const KEY = 'wharnex.interface-language.v1'
const EVENT = 'wharnex:interface-language'
let volatilePreference: LocalePreference | undefined
let nativeLanguages: readonly string[] | undefined
export function readLocalePreference(): LocalePreference {
  try { const value = localStorage.getItem(KEY); if (value === 'en' || value === 'pt' || value === 'fr' || value === 'system') return value; return 'en' } catch { /* Storage may be unavailable. */ }
  return volatilePreference ?? 'en'
}
export function resolveLocale(preference: LocalePreference, languages: readonly string[] = nativeLanguages ?? navigator.languages): InterfaceLocale {
  if (preference !== 'system') return preference
  for (const language of languages) {
    const code = language.toLowerCase().split(/[-_]/)[0]
    if (code === 'en' || code === 'pt' || code === 'fr') return code
  }
  return 'en'
}
export function interfaceLocale() { return resolveLocale(readLocalePreference()) }
export function applyDocumentLocale() { const locale = interfaceLocale(); document.documentElement.lang = locale === 'pt' ? 'pt-PT' : locale; return locale }
export function setLocalePreference(value: LocalePreference) {
  volatilePreference = value
  try { localStorage.setItem(KEY, value) } catch { /* Keep this window usable when storage is unavailable. */ }
  applyDocumentLocale()
  window.dispatchEvent(new Event(EVENT))
}
export function subscribeLocale(listener: () => void) {
  const changed = () => { applyDocumentLocale(); listener() }
  const stored = (event: StorageEvent) => { if (event.key === KEY || event.key === null) changed() }
  window.addEventListener(EVENT, changed)
  window.addEventListener('storage', stored)
  window.addEventListener('languagechange', changed)
  return () => { window.removeEventListener(EVENT, changed); window.removeEventListener('storage', stored); window.removeEventListener('languagechange', changed) }
}

export function applySystemLanguages(value: unknown) {
  const languages = Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string' && item.length <= 64 && /^[a-z]{2,3}(?:[-_][a-z0-9]{2,8})*$/i.test(item)).slice(0, 8) : []
  nativeLanguages = languages.length ? languages : undefined
  applyDocumentLocale()
  window.dispatchEvent(new Event(EVENT))
}
