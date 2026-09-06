const UI_PREFERENCES_KEY = 'kernl.ui.preferences.v1'
const UI_FONT_BASELINE = 1.25
export const UI_PREFERENCES_EVENT = 'wharness:ui-preferences'

export type UIFontChoice = 'elegant' | 'system' | 'humanist'
export type MonoFontChoice = 'jetbrains' | 'system' | 'fira'
export type ThemePreference = 'system' | 'light' | 'dark'
export type ResolvedTheme = Exclude<ThemePreference, 'system'>
export type UIPreferences = { uiFont: UIFontChoice; monoFont: MonoFontChoice; scale: number; theme: ThemePreference; errorPopups: boolean }

export const DEFAULT_UI_PREFERENCES: UIPreferences = { uiFont: 'elegant', monoFont: 'jetbrains', scale: 1, theme: 'system', errorPopups: true }

const UI_FONTS: Record<UIFontChoice, string> = {
  elegant: "Inter, Manrope, 'Segoe UI Variable', 'Segoe UI', ui-sans-serif, system-ui, sans-serif",
  system: "-apple-system, BlinkMacSystemFont, 'Segoe UI Variable', 'Segoe UI', system-ui, sans-serif",
  humanist: "Aptos, Calibri, Candara, 'Segoe UI', ui-sans-serif, system-ui, sans-serif",
}

const MONO_FONTS: Record<MonoFontChoice, string> = {
  jetbrains: "'JetBrains Mono', 'SFMono-Regular', Consolas, 'Liberation Mono', monospace",
  system: "'SFMono-Regular', Consolas, 'Liberation Mono', monospace",
  fira: "'Fira Code', 'Fira Mono', 'SFMono-Regular', Consolas, monospace",
}

export function loadUIPreferences(): UIPreferences {
  try {
    const raw = localStorage.getItem(UI_PREFERENCES_KEY)
    if (!raw) return DEFAULT_UI_PREFERENCES
    const value = JSON.parse(raw) as Partial<UIPreferences>
    return normalizeUIPreferences(value)
  } catch { return DEFAULT_UI_PREFERENCES }
}

export function saveUIPreferences(value: UIPreferences) {
  const normalized = normalizeUIPreferences(value)
  try { localStorage.setItem(UI_PREFERENCES_KEY, JSON.stringify(normalized)) } catch { /* best effort */ }
  applyUIPreferences(normalized)
  window.dispatchEvent(new CustomEvent(UI_PREFERENCES_EVENT, { detail: normalized }))
  return normalized
}

export function applyUIPreferences(value: UIPreferences) {
  const normalized = normalizeUIPreferences(value)
  const root = document.documentElement
  root.style.setProperty('--ui-font-family', UI_FONTS[normalized.uiFont])
  root.style.setProperty('--mono-font-family', MONO_FONTS[normalized.monoFont])
  root.style.setProperty('--ui-font-scale', String(Math.round(normalized.scale * UI_FONT_BASELINE * 1000) / 1000))
  root.dataset.themePreference = normalized.theme
  root.dataset.theme = resolveTheme(normalized.theme)
  root.style.colorScheme = resolveTheme(normalized.theme)
  document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')?.setAttribute('content', resolveTheme(normalized.theme) === 'dark' ? '#171717' : '#eceee8')
}

export function resolveTheme(theme: ThemePreference): ResolvedTheme {
  if (theme === 'light' || theme === 'dark') return theme
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

export function subscribeUIPreferences(listener: (value: UIPreferences) => void) {
  const media = window.matchMedia?.('(prefers-color-scheme: dark)')
  const refresh = () => {
    const value = loadUIPreferences()
    applyUIPreferences(value)
    listener(value)
  }
  const onStorage = (event: StorageEvent) => { if (!event.key || event.key === UI_PREFERENCES_KEY) refresh() }
  window.addEventListener(UI_PREFERENCES_EVENT, refresh)
  window.addEventListener('storage', onStorage)
  media?.addEventListener('change', refresh)
  return () => {
    window.removeEventListener(UI_PREFERENCES_EVENT, refresh)
    window.removeEventListener('storage', onStorage)
    media?.removeEventListener('change', refresh)
  }
}

function normalizeUIPreferences(value: Partial<UIPreferences>): UIPreferences {
  const uiFont: UIFontChoice = value.uiFont === 'system' || value.uiFont === 'humanist' ? value.uiFont : 'elegant'
  const monoFont: MonoFontChoice = value.monoFont === 'system' || value.monoFont === 'fira' ? value.monoFont : 'jetbrains'
  const theme: ThemePreference = value.theme === 'light' || value.theme === 'dark' ? value.theme : 'system'
  const numeric = Number(value.scale)
  const scale = Number.isFinite(numeric) ? Math.min(1.6, Math.max(0.4, Math.round(numeric * 20) / 20)) : DEFAULT_UI_PREFERENCES.scale
  const errorPopups = value.errorPopups !== false
  return { uiFont, monoFont, scale, theme, errorPopups }
}
