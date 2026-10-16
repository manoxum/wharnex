import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { NumberStepper, Switch } from './selection'

describe('shared settings controls', () => {
  it('exposes the switch state and respects disabled changes', () => {
    const change = vi.fn()
    const view = render(<Switch label="Automação" checked={false} onChange={change}/>)
    fireEvent.click(screen.getByRole('switch', { name: 'Automação' }))
    expect(change).toHaveBeenCalledTimes(1)
    view.rerender(<Switch label="Automação" checked disabled onChange={change}/>)
    const toggle = screen.getByRole('switch')
    expect(toggle.getAttribute('aria-checked')).toBe('true')
    fireEvent.click(toggle)
    expect(change).toHaveBeenCalledTimes(1)
  })
  it('guards the minimum, maximum and in-flight stepper operations', () => {
    const change = vi.fn()
    const view = render(<NumberStepper label="workers" value={1} min={1} max={3} onChange={change}/>)
    fireEvent.click(screen.getByRole('button', { name: 'Diminuir workers' }))
    expect(change).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Aumentar workers' }))
    expect(change).toHaveBeenLastCalledWith(1)
    view.rerender(<NumberStepper label="workers" value={3} min={1} max={3} disabled onChange={change}/>)
    fireEvent.click(screen.getByRole('button', { name: 'Aumentar workers' }))
    fireEvent.click(screen.getByRole('button', { name: 'Diminuir workers' }))
    expect(change).toHaveBeenCalledTimes(1)
  })
})
