import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import type { ChatAgentTask, OrchestratorOverview } from '../../types'
import { OrchestratorPlanningQueue } from './OrchestratorPlanningQueue'
import { OrchestratorWorkerFollowProvider, useOrchestratorWorkerFollows } from './useOrchestratorWorkerFollows'

const request = {
  request_id: 'orp_20260927T144117_72c4527aecd5dbb0', task_id: 'cat_ac99a4a360284292a83b',
  objective: 'Testar plano', status: 'RUNNING', phase: 'PLANNING', attempt: 1, max_attempts: 8,
  created_at: '2026-09-27T14:41:17Z', updated_at: '2026-09-27T14:42:00Z',
} satisfies OrchestratorOverview['planning_requests'][number]

const task: ChatAgentTask = {
  task_id: request.task_id, type: 'ORCHESTRATOR_PLAN', project_id: '', chat_id: '', session_id: '',
  request_id: request.request_id, root_request_id: request.request_id, conversation_id: '', parent_task_id: '',
  priority: 0, status: 'RUNNING', not_before: '', attempt: 1, max_attempts: 8, dedupe_key: '',
  assigned_worker: '', keep_flowing: false, lease_owner: 'desktop:test:worker-2', payload: {},
  last_error: '', created_at: request.created_at, updated_at: request.updated_at,
}

afterEach(() => { delete window.wharnessDesktop; vi.restoreAllMocks() })

function QueueHarness(props: Parameters<typeof OrchestratorPlanningQueue>[0]) {
  const registry = useOrchestratorWorkerFollows(props.requests, props.tasks)
  return <OrchestratorWorkerFollowProvider registry={registry}><OrchestratorPlanningQueue {...props}/></OrchestratorWorkerFollowProvider>
}

it('toggles two planning follows independently without replacing the first pair', () => {
  const secondRequest = { ...request, request_id: 'orp_second', task_id: 'cat_second', objective: 'Segundo plano', status: 'LEASED' } satisfies OrchestratorOverview['planning_requests'][number]
  const secondTask: ChatAgentTask = { ...task, task_id: secondRequest.task_id, request_id: secondRequest.request_id, status: 'LEASED', lease_owner: 'desktop:test:worker-3' }
  render(<QueueHarness requests={[request, secondRequest]} tasks={[task, secondTask]} chats={[]} busy={false} onRetry={vi.fn()}/> )

  fireEvent.click(screen.getAllByRole('button', { name: 'Acompanhar instância' })[0])
  fireEvent.click(screen.getByRole('button', { name: 'Acompanhar instância' }))
  expect(screen.getAllByRole('button', { name: 'A acompanhar' })).toHaveLength(2)

  fireEvent.click(screen.getAllByRole('button', { name: 'A acompanhar' })[0])
  expect(screen.getAllByRole('button', { name: 'A acompanhar' })).toHaveLength(1)
  expect(screen.getAllByRole('button', { name: 'Acompanhar instância' })).toHaveLength(1)
})

it('opens a planning request from the card without leaking action clicks into detail selection', () => {
  const agents = {
    openMonitor: vi.fn(async () => ({ ok: true, agentId: 'worker-2', alreadyOpen: false })),
    closeMonitor: vi.fn(async () => ({ ok: true, agentId: 'worker-2', closed: true })),
    onState: vi.fn(() => () => undefined),
  }
  window.wharnessDesktop = { agents } as unknown as WharnessDesktopBridge

  const onSelect = vi.fn()
  const onRetry = vi.fn()
  const onGoToChat = vi.fn()
  const failed = { ...request, status: 'FAILED' }
  const failedTask = { ...task, chat_id: request.request_id, session_id: 'ses-planning' }
  render(<QueueHarness
    requests={[failed]}
    tasks={[failedTask]}
    chats={[{ id: 'chat-planning', sessionId: 'ses-planning' }]}
    busy={false}
    onSelect={onSelect}
    onRetry={onRetry}
    onGoToChat={onGoToChat}
  />)

  fireEvent.click(screen.getByRole('button', { name: 'Abrir detalhe de Testar plano' }))
  expect(onSelect).toHaveBeenCalledTimes(1)
  expect(onSelect).toHaveBeenLastCalledWith(failed)

  onSelect.mockClear()
  fireEvent.click(screen.getByRole('button', { name: 'Acompanhar instância' }))
  expect(onSelect).not.toHaveBeenCalled()

  fireEvent.click(screen.getByRole('button', { name: 'Ver chat' }))
  expect(onGoToChat).toHaveBeenCalledWith('chat-planning', 'ses-planning')
  expect(onSelect).not.toHaveBeenCalled()

  fireEvent.click(screen.getByRole('button', { name: 'Retentar' }))
  expect(onRetry).toHaveBeenCalledWith(request.request_id)
  expect(onSelect).not.toHaveBeenCalled()
})

