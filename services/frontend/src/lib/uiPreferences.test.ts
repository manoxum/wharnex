import { beforeEach, describe, expect, it } from 'vitest'
import { DEFAULT_UI_PREFERENCES, loadUIPreferences, saveUIPreferences } from './uiPreferences'

describe('UI preferences', () => {
  beforeEach(() => { localStorage.clear(); document.documentElement.removeAttribute('style') })

  it('uses an elegant larger default and applies bounded custom preferences', () => {
    expect(loadUIPreferences()).toEqual(DEFAULT_UI_PREFERENCES)
    const saved = saveUIPreferences({ uiFont: 'humanist', monoFont: 'fira', scale: 2 })
    expect(saved.scale).toBe(1.3)
    expect(document.documentElement.style.getPropertyValue('--ui-font-family')).toContain('Aptos')
    expect(document.documentElement.style.getPropertyValue('--mono-font-family')).toContain('Fira Code')
  })
})
