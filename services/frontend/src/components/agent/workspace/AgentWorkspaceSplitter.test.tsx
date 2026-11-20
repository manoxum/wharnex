import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { AgentWorkspaceSplitter } from './AgentWorkspaceSplitter'

describe('AgentWorkspaceSplitter', () => {
  it('keeps the draggable divider neutral and forwards pointer input', () => {
    const onPointerDown = vi.fn()
    render(<AgentWorkspaceSplitter onPointerDown={onPointerDown}/>)
    const splitter = screen.getByRole('button', { name: 'Redimensionar chat e Engine' })

    expect(splitter.className).toContain('cursor-col-resize')
    expect(splitter.className).not.toContain('whx-accent')
    fireEvent.pointerDown(splitter)
    expect(onPointerDown).toHaveBeenCalledOnce()
  })
})
