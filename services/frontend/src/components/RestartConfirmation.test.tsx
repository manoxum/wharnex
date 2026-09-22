import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { ChatChangeSummary } from '../types'
import { RestartConfirmation } from './RestartConfirmation'

vi.mock('./ChangeDiffEditor', () => ({ ChangeDiffEditor: ({ file }: { file: { path: string } }) => <div data-testid="restart-diff">{file.path}</div> }))

const change: ChatChangeSummary = {
  planId: 'plan-self',
  appliedAt: '2026-09-07T21:00:00.000Z',
  canRevert: true,
  files: [
    { path: 'src/first.ts', additions: 3, deletions: 1, diff: 'diff --git a/src/first.ts b/src/first.ts' },
    { path: 'src/second.ts', additions: 5, deletions: 2, diff: 'diff --git a/src/second.ts b/src/second.ts' },
  ],
}

describe('RestartConfirmation', () => {
  it('shows the applied diff before restart actions and lets the user switch files', () => {
    render(<RestartConfirmation sessionId="ses-self" change={change} impacts={['backend']} busy={false} onLater={vi.fn()} onActivate={vi.fn()}/>)

    expect(screen.getByText('Build concluído')).toBeTruthy()
    expect(screen.getByText('Alterações desta versão')).toBeTruthy()
    expect(screen.getByText('2', { selector: '.restart-confirmation-total > b' })).toBeTruthy()
    expect(screen.getByTestId('restart-diff').textContent).toBe('src/first.ts')
    fireEvent.click(screen.getByRole('button', { name: 'src/second.ts' }))
    expect(screen.getByTestId('restart-diff').textContent).toBe('src/second.ts')
    expect(screen.getByRole('button', { name: 'Mais tarde' })).toBeTruthy()
    expect(screen.getByRole('button', { name: /Aplicar agora/ })).toBeTruthy()
    expect(screen.getByText(/Pode ativar agora ou deixar a nova versão pronta/)).toBeTruthy()
  })

  it('presents affected components as a compact activation scope', () => {
    render(<RestartConfirmation sessionId="ses-self" change={change} impacts={['backend', 'frontend']} busy={false} onLater={vi.fn()} onActivate={vi.fn()}/>)

    const scope = screen.getByLabelText('Componentes afetados')
    expect(scope.textContent).toContain('Backend')
    expect(scope.textContent).toContain('Frontend')
    expect(scope.textContent).toContain('2 selecionados')
  })

  it('explains what the restart activates using the planner summary', () => {
    // The operator is deciding whether to restart the runtime; a diff alone
    // makes them reconstruct the intent from the patch.
    render(<RestartConfirmation sessionId="ses-self" change={{ ...change, summary: 'Corrige o dwell dos workers e espaça as submissões' }} impacts={['backend']} busy={false} onLater={vi.fn()} onActivate={vi.fn()}/>)
    const summary = screen.getByLabelText('Resumo da alteração')
    expect(summary.textContent).toContain('O que foi feito')
    expect(summary.textContent).toContain('Corrige o dwell dos workers e espaça as submissões')
  })

  it('omits the summary block when a legacy change carries none', () => {
    render(<RestartConfirmation sessionId="ses-self" change={change} impacts={['backend']} busy={false} onLater={vi.fn()} onActivate={vi.fn()}/>)
    expect(screen.queryByLabelText('Resumo da alteração')).toBeNull()
  })


  it('accumulates reports and activates the union of affected services once', () => {
    const onActivate = vi.fn()
    render(<RestartConfirmation reports={[
      { sessionId: 'ses-front', chatId: 'chat-front', chatTitle: 'Frontend A', change, impacts: ['frontend'] },
      { sessionId: 'ses-desktop', chatId: 'chat-desktop', chatTitle: 'Desktop B', change: { ...change, planId: 'plan-desktop', files: change.files.slice(0, 1) }, impacts: ['desktop', 'frontend'] },
    ]} busy={false} onLater={vi.fn()} onActivate={onActivate}/>)

    expect(screen.getByText('2 relatórios')).toBeTruthy()
    expect(screen.getByLabelText('Relatórios acumulados').textContent).toContain('Frontend A')
    expect(screen.getByLabelText('Relatórios acumulados').textContent).toContain('Desktop B')
    expect(screen.getByText('3', { selector: '.restart-confirmation-total > b' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /reiniciar desktop agora/i }))
    expect(onActivate).toHaveBeenCalledWith(['frontend', 'desktop'])
  })
})
