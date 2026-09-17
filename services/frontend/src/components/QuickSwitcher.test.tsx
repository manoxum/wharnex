import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import { loadUIPreferences } from '../lib/uiPreferences'
import { QuickSwitcher } from './QuickSwitcher'

describe('QuickSwitcher', () => {
  beforeEach(() => localStorage.clear())

  it('changes theme, content scheme and density from one compact surface', () => {
    render(<QuickSwitcher />)
    fireEvent.click(screen.getByRole('button', { name: 'Aparência rápida' }))
    fireEvent.click(screen.getByRole('button', { name: 'Interface: Alto contraste' }))
    fireEvent.click(screen.getByRole('button', { name: 'Conteúdo: Claro' }))
    fireEvent.click(screen.getByRole('button', { name: 'Densidade: Compacta' }))

    const preferences = loadUIPreferences()
    expect(preferences.theme).toBe('high-contrast')
    expect(preferences.contentScheme).toBe('light')
    expect(preferences.density).toBe('compact')
  })
})
