import { fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { INTERNAL_WINDOW_DOCK_ID } from '../lib/internalWindow'
import { GitOperationModal, type GitOperation } from './GitOperationModal'

afterEach(() => document.getElementById(INTERNAL_WINDOW_DOCK_ID)?.remove())

function selectingOperation(onConfirmTargets = vi.fn()): GitOperation {
  return {
    title: 'A alternar branch',
    detail: 'Escolha os repositórios onde pretende alternar para feature/com-um-nome-bastante-longo.',
    phase: 'selecting',
    onConfirmTargets,
    targets: [
      { path: '', label: 'Superprojeto', branch: 'main', detail: 'origin/main', ahead: 1, behind: 2, available: true },
      { path: 'services/flowcore-backend-com-nome-longo', label: 'services/flowcore-backend-com-nome-longo', branch: 'feature/com-um-nome-bastante-longo', detail: 'origin/feature/com-um-nome-bastante-longo', ahead: 0, behind: 0, available: true },
    ],
  }
}

describe('GitOperationModal', () => {
  it('shows complete repository context and quick multi-select controls', () => {
    const onConfirmTargets = vi.fn()
    render(<GitOperationModal operation={selectingOperation(onConfirmTargets)} onClose={vi.fn()}/>)

    const dialog = screen.getByRole('dialog', { name: 'A alternar branch' })
    expect(dialog.className).toContain('selecting')
    expect(within(dialog).getByText('services/flowcore-backend-com-nome-longo')).toBeTruthy()
    expect(within(dialog).getByText('feature/com-um-nome-bastante-longo · origin/feature/com-um-nome-bastante-longo')).toBeTruthy()
    expect(within(dialog).getByLabelText('1 para enviar e 2 para receber')).toBeTruthy()

    fireEvent.click(within(dialog).getByRole('button', { name: 'Nenhum' }))
    expect(within(dialog).getByText('0 de 2 selecionado(s)')).toBeTruthy()
    expect(within(dialog).getByRole('button', { name: /Continuar/ }).hasAttribute('disabled')).toBe(true)

    fireEvent.click(within(dialog).getByRole('button', { name: 'Todos' }))
    fireEvent.click(within(dialog).getByRole('checkbox', { name: 'Executar em services/flowcore-backend-com-nome-longo' }))
    fireEvent.click(within(dialog).getByRole('button', { name: 'Continuar (1)' }))
    expect(onConfirmTargets).toHaveBeenCalledWith([''])
  })
})
