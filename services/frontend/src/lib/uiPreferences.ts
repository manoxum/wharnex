const UI_PREFERENCES_KEY = 'kernl.ui.preferences.v1'

export type UIFontChoice = 'elegant' | 'system' | 'humanist'
export type MonoFontChoice = 'jetbrains' | 'system' | 'fira'
export type UIPreferences = { uiFont: UIFontChoice; monoFont: MonoFontChoice; scale: number }

export const DEFAULT_UI_PREFERENCES: UIPreferences = { uiFont: 'elegant', monoFont: 'jetbrains', scale: 1.1 }

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
  return normalized
}

export function applyUIPreferences(value: UIPreferences) {
  const normalized = normalizeUIPreferences(value)
  const root = document.documentElement
  root.style.setProperty('--ui-font-family', UI_FONTS[normalized.uiFont])
  root.style.setProperty('--mono-font-family', MONO_FONTS[normalized.monoFont])
  root.style.setProperty('--ui-font-scale', String(normalized.scale))
}

function normalizeUIPreferences(value: Partial<UIPreferences>): UIPreferences {
  const uiFont: UIFontChoice = value.uiFont === 'system' || value.uiFont === 'humanist' ? value.uiFont : 'elegant'
  const monoFont: MonoFontChoice = value.monoFont === 'system' || value.monoFont === 'fira' ? value.monoFont : 'jetbrains'
  const numeric = Number(value.scale)
  const scale = Number.isFinite(numeric) ? Math.min(1.3, Math.max(0.9, Math.round(numeric * 20) / 20)) : DEFAULT_UI_PREFERENCES.scale
  return { uiFont, monoFont, scale }
}
