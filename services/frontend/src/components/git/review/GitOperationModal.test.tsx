import { fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { INTERNAL_WINDOW_DOCK_ID } from '../../../lib/workspace/layout/internalWindow'
import { GitOperationModal, type GitOperation } from './GitOperationModal'

vi.mock('./GitDiffReview', () => ({ GitDiffReview: () => <div data-testid="git-diff-review"/> }))

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
    expect(screen.getByRole('button', { name: 'Maximizar A alternar branch' })).toBeTruthy()
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

  it('renders the operation result as a token-based Tailwind status card', () => {
    const onClose = vi.fn()
    const operation: GitOperation = {
      title: 'A criar commit manual',
      detail: 'Escolha em quais repositórios os ficheiros selecionados serão commitados.',
      phase: 'success',
      message: 'Commit b0a31826 criado com 24 ficheiro(s).',
    }
    render(<GitOperationModal operation={operation} onClose={onClose}/>)

    const dialog = screen.getByRole('dialog', { name: 'A criar commit manual' })
    expect(dialog.className).toContain('rounded-2xl')
    expect(dialog.className).toContain('bg-whx-elevated')
    expect(dialog.className).not.toContain('git-operation-modal')
    expect(within(dialog).getByText('Operação Git')).toBeTruthy()
    expect(within(dialog).getByText('Commit b0a31826 criado com 24 ficheiro(s).')).toBeTruthy()
    expect(within(dialog).getByText('Concluído')).toBeTruthy()
    expect(within(dialog).getByRole('list', { name: 'Progresso da operação' }).children).toHaveLength(3)

    fireEvent.click(within(dialog).getByRole('button', { name: 'Fechar' }))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('keeps review confirmation above the diff surface and forwards the click', () => {
    const onConfirmReview = vi.fn()
    const operation: GitOperation = {
      title: 'A publicar alterações',
      detail: 'Rever antes de publicar.',
      phase: 'reviewing',
      previews: [{
        operation: 'push',
        repository: '',
        from_label: 'origin/main',
        to_label: 'main',
        diff: 'diff --git a/src/demo.ts b/src/demo.ts\n',
      }],
      onConfirmReview,
    }
    render(<GitOperationModal operation={operation} onClose={vi.fn()}/>)

    const dialog = screen.getByRole('dialog', { name: 'A publicar alterações' })
    const confirm = within(dialog).getByRole('button', { name: 'Confirmar e continuar' }) as HTMLButtonElement
    const footer = confirm.closest('footer')
    expect(dialog.className).toContain('isolate')
    expect(dialog.className).toContain('w-[min(96vw,1680px)]')
    expect(screen.getByTestId('git-diff-review').parentElement?.className).toContain('z-0')
    expect(footer?.className).toContain('z-10')
    expect(footer?.className).toContain('shrink-0')
    expect(confirm.className).toContain('pointer-events-auto')
    expect(confirm.disabled).toBe(false)

    fireEvent.click(confirm)
    expect(onConfirmReview).toHaveBeenCalledTimes(1)
  })
})