it('offers the drawer detail and the Tasks view filtered by the orchestration for each queued request', () => {
  const onSelect = vi.fn()
  const onOpenTasks = vi.fn()
  const plan = { id: 'opl_20260927T144117_aaaa', project_path: '/workspace/demo', title: 'Plano', objective: 'Testar plano', status: 'ACTIVE' as const,
    planner_request_id: request.request_id, created_at: request.created_at, updated_at: request.updated_at }
  render(<QueueHarness requests={[request]} tasks={[]} chats={[]} plans={[plan]} busy={false} onRetry={vi.fn()} onSelect={onSelect} onOpenTasks={onOpenTasks}/>)
  fireEvent.click(screen.getByRole('button', { name: /Detalhes/ }))
  expect(onSelect).toHaveBeenCalledWith(request)
  onSelect.mockClear()
  fireEvent.click(screen.getByRole('button', { name: /Ver tasks/ }))
  expect(onOpenTasks).toHaveBeenCalledWith(plan.id)
  expect(onSelect).not.toHaveBeenCalled()
})

it('offers following the ephemeral browser that plans the orchestration', () => {
  const ephemeral = { ...task, lease_owner: 'desktop-508e:translator-1' }
  render(<QueueHarness requests={[request]} tasks={[ephemeral]} chats={[]} busy={false} onRetry={vi.fn()}/>)
  expect(screen.getByRole('button', { name: /Acompanhar instância/ })).not.toBeNull()
})


it('shows the functional orchestration phase instead of the technical Worker status', () => {
  const awaitingApproval = { ...request, request_id: 'orp_analysis', task_id: 'task-analysis', objective: 'Aguardando aprovação', status: 'DONE', phase: 'AWAITING_APPROVAL' as const }
  const executing = { ...request, request_id: 'orp_execution', task_id: 'task-execution', objective: 'Executando tasks', status: 'DONE', phase: 'EXECUTING' as const }
  const review = { ...request, request_id: 'orp_review', task_id: 'task-review', objective: 'Em review', status: 'DONE', phase: 'REVIEW' as const }
  const completed = { ...request, request_id: 'orp_completed', task_id: 'task-completed', objective: 'Finalizada', status: 'DONE', phase: 'COMPLETED' as const }
  const archived = { ...request, request_id: 'orp_archived', task_id: 'task-archived', objective: 'Arquivada', status: 'DONE', phase: 'ARCHIVED' as const }
  render(<QueueHarness requests={[request, awaitingApproval, executing, review, completed, archived]} tasks={[]} chats={[]} busy={false} onRetry={vi.fn()}/>)

  expect(screen.getByText('4 ativos · 6 pedidos')).toBeTruthy()
  expect(screen.getByText('Em andamento')).toBeTruthy()
  expect(screen.getByText('Em análise')).toBeTruthy()
  expect(screen.getByText('Em execução')).toBeTruthy()
  expect(screen.getByText('Review')).toBeTruthy()
  expect(screen.getByText('Concluído')).toBeTruthy()
  expect(screen.getByText('Encerrado')).toBeTruthy()

  const analysisCard = screen.getByText('Aguardando aprovação').closest('article')
  const executionCard = screen.getByText('Executando tasks').closest('article')
  const archivedCard = screen.getByText('Arquivada').closest('article')
  expect(analysisCard?.textContent).toContain('Em análise')
  expect(analysisCard?.textContent).not.toContain('Concluído')
  expect(executionCard?.textContent).toContain('Em execução')
  expect(executionCard?.textContent).not.toContain('Concluído')
  expect(archivedCard?.textContent).toContain('Encerrado')
  expect(archivedCard?.textContent).not.toContain('Concluído')
})

it('keeps retry and error diagnostics tied to the technical planning status', () => {
  const failed = { ...request, status: 'FAILED', phase: 'EXECUTING' as const, last_error: 'Falha ao entregar o plano.' }
  render(<QueueHarness requests={[failed]} tasks={[]} chats={[]} busy={false} onRetry={vi.fn()}/>)

  expect(screen.getByText('Em execução')).toBeTruthy()
  expect(screen.getByText('Falha ao entregar o plano.')).toBeTruthy()
  expect(screen.getByRole('button', { name: /Retentar/ })).toBeTruthy()
})

it('keeps retry disabled while the queue is busy', () => {
  const failed = { ...request, status: 'ATTENTION' }
  render(<QueueHarness requests={[failed]} tasks={[]} chats={[]} busy onRetry={vi.fn()}/>)
  expect((screen.getByRole('button', { name: /Retentar/ }) as HTMLButtonElement).disabled).toBe(true)
})
