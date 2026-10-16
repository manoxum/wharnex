import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { Button, ControlPopover, Field, Select } from './index'

describe('workbench controls', () => {
  it('reveals controls on demand and returns focus after Escape', () => {
    const onChange = vi.fn()
    render(<ControlPopover label="Opções do painel"><Field label="Densidade"><Select value="normal" onChange={onChange}><option value="normal">Normal</option><option value="compact">Compacta</option></Select></Field></ControlPopover>)
    const trigger = screen.getByRole('button', { name: 'Opções do painel' })
    expect(screen.queryByRole('dialog')).toBeNull()
    fireEvent.click(trigger)
    const dialog = screen.getByRole('dialog', { name: 'Opções do painel' })
    expect(document.activeElement).toBe(dialog)
    expect(trigger.getAttribute('aria-controls')).toBe(dialog.id)
    fireEvent.change(within(dialog).getByRole('combobox'), { target: { value: 'compact' } })
    expect(onChange).toHaveBeenCalledTimes(1)
    fireEvent.keyDown(dialog, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(document.activeElement).toBe(trigger)
  })

  it('dismisses on outside pointer or keyboard focus without firing an action', () => {
    const action = vi.fn()
    render(<><ControlPopover label="Ações"><Button onClick={action}>Executar</Button></ControlPopover><button>Exterior</button></>)
    fireEvent.click(screen.getByRole('button', { name: 'Ações' }))
    fireEvent.pointerDown(document.body)
    expect(screen.queryByRole('dialog')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Ações' }))
    fireEvent.focusIn(screen.getByRole('button', { name: 'Exterior' }))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(action).not.toHaveBeenCalled()
  })

  it('keeps disabled actions inert and supplies visible text and icon labels', () => {
    const action = vi.fn()
    render(<Button disabled icon="trash" tone="danger" onClick={action}>Eliminar registo</Button>)
    const button = screen.getByRole('button', { name: 'Eliminar registo' })
    fireEvent.click(button)
    expect(action).not.toHaveBeenCalled()
    expect(button.className).toContain('text-whx-danger')
    expect(button.className).toContain('focus-visible:!ring-2')
  })
})
