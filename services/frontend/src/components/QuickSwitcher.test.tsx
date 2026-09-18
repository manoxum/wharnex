import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import { loadUIPreferences } from '../lib/uiPreferences'
import { QuickSwitcher } from './QuickSwitcher'

describe('QuickSwitcher', () => {
  beforeEach(() => localStorage.clear())

  it('keeps primary appearance choices compact and exposes advanced layout controls on demand', () => {
    render(<QuickSwitcher />)
    fireEvent.click(screen.getByRole('button', { name: 'Aparência rápida' }))

    fireEvent.change(screen.getByRole('combobox', { name: 'Tema da interface' }), { target: { value: 'jetbrains-darcula' } })
    fireEvent.click(screen.getByRole('button', { name: 'Destaque: Azul' }))
    fireEvent.click(screen.getByRole('button', { name: 'Flutuantes' }))
    fireEvent.click(screen.getByRole('button', { name: 'Densidade: Compacta' }))

    fireEvent.click(screen.getByText('Mais opções'))
    fireEvent.click(screen.getByRole('button', { name: 'Cantos inferiores' }))
    fireEvent.change(screen.getByRole('combobox', { name: 'Esquema do conteúdo' }), { target: { value: 'light' } })

    const preferences = loadUIPreferences()
    expect(preferences.theme).toBe('jetbrains-darcula')
    expect(preferences.accent).toBe('blue')
    expect(preferences.toolWindowMode).toBe('floating')
    expect(preferences.toolRailPlacement).toBe('bottom')
    expect(preferences.contentScheme).toBe('light')
    expect(preferences.density).toBe('compact')
  })
})
