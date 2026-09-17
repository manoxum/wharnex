import { beforeEach, describe, expect, it } from 'vitest'
import { DEFAULT_UI_PREFERENCES, loadUIPreferences, resolveContentScheme, resolveTheme, saveUIPreferences } from './uiPreferences'

describe('UI preferences', () => {
  beforeEach(() => {
    localStorage.clear()
    document.documentElement.removeAttribute('style')
    document.documentElement.removeAttribute('data-theme')
    document.documentElement.removeAttribute('data-theme-preference')
    document.documentElement.removeAttribute('data-ui-theme')
    document.documentElement.removeAttribute('data-content-scheme')
    document.documentElement.removeAttribute('data-density')
  })

  it('uses a readable 100% baseline and applies theme, content scheme and density independently', () => {
    expect(loadUIPreferences()).toEqual(DEFAULT_UI_PREFERENCES)
    const saved = saveUIPreferences({ uiFont: 'humanist', monoFont: 'fira', scale: 2, theme: 'dark', contentScheme: 'light', density: 'compact', errorPopups: false })
    expect(DEFAULT_UI_PREFERENCES.scale).toBe(1)
    expect(saved.scale).toBe(1.6)
    expect(document.documentElement.style.getPropertyValue('--ui-font-scale')).toBe('2')
    expect(document.documentElement.style.getPropertyValue('--ui-font-family')).toContain('Aptos')
    expect(document.documentElement.style.getPropertyValue('--mono-font-family')).toContain('Fira Code')
    expect(document.documentElement.dataset.theme).toBe('dark')
    expect(document.documentElement.dataset.uiTheme).toBe('dark')
    expect(document.documentElement.dataset.contentScheme).toBe('light')
    expect(document.documentElement.dataset.density).toBe('compact')
    expect(document.documentElement.style.colorScheme).toBe('dark')
    expect(saved.errorPopups).toBe(false)
  })

  it('keeps 100% centered while allowing a 60% reduction from the baseline', () => {
    const saved = saveUIPreferences({ uiFont: 'elegant', monoFont: 'jetbrains', scale: 0, theme: 'original', errorPopups: true })
    expect(saved.scale).toBe(0.4)
    expect(document.documentElement.style.getPropertyValue('--ui-font-scale')).toBe('0.5')
  })

  it('migrates the legacy system theme to Original and follows the operating system', () => {
    localStorage.setItem('kernl.ui.preferences.v1', JSON.stringify({ uiFont: 'system', monoFont: 'system', scale: 1, theme: 'system' }))
    expect(loadUIPreferences().theme).toBe('original')
    expect(loadUIPreferences().contentScheme).toBe('follow-ui')
    expect(loadUIPreferences().density).toBe('default')
    expect(loadUIPreferences().errorPopups).toBe(true)
    expect(resolveTheme('light')).toBe('light')
  })

  it('resolves a content scheme independently from the shell theme', () => {
    expect(resolveContentScheme('dark', 'light')).toBe('dark')
    expect(resolveContentScheme('high-contrast', 'original')).toBe('high-contrast')
    expect(resolveContentScheme('follow-ui', 'light')).toBe('light')
  })
})
