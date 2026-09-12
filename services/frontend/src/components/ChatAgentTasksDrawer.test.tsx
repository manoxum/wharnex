import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { api } from '../lib/api'
import type { ChatAgentQueueSummary, ChatAgentTask } from '../types'
import { ChatAgentTasksDrawer } from './ChatAgentTasksDrawer'

function task(patch: Partial<ChatAgentTask>): ChatAgentTask {
  return {
    task_id: 'cat-1', type: 'AWAIT_RESPONSE', project_id: 'project-1', chat_id: 'chat-1', session_id: 'ses-1', request_id: 'req-1',
    root_request_id: 'req-root', conversation_id: 'conv-1', parent_task_id: '', priority: 1, status: 'PENDING', not_before: '2026-09-11T20:00:00Z',
    attempt: 1, max_attempts: 30, dedupe_key: '', lease_owner: '', payload: { phase: 'observe' }, last_error: '', created_at: '2026-09-11T19:55:00Z', updated_at: '2026-09-11T20:00:00Z',
    ...patch,
  }
}

function summary(patch: Partial<ChatAgentQueueSummary> = {}): ChatAgentQueueSummary {
  return { queued: 0, counts: {}, due: 0, scheduled: 0, guarded: 0, blocked: 0, ...patch }
}

describe('ChatAgentTasksDrawer', () => {
  afterEach(() => vi.restoreAllMocks())

  it('shows a compact readable summary and keeps operational detail expandable', async () => {
    vi.spyOn(api, 'chatAgentTasks').mockResolvedValue({ tasks: [
      task({ task_id: 'cat-running', type: 'BOT_WRITE', status: 'RUNNING', lease_owner: 'desktop-1:worker-2', lease_expires_at: '2026-09-11T20:10:00Z' }),
      task({ task_id: 'cat-waiting', type: 'AWAIT_RESPONSE', status: 'WAITING', lease_owner: '', attempt: 3, not_before: new Date(Date.now() + 30_000).toISOString() }),
    ] })
    vi.spyOn(api, 'chatAgentTaskSummary').mockResolvedValue(summary({ queued: 2, counts: { RUNNING: 1, WAITING: 1 }, scheduled: 1 }))

    render(<ChatAgentTasksDrawer onClose={vi.fn()}/>)

    expect(await screen.findByText('Worker 2')).toBeTruthy()
    expect(screen.getByText('Enviar pedido')).toBeTruthy()
    expect(screen.getByText('Aguardar resposta')).toBeTruthy()
    expect(screen.getAllByText('Atividade').length).toBe(2)
    expect(screen.queryByLabelText('Posição 1 na fila')).toBeNull()
    expect(screen.getByText(/Execução agendada em/)).toBeTruthy()
    expect(screen.getByText(/Aguardam a data de execução, não um Worker/)).toBeTruthy()
    const details = screen.getAllByText('Detalhes')[0].closest('details')
    expect(details?.hasAttribute('open')).toBe(false)
    fireEvent.click(screen.getAllByText('Detalhes')[0])
    expect(details?.hasAttribute('open')).toBe(true)
    expect(screen.getByText('cat-running')).toBeTruthy()
    await waitFor(() => expect(api.chatAgentTasks).toHaveBeenCalledWith(true))
    expect(api.chatAgentTaskSummary).toHaveBeenCalled()
  })

  it('keeps empty runtime state explicit', async () => {
    vi.spyOn(api, 'chatAgentTasks').mockResolvedValue({ tasks: [] })
    vi.spyOn(api, 'chatAgentTaskSummary').mockResolvedValue(summary())
    render(<ChatAgentTasksDrawer onClose={vi.fn()}/>)
    expect(await screen.findByText('Sem tarefas ativas.')).toBeTruthy()
  })

  it('does not present a future retention cleanup as waiting for an idle Worker', async () => {
    vi.spyOn(api, 'chatAgentTasks').mockResolvedValue({ tasks: [
      task({
        task_id: 'cat-retention', type: 'DELETE_BUNDLE', status: 'PENDING', attempt: 0, max_attempts: 8,
        not_before: new Date(Date.now() + 72 * 60 * 60 * 1000).toISOString(),
      }),
    ] })
    vi.spyOn(api, 'chatAgentTaskSummary').mockResolvedValue(summary({ queued: 1, counts: { PENDING: 1 }, scheduled: 1, next_not_before: new Date(Date.now() + 72 * 60 * 60 * 1000).toISOString() }))

    const { container } = render(<ChatAgentTasksDrawer onClose={vi.fn()}/>)

    expect(await screen.findByText('Limpar bundle')).toBeTruthy()
    expect(screen.getByText('Agendada')).toBeTruthy()
    expect(screen.getByText(/Execução agendada em/)).toBeTruthy()
    expect(screen.queryByText('A aguardar disponibilidade')).toBeNull()
    expect(screen.queryByText('Por atribuir')).toBeNull()
    expect(screen.queryByLabelText('Posição 1 na fila')).toBeNull()
    expect(container.querySelector('.chat-agent-tasks-summary')?.textContent).toContain('0 por executar')
    expect(container.querySelector('.chat-agent-tasks-summary')?.textContent).toContain('1 agendada')
  })

  it('reserves queue position and Worker availability language for due work', async () => {
    vi.spyOn(api, 'chatAgentTasks').mockResolvedValue({ tasks: [task({ not_before: new Date(Date.now() - 30_000).toISOString() })] })
    vi.spyOn(api, 'chatAgentTaskSummary').mockResolvedValue(summary({ queued: 1, counts: { PENDING: 1 }, due: 1 }))

    render(<ChatAgentTasksDrawer onClose={vi.fn()}/>)

    expect(await screen.findByText('Pronta para atribuição')).toBeTruthy()
    expect(screen.getByText('Por executar', { selector: '.chat-agent-task-state' })).toBeTruthy()
    expect(screen.getByLabelText('Posição 1 na fila')).toBeTruthy()
  })

  it('does not present conversation-protected work as claimable by an idle Worker', async () => {
    const conversation = 'conv-protected'
    vi.spyOn(api, 'chatAgentTasks').mockResolvedValue({ tasks: [
      task({ task_id: 'cat-await', type: 'AWAIT_RESPONSE', status: 'WAITING', conversation_id: conversation, not_before: new Date(Date.now() + 30_000).toISOString() }),
      task({ task_id: 'cat-title', type: 'TITLE_DISCOVER', status: 'PENDING', conversation_id: conversation, not_before: new Date(Date.now() - 30_000).toISOString() }),
    ] })
    vi.spyOn(api, 'chatAgentTaskSummary').mockResolvedValue(summary({ queued: 2, counts: { PENDING: 1, WAITING: 1 }, scheduled: 1, guarded: 1 }))

    const { container } = render(<ChatAgentTasksDrawer onClose={vi.fn()}/>)

    expect(await screen.findByText('A aguardar conclusão da resposta')).toBeTruthy()
    expect(screen.getByText('Protegida')).toBeTruthy()
    expect(screen.getByText('Atribuição protegida')).toBeTruthy()
    expect(screen.queryByLabelText('Posição 1 na fila')).toBeNull()
    expect(container.querySelector('.chat-agent-tasks-summary')?.textContent).toContain('0 por executar')
    expect(container.querySelector('.chat-agent-tasks-summary')?.textContent).toContain('1 aguarda liberação')
  })

  it('uses the aggregate to classify provider-paused work as guarded', async () => {
    vi.spyOn(api, 'chatAgentTasks').mockResolvedValue({ tasks: [task({ not_before: new Date(Date.now() - 30_000).toISOString() })] })
    vi.spyOn(api, 'chatAgentTaskSummary').mockResolvedValue(summary({ queued: 1, counts: { PENDING: 1 }, guarded: 1 }))

    render(<ChatAgentTasksDrawer onClose={vi.fn()}/>)

    expect(await screen.findByText('A aguardar liberação do provider')).toBeTruthy()
    expect(screen.queryByLabelText('Posição 1 na fila')).toBeNull()
    expect(screen.queryByText('Pronta para atribuição')).toBeNull()
  })
})
