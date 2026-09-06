import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import { saveUIPreferences } from '../lib/uiPreferences'
import { ThemePreferenceControl, ThemeToggle } from './ThemeToggle'

describe('theme controls', () => {
  beforeEach(() => {
    localStorage.clear()
    document.documentElement.removeAttribute('data-theme')
    document.documentElement.removeAttribute('data-theme-preference')
  })

  it('switches to the opposite resolved theme and persists the explicit choice', () => {
    saveUIPreferences({ uiFont: 'elegant', monoFont: 'jetbrains', scale: 1, theme: 'light', errorPopups: true })
    render(<ThemeToggle compact />)

    fireEvent.click(screen.getByRole('button', { name: 'Ativar tema escuro' }))

    expect(document.documentElement.dataset.theme).toBe('dark')
    expect(document.documentElement.dataset.themePreference).toBe('dark')
    expect(screen.getByRole('button', { name: 'Ativar tema claro' })).toBeTruthy()
  })

  it('offers light, dark and operating-system preferences accessibly', () => {
    let selected = 'light'
    const { rerender } = render(<ThemePreferenceControl value="system" onChange={(theme) => { selected = theme }} />)
    expect(screen.getByRole('radio', { name: /Sistema/ }).getAttribute('aria-checked')).toBe('true')
    fireEvent.click(screen.getByRole('radio', { name: /Escuro/ }))
    expect(selected).toBe('dark')
    rerender(<ThemePreferenceControl value="dark" onChange={(theme) => { selected = theme }} />)
    expect(screen.getByRole('radio', { name: /Escuro/ }).getAttribute('aria-checked')).toBe('true')
  })
})
