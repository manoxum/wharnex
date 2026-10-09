import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { ComposerContextModeControl } from '../ComposerContextModeControl'
import { ComposerReasoningControl } from './ComposerReasoningControl'

describe('compact composer choices', () => {
  it('keeps context and intelligence labels accessible without occupying visible toolbar space', () => {
    const context = vi.fn()
    const reasoning = vi.fn()
    render(<><ComposerContextModeControl mode="partial" disabled={false} onChange={context} />
      <ComposerReasoningControl value="high" disabled={false} onChange={reasoning} /></>)
    expect(screen.queryByText('Contexto')).toBeNull()
    expect(screen.queryByText('Inteligência')).toBeNull()
    fireEvent.change(screen.getByRole('combobox', { name: 'Modalidade de contexto' }), { target: { value: 'full' } })
    fireEvent.change(screen.getByRole('combobox', { name: 'Esforço de raciocínio' }), { target: { value: 'medium' } })
    expect(context).toHaveBeenCalledWith('full')
    expect(reasoning).toHaveBeenCalledWith('medium')
  })

  it('disables changes when the owning session cannot accept them', () => {
    render(<><ComposerContextModeControl mode="partial" disabled onChange={vi.fn()} />
      <ComposerReasoningControl value="high" disabled={false} /></>)
    for (const select of screen.getAllByRole('combobox')) expect((select as HTMLSelectElement).disabled).toBe(true)
  })
})
