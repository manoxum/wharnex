import { beforeEach, describe, expect, it } from 'vitest'
import { DEFAULT_UI_PREFERENCES, loadUIPreferences, resolveTheme, saveUIPreferences } from './uiPreferences'

describe('UI preferences', () => {
  beforeEach(() => {
    localStorage.clear()
    document.documentElement.removeAttribute('style')
    document.documentElement.removeAttribute('data-theme')
    document.documentElement.removeAttribute('data-theme-preference')
  })

  it('uses a readable 100% baseline and applies the expanded bounded scale', () => {
    expect(loadUIPreferences()).toEqual(DEFAULT_UI_PREFERENCES)
    const saved = saveUIPreferences({ uiFont: 'humanist', monoFont: 'fira', scale: 2, theme: 'dark', errorPopups: false })
    expect(DEFAULT_UI_PREFERENCES.scale).toBe(1)
    expect(saved.scale).toBe(1.6)
    expect(document.documentElement.style.getPropertyValue('--ui-font-scale')).toBe('2')
    expect(document.documentElement.style.getPropertyValue('--ui-font-family')).toContain('Aptos')
    expect(document.documentElement.style.getPropertyValue('--mono-font-family')).toContain('Fira Code')
    expect(document.documentElement.dataset.theme).toBe('dark')
    expect(document.documentElement.dataset.themePreference).toBe('dark')
    expect(document.documentElement.style.colorScheme).toBe('dark')
    expect(saved.errorPopups).toBe(false)
  })


  it('keeps 100% centered while allowing a 60% reduction from the baseline', () => {
    const saved = saveUIPreferences({ uiFont: 'elegant', monoFont: 'jetbrains', scale: 0, theme: 'system', errorPopups: true })
    expect(saved.scale).toBe(0.4)
    expect(document.documentElement.style.getPropertyValue('--ui-font-scale')).toBe('0.5')
  })

  it('migrates stored preferences without a theme and follows the operating system', () => {
    localStorage.setItem('kernl.ui.preferences.v1', JSON.stringify({ uiFont: 'system', monoFont: 'system', scale: 1 }))
    expect(loadUIPreferences().theme).toBe('system')
    expect(loadUIPreferences().errorPopups).toBe(true)
    expect(resolveTheme('light')).toBe('light')
  })
})
