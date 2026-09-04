import { beforeEach, describe, expect, it } from 'vitest'
import { DEFAULT_UI_PREFERENCES, loadUIPreferences, saveUIPreferences } from './uiPreferences'

describe('UI preferences', () => {
  beforeEach(() => { localStorage.clear(); document.documentElement.removeAttribute('style') })

  it('uses a readable 100% baseline and applies the expanded bounded scale', () => {
    expect(loadUIPreferences()).toEqual(DEFAULT_UI_PREFERENCES)
    const saved = saveUIPreferences({ uiFont: 'humanist', monoFont: 'fira', scale: 2 })
    expect(DEFAULT_UI_PREFERENCES.scale).toBe(1)
    expect(saved.scale).toBe(1.6)
    expect(document.documentElement.style.getPropertyValue('--ui-font-scale')).toBe('1.792')
    expect(document.documentElement.style.getPropertyValue('--ui-font-family')).toContain('Aptos')
    expect(document.documentElement.style.getPropertyValue('--mono-font-family')).toContain('Fira Code')
  })
})
