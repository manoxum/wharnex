import type { UIPreferences } from '../transport/contracts'

const UI_FONTS: Record<UIPreferences['uiFont'], string> = {
  elegant: "Inter, Manrope, 'Segoe UI Variable', 'Segoe UI', ui-sans-serif, system-ui, sans-serif",
  system: "-apple-system, BlinkMacSystemFont, 'Segoe UI Variable', 'Segoe UI', system-ui, sans-serif",
  humanist: "Aptos, Calibri, Candara, 'Segoe UI', ui-sans-serif, system-ui, sans-serif",
}

export function applyUIPreferences(value: UIPreferences) {
  const root = document.documentElement
  const resolved = resolveTheme(value.theme, value.resolvedTheme)
  root.dataset.theme = resolved
  root.dataset.uiTheme = value.theme
  root.dataset.uiAccent = value.accent
  root.dataset.density = value.density
  root.style.colorScheme = resolved
  root.style.setProperty('--ui-font-family', UI_FONTS[value.uiFont] || UI_FONTS.elegant)
  root.style.setProperty('--ui-scale', String(Math.min(1.6, Math.max(.4, Number(value.scale) || 1))))
  const themeColor = value.theme === 'high-contrast' ? '#000000' : resolved === 'dark' ? '#111311' : '#f1f3ed'
  document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')?.setAttribute('content', themeColor)
}

function resolveTheme(theme: UIPreferences['theme'], desktopResolved?: UIPreferences['resolvedTheme']): 'light' | 'dark' {
  if (theme === 'jetbrains-light' || theme === 'vscode-light') return 'light'
  if (theme === 'jetbrains-darcula' || theme === 'vscode-dark' || theme === 'high-contrast') return 'dark'
  return desktopResolved || (window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
}
