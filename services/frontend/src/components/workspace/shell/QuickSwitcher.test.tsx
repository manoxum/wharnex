import { act, fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import { announceHeaderPopover } from '../../../lib/desktop/bridge/headerPopover'
import { loadUIPreferences } from '../../../lib/workspace/preferences/uiPreferences'
import { QuickSwitcher } from './QuickSwitcher'

describe('QuickSwitcher', () => {
  beforeEach(() => localStorage.clear())

  it('keeps primary appearance choices compact and exposes advanced layout controls on demand', () => {
    render(<QuickSwitcher />)
    fireEvent.click(screen.getByRole('button', { name: 'Aparência rápida' }))

    fireEvent.change(screen.getByRole('combobox', { name: 'Tema da interface' }), { target: { value: 'jetbrains-darcula' } })
    fireEvent.click(screen.getByRole('button', { name: 'Destaque: Azul' }))
    expect(screen.queryByText('Janelas')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Flutuantes' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Densidade: Compacta' }))

    fireEvent.click(screen.getByText('Mais opções'))
    fireEvent.click(screen.getByRole('button', { name: 'Cantos inferiores' }))
    fireEvent.change(screen.getByRole('combobox', { name: 'Esquema do conteúdo' }), { target: { value: 'light' } })

    const preferences = loadUIPreferences()
    expect(preferences.theme).toBe('jetbrains-darcula')
    expect(preferences.accent).toBe('blue')
    expect('toolWindowMode' in preferences).toBe(false)
    expect(preferences.toolRailPlacement).toBe('bottom')
    expect(preferences.contentScheme).toBe('light')
    expect(preferences.density).toBe('compact')
  })
  it('dismisses on captured outside interaction, focus changes and window blur', () => {
    render(<><button type="button" data-testid="outside" onPointerDown={(event) => event.stopPropagation()}>Outside</button><QuickSwitcher /></>)
    const trigger = screen.getByRole('button', { name: 'Aparência rápida' })
    const outside = screen.getByTestId('outside')

    fireEvent.click(trigger)
    fireEvent.pointerDown(outside)
    expect(screen.queryByRole('dialog', { name: 'Aparência rápida' })).toBeNull()

    fireEvent.click(trigger)
    fireEvent.focusIn(outside)
    expect(screen.queryByRole('dialog', { name: 'Aparência rápida' })).toBeNull()

    fireEvent.click(trigger)
    fireEvent(window, new Event('blur'))
    expect(screen.queryByRole('dialog', { name: 'Aparência rápida' })).toBeNull()
  })

  it('closes when another header popover is opened', () => {
    render(<QuickSwitcher />)
    fireEvent.click(screen.getByRole('button', { name: 'Aparência rápida' }))
    expect(screen.getByRole('dialog', { name: 'Aparência rápida' })).toBeTruthy()
    act(() => announceHeaderPopover('git'))
    expect(screen.queryByRole('dialog', { name: 'Aparência rápida' })).toBeNull()
  })

})
