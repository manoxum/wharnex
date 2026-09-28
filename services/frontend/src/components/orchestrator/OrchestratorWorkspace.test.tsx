import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ComponentProps } from 'react'
import { api } from '../../lib/api'
import { emptyOrchestratorTaskCounts } from '../../lib/orchestratorApi'
import type { Session } from '../../types'
import { ChatPanel } from '../ChatPanel'
import { OrchestratorWorkspace } from './OrchestratorWorkspace'

vi.mock('../ChatPanel', () => ({ ChatPanel: () => <div data-testid="chat-panel-stub"/> }))

const session = {
  id: 'ses-orchestrator', project_path: '/workspace/demo', state: 'ready', execution_mode: 'protected', automation_mode: 'auto', chat_transport_mode: 'scraper', effort_level: 'high', created_at: '2026-09-12T15:00:00.000Z',
  context: { id: 'ctx', manifest: { id: 'ctx', project_root: '/workspace/demo', sha256: 'abc', files: [], excluded: [], text_truncated: false } },
} satisfies Session

// This workspace stays mounted (CSS-hidden) whenever another mode is active,
// so a naive mount-time setInterval polled every 5s forever even while the
// operator was looking at Agent or Editor mode the whole time.
describe('OrchestratorWorkspace polling', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.spyOn(api, 'orchestratorOverview').mockResolvedValue({ plans: [], tasks: [], task_counts: emptyOrchestratorTaskCounts(), planning_requests: [], mutation_slots: 1, mutation_slots_used: 0 })
    vi.spyOn(api, 'chatAgentTasks').mockResolvedValue({ tasks: [] })
  })
  afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks() })

  it('does not poll while inactive', async () => {
    render(<OrchestratorWorkspace session={session} chatProps={{} as ComponentProps<typeof ChatPanel>} active={false} onError={() => undefined}/>)
    await act(async () => { await Promise.resolve() })
    expect(api.orchestratorOverview).not.toHaveBeenCalled()

    await act(async () => { vi.advanceTimersByTime(20_000) })
    expect(api.orchestratorOverview).not.toHaveBeenCalled()
  })


  it('submits a one-shot bootstrap objective when a new project starts in Orchestrator', async () => {
    const proposal = { request_id: 'orp-bootstrap', worker_task_id: 'task-bootstrap', delivery_status: 'PENDING' }
    const propose = vi.spyOn(api, 'proposeOrchestratorPlan').mockResolvedValue(proposal)
    const accepted = vi.fn()
    const props = {
      session,
      chatProps: {} as ComponentProps<typeof ChatPanel>,
      active: true,
      bootstrapObjective: 'Criar uma plataforma de reservas',
      bootstrapIncludeContext: false,
      onBootstrapAccepted: accepted,
      onError: vi.fn(),
    }

    const view = render(<OrchestratorWorkspace {...props}/>)
    await act(async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve() })

    expect(propose).toHaveBeenCalledWith(session.id, 'Criar uma plataforma de reservas', { include_context: false })
    expect(accepted).toHaveBeenCalledTimes(1)

    view.rerender(<OrchestratorWorkspace {...props}/>)
    await act(async () => { await Promise.resolve() })
    expect(propose).toHaveBeenCalledTimes(1)
  })

  it('polls every 5s once active, and stops again once it becomes inactive', async () => {
    const { rerender } = render(<OrchestratorWorkspace session={session} chatProps={{} as ComponentProps<typeof ChatPanel>} active onError={() => undefined}/>)
    await act(async () => { await Promise.resolve() })
    expect(api.orchestratorOverview).toHaveBeenCalledTimes(1)

    await act(async () => { vi.advanceTimersByTime(5_000); await Promise.resolve() })
    expect(api.orchestratorOverview).toHaveBeenCalledTimes(2)

    rerender(<OrchestratorWorkspace session={session} chatProps={{} as ComponentProps<typeof ChatPanel>} active={false} onError={() => undefined}/>)
    const callsWhenDeactivated = vi.mocked(api.orchestratorOverview).mock.calls.length
    await act(async () => { vi.advanceTimersByTime(20_000) })
    expect(api.orchestratorOverview).toHaveBeenCalledTimes(callsWhenDeactivated)
  })

  it('opens, refreshes, closes and reopens planning detail without leaving Overview', async () => {
    const planningRequest = {
      request_id: 'orp-detail',
      task_id: 'cat-detail',
      objective: 'Detalhar pedido',
      status: 'RUNNING',
      attempt: 1,
      max_attempts: 8,
      created_at: '2026-09-28T01:00:00Z',
      updated_at: '2026-09-28T01:05:00Z',
    }
    vi.mocked(api.orchestratorOverview).mockResolvedValue({
      plans: [],
      tasks: [],
      task_counts: emptyOrchestratorTaskCounts(),
      planning_requests: [planningRequest],
      mutation_slots: 1,
      mutation_slots_used: 0,
    })
    const detail = {
      request_id: planningRequest.request_id,
      task_id: planningRequest.task_id,
      status: planningRequest.status,
      attempt: planningRequest.attempt,
      max_attempts: planningRequest.max_attempts,
      objective: planningRequest.objective,
      include_context: false,
      project_files: [],
      attachments: [],
      attempts: [],
      tasks: [],
    }
    const loadDetail = vi.spyOn(api, 'orchestratorPlanningDetail').mockResolvedValue(detail)

    render(<OrchestratorWorkspace session={session} chatProps={{} as ComponentProps<typeof ChatPanel>} active onError={() => undefined}/>)
    await act(async () => { await Promise.resolve(); await Promise.resolve() })

    fireEvent.click(screen.getByRole('button', { name: 'Abrir detalhe de Detalhar pedido' }))
    await act(async () => { await Promise.resolve(); await Promise.resolve() })
    expect(loadDetail).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('tab', { name: 'Resumo' })).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Atualizar detalhe do planeamento' }))
    await act(async () => { await Promise.resolve(); await Promise.resolve() })
    expect(loadDetail).toHaveBeenCalledTimes(2)

    fireEvent.click(screen.getByRole('button', { name: 'Fechar detalhe do planeamento' }))
    expect(screen.queryByRole('tab', { name: 'Resumo' })).toBeNull()
    expect(screen.getByText('Em planejamento')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Abrir detalhe de Detalhar pedido' }))
    await act(async () => { await Promise.resolve(); await Promise.resolve() })
    expect(loadDetail).toHaveBeenCalledTimes(3)
    expect(screen.getByRole('tab', { name: 'Resumo' })).toBeTruthy()
  })

})
