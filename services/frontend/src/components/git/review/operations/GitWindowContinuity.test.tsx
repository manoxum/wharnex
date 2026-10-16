import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { GitOperationModal, type GitOperation } from '../GitOperationModal'
import { INTERNAL_WINDOW_DOCK_ID } from '../../../../lib/workspace/layout/internalWindow'

afterEach(() => document.getElementById(INTERNAL_WINDOW_DOCK_ID)?.remove())
describe('Git operation window continuity', () => {
  it('retains its dialog and minimized state between preparation and review without confirming an operation', () => {
    const confirm = vi.fn()
    const operation: GitOperation = { title: 'Rever publicação', detail: 'Projeto Atlas', phase: 'preparing' }
    const view = render(<GitOperationModal operation={operation} onClose={vi.fn()}/>)
    const dialog = screen.getByRole('dialog', { name: operation.title })
    fireEvent.click(screen.getByRole('button', { name: `Minimizar ${operation.title}` }))
    view.rerender(<GitOperationModal operation={{ ...operation, phase: 'reviewing', previews: [], onConfirmReview: confirm }} onClose={vi.fn()}/>)
    expect(screen.queryByRole('dialog', { name: operation.title })).toBeNull()
    expect(confirm).not.toHaveBeenCalled()
    fireEvent.click(screen.getByTitle(`Restaurar ${operation.title}`))
    expect(screen.getByRole('dialog', { name: operation.title })).toBe(dialog)
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar e continuar' }))
    expect(confirm).toHaveBeenCalledTimes(1)
  })
})
