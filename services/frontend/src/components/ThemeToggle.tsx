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
  const next: ThemePreference = resolved === 'dark' ? 'light' : 'dark'
  const label = `Ativar tema ${next === 'dark' ? 'escuro' : 'claro'}`

  return <button
    type="button"
    className={`theme-toggle${compact ? ' compact' : ''}`}
    aria-label={label}
    title={`${label}${preferences.theme === 'original' ? ' · Tema Original ativo' : ''}`}
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
      onClick={() => onChange(option.id)}
    >
      <span className={`theme-preview theme-preview-${option.id}`}><Icon name={themeIcon(option.id)} size={15}/></span>
      <span><strong>{option.label}</strong><small>{option.hint}</small></span>
      <i aria-hidden="true"/>
    </button>)}
  </div>
}

function themeIcon(theme: ThemePreference): 'sun' | 'moon' | 'monitor' | 'alert' {
  if (theme === 'light') return 'sun'
  if (theme === 'dark') return 'moon'
  if (theme === 'high-contrast') return 'alert'
  return 'monitor'
}
