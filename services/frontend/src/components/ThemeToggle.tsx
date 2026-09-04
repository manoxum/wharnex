import { useEffect, useState } from 'react'
import {
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
  const next = resolved === 'dark' ? 'light' : 'dark'
  const label = `Ativar tema ${next === 'dark' ? 'escuro' : 'claro'}`

  return <button
    type="button"
    className={`theme-toggle${compact ? ' compact' : ''}`}
    aria-label={label}
    title={`${label}${preferences.theme === 'system' ? ' · atualmente segue o sistema' : ''}`}
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
  const options: Array<{ value: ThemePreference; icon: 'sun' | 'moon' | 'monitor'; label: string; hint: string }> = [
    { value: 'light', icon: 'sun', label: 'Claro', hint: 'Marfim e carvão' },
    { value: 'dark', icon: 'moon', label: 'Escuro', hint: 'Preto e cinza' },
    { value: 'system', icon: 'monitor', label: 'Sistema', hint: 'Segue o dispositivo' },
  ]
  return <div className="theme-preference-control" role="radiogroup" aria-label="Tema da interface">
    {options.map((option) => <button
      key={option.value}
      type="button"
      className={value === option.value ? 'selected' : ''}
      role="radio"
      aria-checked={value === option.value}
      onClick={() => onChange(option.value)}
    >
      <span className={`theme-preview theme-preview-${option.value}`}><Icon name={option.icon} size={15}/></span>
      <span><strong>{option.label}</strong><small>{option.hint}</small></span>
      <i aria-hidden="true"/>
    </button>)}
  </div>
}
