import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { WorkspaceSurfaceSplitter } from './WorkspaceSurfaceSplitter'

describe('WorkspaceSurfaceSplitter', () => {
  it('keeps the resize affordance neutral while preserving pointer direction', () => {
    const onPointerDown = vi.fn()
    render(<WorkspaceSurfaceSplitter direction="vertical" onPointerDown={onPointerDown}/>)
    const splitter = screen.getByRole('separator', { name: 'Redimensionar divisão do workspace' })

    expect(splitter.className).toContain('cursor-col-resize')
    expect(splitter.className).toContain('after:bg-whx-border-soft')
    expect(splitter.className).not.toContain('whx-accent')
    fireEvent.pointerDown(splitter)
    expect(onPointerDown).toHaveBeenCalledWith(expect.anything(), 'vertical')
  })
})
