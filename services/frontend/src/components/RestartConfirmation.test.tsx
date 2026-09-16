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
    render(<RestartConfirmation sessionId="ses-self" change={change} busy={false} onLater={vi.fn()} onRestart={vi.fn()}/>)

    expect(screen.getByText('Alterações desta versão')).toBeTruthy()
    expect(screen.getByText('2 ficheiro(s) ·', { exact: false })).toBeTruthy()
    expect(screen.getByTestId('restart-diff').textContent).toBe('src/first.ts')
    fireEvent.click(screen.getByRole('button', { name: 'src/second.ts' }))
    expect(screen.getByTestId('restart-diff').textContent).toBe('src/second.ts')
    expect(screen.getByRole('button', { name: 'Mais tarde' })).toBeTruthy()
    expect(screen.getByRole('button', { name: /Apenas esta/ })).toBeTruthy()
    expect(screen.getByRole('button', { name: /Todas agora/ })).toBeTruthy()
  })

  it('explains what the restart activates using the planner summary', () => {
    // The operator is deciding whether to restart the runtime; a diff alone
    // makes them reconstruct the intent from the patch.
    render(<RestartConfirmation sessionId="ses-self" change={{ ...change, summary: 'Corrige o dwell dos workers e espaça as submissões' }} busy={false} onLater={vi.fn()} onRestart={vi.fn()}/>)
    const summary = screen.getByLabelText('Resumo da alteração')
    expect(summary.textContent).toContain('O que foi feito')
    expect(summary.textContent).toContain('Corrige o dwell dos workers e espaça as submissões')
  })

  it('omits the summary block when a legacy change carries none', () => {
    render(<RestartConfirmation sessionId="ses-self" change={change} busy={false} onLater={vi.fn()} onRestart={vi.fn()}/>)
    expect(screen.queryByLabelText('Resumo da alteração')).toBeNull()
  })
})
