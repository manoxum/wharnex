import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { api } from '../lib/api'
import type { Session } from '../types'
import type { WorkspaceChat } from '../lib/workspaceMemory'
import { ExecutionErrorsDrawer } from './ExecutionErrorsDrawer'

const chats: WorkspaceChat[] = [
  { id: 'chat-1', title: 'Migração', sessionId: 'ses-1', createdAt: '2026-09-19T10:00:00Z', updatedAt: '2026-09-19T10:00:00Z' },
  { id: 'chat-2', title: 'Runtime', sessionId: 'ses-2', createdAt: '2026-09-19T11:00:00Z', updatedAt: '2026-09-19T11:00:00Z' },
]

const session = { id: 'ses-1', project_path: '/workspace/project' } as Session

describe('ExecutionErrorsDrawer', () => {
  afterEach(() => vi.restoreAllMocks())

  it('aggregates project occurrences, filters by status and exposes failure details', async () => {
    vi.spyOn(api, 'executionErrors').mockImplementation(async (sessionId) => ({ errors: sessionId === 'ses-1' ? [{
      id: 'err-open', session_id: 'ses-1', chat_id: 'chat-1', root_request_id: 'req-root', request_id: 'req-1', plan_id: 'plan-1', stage: 'execution', error: 'go test failed', cause: 'verification failed', failure_kind: 'host_build_toolchain_mismatch', status_code: 1, status: 'open', occurred_at: '2026-09-19T12:00:00Z', updated_at: '2026-09-19T12:00:00Z', logs: [{ kind: 'command', argv: ['go', 'test', './...'], exit_code: 1, stderr: 'compile failed' }],
    }] : [{
      id: 'err-resolved', session_id: 'ses-2', chat_id: 'chat-2', request_id: 'req-2', plan_id: 'plan-2', stage: 'execution', error: 'apply failed', failure_kind: 'patch_apply_failed', status: 'resolved', occurred_at: '2026-09-19T11:30:00Z', resolved_at: '2026-09-19T11:45:00Z', updated_at: '2026-09-19T11:45:00Z', logs: [], gpt_solution: { request_id: 'req-fix', plan_id: 'plan-fix', summary: 'Corrigiu o patch.' },
    }] }))

    render(<ExecutionErrorsDrawer chats={chats} currentSession={session} activeChatId="chat-1" onClose={() => undefined}/>)

    const errorList = await screen.findByRole('list')
    expect(await within(errorList).findByText('go test failed')).toBeTruthy()
    expect(screen.getByText('Total').parentElement?.textContent).toContain('2')
    expect(screen.getAllByText('host_build_toolchain_mismatch').length).toBeGreaterThan(0)
    expect(screen.getByText('compile failed')).toBeTruthy()

    fireEvent.click(screen.getByRole('tab', { name: 'Resolvidas' }))
    await waitFor(() => expect(screen.queryAllByText('go test failed').length).toBe(0))
    const resolvedOccurrence = within(errorList).getByText('apply failed')
    fireEvent.click(resolvedOccurrence)
    expect(screen.getAllByText('apply failed').length).toBeGreaterThan(0)
    expect(screen.getByText('Solução aplicada pelo GPT')).toBeTruthy()
    expect(screen.getByText('Corrigiu o patch.')).toBeTruthy()
  })
})
