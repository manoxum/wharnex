import { useEffect, useState } from 'react'
import {
  UI_THEME_REGISTRY,
  loadUIPreferences,
  resolveTheme,
  saveUIPreferences,
  subscribeUIPreferences,
  type ThemePreference,
  type UIPreferences,
} from '../lib/uiPreferences'
import { Icon } from './Icon'

export function ThemeToggle({ compact = false }: { compact?: boolean }) {
  const [preferences, setPreferences] = useState<UIPreferences>(() => loadUIPreferences())

  useEffect(() => subscribeUIPreferences(setPreferences), [])

  const resolved = resolveTheme(preferences.theme)
  const next = pairedTheme(preferences.theme, resolved)
  const label = `Ativar tema ${resolveTheme(next) === 'dark' ? 'escuro' : 'claro'}`

  return <button
    type="button"
    className={`theme-toggle${compact ? ' compact' : ''}`}
    aria-label={label}
    title={`${label} · ${themeLabel(preferences.theme)}`}
    onClick={() => setPreferences(saveUIPreferences({ ...preferences, theme: next }))}
  >
    <Icon name={resolved === 'dark' ? 'sun' : 'moon'} size={compact ? 14 : 15}/>
    {!compact && <span>{resolved === 'dark' ? 'Claro' : 'Escuro'}</span>}
  </button>
}

export function ThemePreferenceControl({ value, onChange }: {
  value: ThemePreference
  onChange: (theme: ThemePreference) => void
}) {
  return <div className="theme-preference-control" role="radiogroup" aria-label="Tema da interface">
    {UI_THEME_REGISTRY.map((option) => <button
      key={option.id}
      type="button"
      className={value === option.id ? 'selected' : ''}
      role="radio"
      aria-checked={value === option.id}
      aria-label={`${option.family} ${option.label}`}
      onClick={() => onChange(option.id)}
    >
      <span className={`theme-preview theme-preview-${option.id}`}><Icon name={themeIcon(option.id)} size={15}/></span>
      <span><em>{option.family}</em><strong>{option.label}</strong><small>{option.hint}</small></span>
      <i aria-hidden="true"/>
    </button>)}
  </div>
}

function pairedTheme(theme: ThemePreference, resolved: 'light' | 'dark'): ThemePreference {
  if (theme === 'vscode-dark') return 'vscode-light'
  if (theme === 'vscode-light') return 'vscode-dark'
  if (theme === 'jetbrains-darcula') return 'jetbrains-light'
  if (theme === 'jetbrains-light') return 'jetbrains-darcula'
  return resolved === 'dark' ? 'jetbrains-light' : 'jetbrains-darcula'
}

function themeLabel(theme: ThemePreference) {
  const option = UI_THEME_REGISTRY.find((item) => item.id === theme)
  return option ? `${option.family} ${option.label}` : 'Tema'
}

function themeIcon(theme: ThemePreference): 'sun' | 'moon' | 'monitor' | 'alert' | 'code' {
  if (theme === 'jetbrains-light' || theme === 'vscode-light') return 'sun'
  if (theme === 'jetbrains-darcula') return 'moon'
  if (theme === 'vscode-dark') return 'code'
  if (theme === 'high-contrast') return 'alert'
  return 'monitor'
}
