const UI_PREFERENCES_KEY = 'kernl.ui.preferences.v1'
const UI_FONT_BASELINE = 1.25
export const UI_PREFERENCES_EVENT = 'wharness:ui-preferences'

export type UIFontChoice = 'elegant' | 'system' | 'humanist'
export type MonoFontChoice = 'jetbrains' | 'system' | 'fira'
export type ThemePreference = 'original' | 'light' | 'dark' | 'high-contrast'
export type ResolvedTheme = 'light' | 'dark'
export type ContentSchemePreference = 'follow-ui' | ThemePreference
export type ResolvedContentScheme = 'light' | 'dark' | 'high-contrast'
export type UIDensity = 'default' | 'compact'
export type UIPreferences = {
  uiFont: UIFontChoice
  monoFont: MonoFontChoice
  scale: number
  theme: ThemePreference
  contentScheme: ContentSchemePreference
  density: UIDensity
  errorPopups: boolean
}

export type UIPreferencesInput = Partial<Omit<UIPreferences, 'theme'>> & { theme?: ThemePreference | 'system' }

export type ThemeDescriptor = { id: ThemePreference; label: string; hint: string }

export const UI_THEME_REGISTRY: readonly ThemeDescriptor[] = [
  { id: 'original', label: 'Original', hint: 'Identidade atual do Wharnex' },
  { id: 'dark', label: 'Escuro', hint: 'Superfícies neutras para uso prolongado' },
  { id: 'light', label: 'Claro', hint: 'Superfícies claras de alto conforto' },
  { id: 'high-contrast', label: 'Alto contraste', hint: 'Contraste reforçado para leitura e foco' },
]

export const DEFAULT_UI_PREFERENCES: UIPreferences = {
  uiFont: 'elegant',
  monoFont: 'jetbrains',
  scale: 1,
  theme: 'original',
  contentScheme: 'follow-ui',
  density: 'default',
  errorPopups: true,
}

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
    return normalizeUIPreferences(JSON.parse(raw) as UIPreferencesInput)
  } catch { return DEFAULT_UI_PREFERENCES }
}

export function saveUIPreferences(value: UIPreferencesInput) {
  const normalized = normalizeUIPreferences(value)
  try { localStorage.setItem(UI_PREFERENCES_KEY, JSON.stringify(normalized)) } catch { /* best effort */ }
  applyUIPreferences(normalized)
  window.dispatchEvent(new CustomEvent(UI_PREFERENCES_EVENT, { detail: normalized }))
  return normalized
}

export function applyUIPreferences(value: UIPreferencesInput) {
  const normalized = normalizeUIPreferences(value)
  const root = document.documentElement
  const resolvedTheme = resolveTheme(normalized.theme)
  const contentScheme = resolveContentScheme(normalized.contentScheme, normalized.theme)
  root.style.setProperty('--ui-font-family', UI_FONTS[normalized.uiFont])
  root.style.setProperty('--mono-font-family', MONO_FONTS[normalized.monoFont])
  root.style.setProperty('--ui-font-scale', String(Math.round(normalized.scale * UI_FONT_BASELINE * 1000) / 1000))
  root.dataset.themePreference = normalized.theme
  root.dataset.uiTheme = normalized.theme
  root.dataset.theme = resolvedTheme
  root.dataset.contentScheme = contentScheme
  root.dataset.density = normalized.density
  root.style.colorScheme = resolvedTheme
  const themeColor = normalized.theme === 'high-contrast' ? '#000000' : resolvedTheme === 'dark' ? '#171717' : '#eceee8'
  document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')?.setAttribute('content', themeColor)
}

export function resolveTheme(theme: ThemePreference): ResolvedTheme {
  if (theme === 'light') return 'light'
  if (theme === 'dark' || theme === 'high-contrast') return 'dark'
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

export function resolveContentScheme(contentScheme: ContentSchemePreference, uiTheme: ThemePreference): ResolvedContentScheme {
  const selected = contentScheme === 'follow-ui' ? uiTheme : contentScheme
  if (selected === 'high-contrast') return 'high-contrast'
  return resolveTheme(selected)
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

export function normalizeUIPreferences(value: UIPreferencesInput): UIPreferences {
  const uiFont: UIFontChoice = value.uiFont === 'system' || value.uiFont === 'humanist' ? value.uiFont : 'elegant'
  const monoFont: MonoFontChoice = value.monoFont === 'system' || value.monoFont === 'fira' ? value.monoFont : 'jetbrains'
  const legacyTheme = value.theme === 'system' ? 'original' : value.theme
  const theme: ThemePreference = legacyTheme === 'light' || legacyTheme === 'dark' || legacyTheme === 'high-contrast' ? legacyTheme : 'original'
  const contentScheme: ContentSchemePreference = value.contentScheme === 'original' || value.contentScheme === 'light' || value.contentScheme === 'dark' || value.contentScheme === 'high-contrast' ? value.contentScheme : 'follow-ui'
  const density: UIDensity = value.density === 'compact' ? 'compact' : 'default'
  const numeric = Number(value.scale)
  const scale = Number.isFinite(numeric) ? Math.min(1.6, Math.max(0.4, Math.round(numeric * 20) / 20)) : DEFAULT_UI_PREFERENCES.scale
  const errorPopups = value.errorPopups !== false
  return { uiFont, monoFont, scale, theme, contentScheme, density, errorPopups }
}
