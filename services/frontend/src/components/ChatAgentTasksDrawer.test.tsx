import { render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { api } from '../lib/api'
import type { ChatAgentTask } from '../types'
import { ChatAgentTasksDrawer } from './ChatAgentTasksDrawer'

function task(patch: Partial<ChatAgentTask>): ChatAgentTask {
  return {
    task_id: 'cat-1', type: 'AWAIT_RESPONSE', project_id: 'project-1', chat_id: 'chat-1', session_id: 'ses-1', request_id: 'req-1',
    root_request_id: 'req-root', conversation_id: 'conv-1', parent_task_id: '', priority: 1, status: 'PENDING', not_before: '2026-09-11T20:00:00Z',
    attempt: 1, max_attempts: 30, dedupe_key: '', lease_owner: '', payload: { phase: 'observe' }, last_error: '', created_at: '2026-09-11T19:55:00Z', updated_at: '2026-09-11T20:00:00Z',
    ...patch,
  }
}

describe('ChatAgentTasksDrawer', () => {
  afterEach(() => vi.restoreAllMocks())

  it('shows every active task with worker, queue age and latest durable work', async () => {
    vi.spyOn(api, 'chatAgentTasks').mockResolvedValue({ tasks: [
      task({ task_id: 'cat-running', type: 'BOT_WRITE', status: 'RUNNING', lease_owner: 'desktop-1:worker-2', lease_expires_at: '2026-09-11T20:10:00Z' }),
      task({ task_id: 'cat-waiting', type: 'AWAIT_RESPONSE', status: 'WAITING', lease_owner: '', attempt: 3 }),
    ] })

    render(<ChatAgentTasksDrawer onClose={vi.fn()}/>)

    expect(await screen.findByText('Worker 2')).toBeTruthy()
    expect(screen.getByText('BOT_WRITE')).toBeTruthy()
    expect(screen.getByText('AWAIT_RESPONSE')).toBeTruthy()
    expect(screen.getAllByText('Último trabalho').length).toBe(2)
    expect(screen.getByText('cat-running')).toBeTruthy()
    expect(screen.getAllByText('Detalhes técnicos').length).toBe(2)
    await waitFor(() => expect(api.chatAgentTasks).toHaveBeenCalledWith(true))
  })

  it('keeps empty runtime state explicit', async () => {
    vi.spyOn(api, 'chatAgentTasks').mockResolvedValue({ tasks: [] })
    render(<ChatAgentTasksDrawer onClose={vi.fn()}/>)
    expect(await screen.findByText('Sem tarefas ativas.')).toBeTruthy()
  })
})
