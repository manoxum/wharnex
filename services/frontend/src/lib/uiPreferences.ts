const UI_PREFERENCES_KEY = 'kernl.ui.preferences.v1'
const UI_FONT_BASELINE = 1.25
export const UI_PREFERENCES_EVENT = 'wharness:ui-preferences'

export type UIFontChoice = 'elegant' | 'system' | 'humanist'
export type MonoFontChoice = 'jetbrains' | 'system' | 'fira'
export type ThemePreference = 'original' | 'jetbrains-darcula' | 'jetbrains-light' | 'vscode-dark' | 'vscode-light' | 'high-contrast'
export type ResolvedTheme = 'light' | 'dark'
export type ContentSchemePreference = 'follow-ui' | 'original' | 'light' | 'dark' | 'high-contrast'
export type ResolvedContentScheme = 'light' | 'dark' | 'high-contrast'
export type UIDensity = 'default' | 'compact'
export type UIAccent = 'brand' | 'blue' | 'violet' | 'orange' | 'rose' | 'cyan'
export type ToolRailPlacement = 'sides' | 'bottom'
export type UIPreferences = {
  uiFont: UIFontChoice
  monoFont: MonoFontChoice
  scale: number
  theme: ThemePreference
  accent: UIAccent
  contentScheme: ContentSchemePreference
  density: UIDensity
  toolRailPlacement: ToolRailPlacement
  errorPopups: boolean
}

export type UIPreferencesInput = Partial<Omit<UIPreferences, 'theme'>> & { theme?: ThemePreference | 'system' | 'dark' | 'light' }

export type ThemeDescriptor = { id: ThemePreference; family: 'Wharnex' | 'JetBrains' | 'VS Code' | 'Acessibilidade'; label: string; hint: string }
export type AccentDescriptor = { id: UIAccent; label: string }

export const UI_THEME_REGISTRY: readonly ThemeDescriptor[] = [
  { id: 'original', family: 'Wharnex', label: 'Original', hint: 'Identidade original preservada' },
  { id: 'jetbrains-darcula', family: 'JetBrains', label: 'Darcula', hint: 'Cinzas neutros e contraste IDE' },
  { id: 'jetbrains-light', family: 'JetBrains', label: 'Light', hint: 'Superfícies claras e compactas' },
  { id: 'vscode-dark', family: 'VS Code', label: 'Dark+', hint: 'Azul escuro e chrome discreto' },
  { id: 'vscode-light', family: 'VS Code', label: 'Light+', hint: 'Claro limpo com seleção azul' },
  { id: 'high-contrast', family: 'Acessibilidade', label: 'Alto contraste', hint: 'Contraste reforçado para leitura' },
]

export const UI_ACCENT_REGISTRY: readonly AccentDescriptor[] = [
  { id: 'brand', label: 'Tema' },
  { id: 'blue', label: 'Azul' },
  { id: 'violet', label: 'Violeta' },
  { id: 'orange', label: 'Laranja' },
  { id: 'rose', label: 'Rosa' },
  { id: 'cyan', label: 'Ciano' },
]

export const DEFAULT_UI_PREFERENCES: UIPreferences = {
  uiFont: 'elegant',
  monoFont: 'jetbrains',
  scale: 1,
  theme: 'original',
  accent: 'brand',
  contentScheme: 'follow-ui',
  density: 'default',
  toolRailPlacement: 'sides',
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
  root.dataset.uiAccent = normalized.accent
  root.dataset.theme = resolvedTheme
  root.dataset.contentSchemePreference = normalized.contentScheme
  root.dataset.contentScheme = contentScheme
  root.dataset.density = normalized.density
  root.removeAttribute('data-tool-window')
  root.dataset.toolRail = normalized.toolRailPlacement
  root.style.colorScheme = resolvedTheme
  const themeColor = normalized.theme === 'high-contrast' ? '#000000' : resolvedTheme === 'dark' ? '#1e1f22' : '#f3f4f5'
  document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')?.setAttribute('content', themeColor)
}

export function resolveTheme(theme: ThemePreference): ResolvedTheme {
  if (theme === 'jetbrains-light' || theme === 'vscode-light') return 'light'
  if (theme === 'jetbrains-darcula' || theme === 'vscode-dark' || theme === 'high-contrast') return 'dark'
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

export function resolveContentScheme(contentScheme: ContentSchemePreference, uiTheme: ThemePreference): ResolvedContentScheme {
  if (contentScheme === 'high-contrast') return 'high-contrast'
  if (contentScheme === 'light' || contentScheme === 'dark') return contentScheme
  return resolveTheme(uiTheme)
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
  const theme = normalizeTheme(value.theme)
  const accent: UIAccent = value.accent === 'blue' || value.accent === 'violet' || value.accent === 'orange' || value.accent === 'rose' || value.accent === 'cyan' ? value.accent : 'brand'
  const contentScheme: ContentSchemePreference = value.contentScheme === 'original' || value.contentScheme === 'light' || value.contentScheme === 'dark' || value.contentScheme === 'high-contrast' ? value.contentScheme : 'follow-ui'
  const density: UIDensity = value.density === 'compact' ? 'compact' : 'default'
  const toolRailPlacement: ToolRailPlacement = value.toolRailPlacement === 'bottom' ? 'bottom' : 'sides'
  const numeric = Number(value.scale)
  const scale = Number.isFinite(numeric) ? Math.min(1.6, Math.max(0.4, Math.round(numeric * 20) / 20)) : DEFAULT_UI_PREFERENCES.scale
  const errorPopups = value.errorPopups !== false
  return { uiFont, monoFont, scale, theme, accent, contentScheme, density, toolRailPlacement, errorPopups }
}

function normalizeTheme(theme: UIPreferencesInput['theme']): ThemePreference {
  if (theme === 'dark') return 'jetbrains-darcula'
  if (theme === 'light') return 'jetbrains-light'
  if (theme === 'jetbrains-darcula' || theme === 'jetbrains-light' || theme === 'vscode-dark' || theme === 'vscode-light' || theme === 'high-contrast') return theme
  return 'original'
}
