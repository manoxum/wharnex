import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import type { ChatAgentTask, OrchestratorOverview } from '../../types'
import { OrchestratorPlanningQueue } from './OrchestratorPlanningQueue'

const request = {
  request_id: 'orp_20260927T144117_72c4527aecd5dbb0', task_id: 'cat_ac99a4a360284292a83b',
  objective: 'Testar plano', status: 'RUNNING', attempt: 1, max_attempts: 8,
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

it('stops following the task and closes its window when the task completes', async () => {
  const agents = {
    openMonitor: vi.fn(async () => ({ ok: true, agentId: 'worker-2', alreadyOpen: false })),
    closeMonitor: vi.fn(async () => ({ ok: true, agentId: 'worker-2', closed: true })),
    onState: vi.fn(() => () => undefined),
  }
  window.wharnessDesktop = { agents } as unknown as WharnessDesktopBridge
  const props = { requests: [request], tasks: [task], chats: [], busy: false, onRetry: vi.fn() }
  const view = render(<OrchestratorPlanningQueue {...props}/> )
  fireEvent.click(screen.getByRole('button', { name: 'Acompanhar instância' }))
  expect(await screen.findByText('Seguindo Worker 2')).toBeTruthy()
  view.rerender(<OrchestratorPlanningQueue {...props} requests={[{ ...request, status: 'DONE' }]} tasks={[{ ...task, status: 'DONE' }]}/> )
  await waitFor(() => expect(screen.queryByText('Seguindo Worker 2')).toBeNull())
  await waitFor(() => expect(agents.closeMonitor).toHaveBeenCalledWith('worker-2'))
})
