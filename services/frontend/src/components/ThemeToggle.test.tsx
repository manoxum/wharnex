import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import { saveUIPreferences } from '../lib/uiPreferences'
import { ThemePreferenceControl, ThemeToggle } from './ThemeToggle'

describe('theme controls', () => {
  beforeEach(() => {
    localStorage.clear()
    document.documentElement.removeAttribute('data-theme')
    document.documentElement.removeAttribute('data-theme-preference')
    document.documentElement.removeAttribute('data-ui-theme')
  })

  it('switches within the active IDE family and persists the explicit preset', () => {
    saveUIPreferences({ uiFont: 'elegant', monoFont: 'jetbrains', scale: 1, theme: 'jetbrains-light', errorPopups: true })
    render(<ThemeToggle compact />)
    fireEvent.click(screen.getByRole('button', { name: 'Ativar tema escuro' }))
    expect(document.documentElement.dataset.theme).toBe('dark')
    expect(document.documentElement.dataset.themePreference).toBe('jetbrains-darcula')
    expect(screen.getByRole('button', { name: 'Ativar tema claro' })).toBeTruthy()
  })

  it('offers Wharnex, JetBrains, VS Code and accessibility presets accessibly', () => {
    let selected = 'original'
    const { rerender } = render(<ThemePreferenceControl value="original" onChange={(theme) => { selected = theme }} />)
    expect(screen.getByRole('radio', { name: 'Wharnex Original' }).getAttribute('aria-checked')).toBe('true')
    fireEvent.click(screen.getByRole('radio', { name: 'VS Code Dark+' }))
    expect(selected).toBe('vscode-dark')
    rerender(<ThemePreferenceControl value="jetbrains-darcula" onChange={(theme) => { selected = theme }} />)
    expect(screen.getByRole('radio', { name: 'JetBrains Darcula' }).getAttribute('aria-checked')).toBe('true')
  })
})
