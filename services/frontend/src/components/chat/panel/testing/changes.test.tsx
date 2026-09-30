import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ChatPanel } from '../ChatPanel'
import { clearEphemeralComposerDrafts } from '../../../../lib/chat/history/workspaceMemory'
import { session, chatActions } from './panelTestFixtures'

describe('ChatPanel', () => {
  afterEach(() => { clearEphemeralComposerDrafts(); delete window.wharnessDesktop; vi.restoreAllMocks(); vi.unstubAllGlobals(); if (document.querySelector('.app-dialog-backdrop')) fireEvent.keyDown(document, { key: 'Escape' }); Object.defineProperty(navigator, 'clipboard', { configurable: true, value: undefined }) })

it('prioritizes normative diffs and previews only a bounded changed-file list', () => {
    const files = [
      { path: 'services/frontend/src/a.ts', additions: 1, deletions: 0, diff: 'diff a' },
      { path: 'services/frontend/src/b.ts', additions: 1, deletions: 0, diff: 'diff b' },
      { path: 'services/frontend/src/c.ts', additions: 1, deletions: 0, diff: 'diff c' },
      { path: 'services/frontend/src/d.ts', additions: 1, deletions: 0, diff: 'diff d' },
      { path: 'services/frontend/src/e.ts', additions: 1, deletions: 0, diff: 'diff e' },
      { path: 'SoT/AI_PROTOCOL.md', additions: 2, deletions: 0, diff: 'diff normative' },
    ]
    const view = render(
      <ChatPanel session={session} items={[{ id: 'change-preview', role: 'harness', source: 'wharness', presentation: 'change', text: 'Aplicado.', change: { planId: 'plan-preview', files, appliedAt: '2026-09-09T18:00:00Z', canRevert: false } }]} chats={[]} activeChatId="" busy={false} onSend={async () => undefined} {...chatActions} />,
    )
    expect(view.container.querySelectorAll('.change-file-row')).toHaveLength(4)
    expect(screen.getByText('SoT/AI_PROTOCOL.md')).toBeTruthy()
    expect(screen.getByText('Normativo')).toBeTruthy()
    expect(screen.queryByText('services/frontend/src/e.ts')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Mostrar mais 2 diffs' }))
    expect(view.container.querySelectorAll('.change-file-row')).toHaveLength(6)
    expect(screen.getByText('services/frontend/src/e.ts')).toBeTruthy()
  })

it('separates the total deletion count for danger styling', () => {
    const view = render(
      <ChatPanel session={session} items={[{ id: 'change-total-stats', role: 'harness', source: 'wharness', presentation: 'change', text: 'Aplicado.', change: { planId: 'plan-total-stats', files: [{ path: 'services/frontend/src/a.ts', additions: 7, deletions: 3, diff: 'diff total stats' }], appliedAt: '2026-09-09T18:00:00Z', canRevert: false } }]} chats={[]} activeChatId="" busy={false} onSend={async () => undefined} {...chatActions} />,
    )

    expect(view.container.querySelector('.change-summary-card > header > code')?.textContent).toBe('+7 −3')
    expect(view.container.querySelector('.change-summary-card > header > code i')?.textContent).toBe('−3')
  })

it('offers the inverse restore action for a reverted change card', async () => {
    const onRevertChange = vi.fn(async () => undefined)
    const item = { id: 'change-reverted', role: 'harness' as const, source: 'wharness' as const, presentation: 'change' as const, text: 'Revertido.', change: { planId: 'plan-reverted', files: [], appliedAt: '2026-09-09T18:00:00Z', canRevert: true, reverted: true } }
    render(
      <ChatPanel session={session} items={[item]} chats={[]} activeChatId="" busy={false} onSend={async () => undefined} onRevertChange={onRevertChange} {...chatActions} />,
    )

    const button = screen.getByRole('button', { name: 'Repor alteração' })
    fireEvent.click(button)
    await waitFor(() => expect(onRevertChange).toHaveBeenCalledWith(item))
    expect(screen.queryByRole('button', { name: 'Reverter alteração' })).toBeNull()
  })

it('renders actual host commands after the applied diff summary', () => {
    render(
      <ChatPanel session={session} items={[{ id: 'change-1', role: 'harness', source: 'wharness', presentation: 'change', text: 'Alterações e comandos aplicados ao host.', change: { planId: 'plan-1', files: [], hostCommands: [{ argv: ['make', 'build-stage'], cwd: '.', exit_code: 0, stdout: '', stderr: '', success: true, duration_ms: 4321 }], appliedAt: '2026-09-07T10:00:00Z', canRevert: false } }]} chats={[]} activeChatId="" busy={false} onSend={async () => undefined} {...chatActions} />,
    )
    expect(screen.getByText('Comandos no host')).toBeTruthy()
    expect(screen.getByText('make build-stage')).toBeTruthy()
    expect(screen.getByText('. · exit 0 · 4321 ms')).toBeTruthy()
  })
})
