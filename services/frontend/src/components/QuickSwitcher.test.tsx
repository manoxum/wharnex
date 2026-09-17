import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import { loadUIPreferences } from '../lib/uiPreferences'
import { QuickSwitcher } from './QuickSwitcher'

describe('QuickSwitcher', () => {
  beforeEach(() => localStorage.clear())

  it('changes theme, accent, window mode, rail placement, content scheme and density', () => {
    render(<QuickSwitcher />)
    fireEvent.click(screen.getByRole('button', { name: 'Aparência rápida' }))
    fireEvent.click(screen.getByRole('button', { name: 'Interface: JetBrains · Darcula' }))
    fireEvent.click(screen.getByRole('button', { name: 'Destaque: Azul' }))
    fireEvent.click(screen.getByRole('button', { name: 'Flutuantes' }))
    fireEvent.click(screen.getByRole('button', { name: 'Cantos inferiores' }))
    fireEvent.click(screen.getByRole('button', { name: 'Conteúdo: Claro' }))
    fireEvent.click(screen.getByRole('button', { name: 'Densidade: Compacta' }))
    const preferences = loadUIPreferences()
    expect(preferences.theme).toBe('jetbrains-darcula')
    expect(preferences.accent).toBe('blue')
    expect(preferences.toolWindowMode).toBe('floating')
    expect(preferences.toolRailPlacement).toBe('bottom')
    expect(preferences.contentScheme).toBe('light')
    expect(preferences.density).toBe('compact')
  })
})
