import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { ComposerContextModeControl } from './ComposerContextModeControl'

describe('ComposerContextModeControl', () => {
  it('offers Partial and Full and reports the selected session mode', () => {
    const onChange = vi.fn()
    render(<ComposerContextModeControl mode="partial" disabled={false} onChange={onChange} />)
    const select = screen.getByRole('combobox', { name: 'Modalidade de contexto' })
    expect((select as HTMLSelectElement).value).toBe('partial')
    fireEvent.change(select, { target: { value: 'full' } })
    expect(onChange).toHaveBeenCalledWith('full')
  })
})
