import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { api } from '../../../lib/transport/http/api'
import type { OrchestratorTask, Session } from '../../../types'
import { OrchestratorTaskDrawer } from './OrchestratorTaskDrawer'

const owner = { id: 'ses_owner', project_path: '/workspace/demo', reasoning_effort: 'high' } as unknown as Session
const task: OrchestratorTask = {
  id: 'otk_20260929T000000_aaaaaaaaaaaaaaaa', project_path: '/workspace/demo', title: 'Tabs task', status: 'REVIEW', condition: 'none', priority: 'high',
  parallelizable: false, created_at: '2026-09-29T00:00:00Z', updated_at: '2026-09-29T00:00:00Z', conversation_url: 'https://chatgpt.com/c/task-conversation',
}
const agent = {
  id: 'ses_agent', project_path: '/workspace/demo', state: 'applied', execution_mode: 'protected', automation_mode: 'auto_approve',
  last_main_request_summary: 'Resumo **cumulativo** da task.', last_turn: { protocol: 'harness.turn/v1', request_id: 'req_1', kind: 'change', message: 'Mensagem final do GPT.' },
  artifacts: [], request_lineages: {},
} as unknown as Session

afterEach(() => {
  delete window.wharnessDesktop
  vi.restoreAllMocks()
})


function installDesktopAgents(initial: DesktopAgentRuntimeState) {
  const listeners = new Set<(state: DesktopAgentRuntimeState) => void>()
  let current = initial
  const agents = {
    state: vi.fn(async () => current),
    onState: vi.fn((listener: (state: DesktopAgentRuntimeState) => void) => { listeners.add(listener); return () => listeners.delete(listener) }),
    openMonitor: vi.fn(async (agentId: string) => ({ ok: true, agentId, alreadyOpen: false })),
    closeMonitor: vi.fn(async (agentId: string) => ({ ok: true, agentId, closed: true })),
    openInteraction: vi.fn(async (agentId: string, bounds: DesktopBounds) => ({ ok: true, agentId, bounds })),
    setInteractionBounds: vi.fn(async (agentId: string, bounds: DesktopBounds) => ({ ok: true, agentId, bounds })),
    closeInteraction: vi.fn(async (agentId: string) => ({ ok: true, agentId, closed: true })),
  }
  window.wharnessDesktop = { agents } as unknown as WharnessDesktopBridge
  return {
    agents,
    publish(state: DesktopAgentRuntimeState) {
      current = state
      listeners.forEach((listener) => listener(state))
    },
  }
}

function runtimeWithWorker(workerTaskId = task.id) {
  return {
    agents: [{ id: 'worker-1', role: 'worker', label: 'Worker 1', pinned_task_id: workerTaskId, browser: { available: true } }],
  } as unknown as DesktopAgentRuntimeState
}

function mockRuns() {
  vi.spyOn(api, 'orchestratorTaskRuns').mockResolvedValue({ runs: [
    { id: 'orun_1', task_id: task.id, project_path: task.project_path, session_id: 'ses_old', attempt: 1, status: 'failed', error: 'verification failed', started_at: '2026-09-29T00:00:00Z' },
    { id: 'orun_2', task_id: task.id, project_path: task.project_path, session_id: 'ses_agent', attempt: 2, status: 'review', started_at: '2026-09-29T01:00:00Z' },
  ] })
  const getSession = vi.spyOn(api, 'getSession').mockResolvedValue(agent)
  vi.spyOn(api, 'eventHistory').mockResolvedValue({ events: [], total: 0, truncated: false })
  return getSession
}

function renderDrawer() {
  return render(<OrchestratorTaskDrawer session={owner} task={task} tasks={[task]} busy={false} onClose={vi.fn()} onMove={vi.fn()} onRun={vi.fn()} onSelectedTask={vi.fn()}/>)
}

it('shows the five task tabs and the AI thinking of the latest run in the overview', async () => {
  const getSession = mockRuns()
  renderDrawer()
  for (const name of ['Overview', 'Bundles', 'Plano', 'Execution', 'Engine']) expect(screen.getByRole('tab', { name })).not.toBeNull()
  expect(screen.getByRole('tab', { name: 'Overview' }).getAttribute('aria-selected')).toBe('true')
  // The latest run's Agent Session is the default, and the run list is no longer a section of its own.
  await waitFor(() => expect(getSession).toHaveBeenCalledWith('ses_agent'))
  expect(await screen.findByText('Mensagem final do GPT.')).not.toBeNull()
  expect(screen.queryByText('Execuções')).toBeNull()
})

it('reads bundles, plan and execution from the selected run, as the agentic Inspector does', async () => {
  const getSession = mockRuns()
  renderDrawer()
  fireEvent.click(screen.getByRole('tab', { name: 'Bundles' }))
  const selector = await screen.findByRole('combobox')
  fireEvent.change(selector, { target: { value: 'orun_1' } })
  await waitFor(() => expect(getSession).toHaveBeenCalledWith('ses_old'))
  fireEvent.click(screen.getByRole('tab', { name: 'Execution' }))
  expect(screen.getByRole('tab', { name: 'Execution' }).getAttribute('aria-selected')).toBe('true')
})

it('explains the Engine tab outside the Desktop', async () => {
  mockRuns()
  renderDrawer()
  fireEvent.click(screen.getByRole('tab', { name: 'Engine' }))
  expect(await screen.findByText(/só está disponível no Wharnex Desktop/)).not.toBeNull()
})

it('opens the task Worker directly inside Engine without using the native monitor', async () => {
  const { agents } = installDesktopAgents(runtimeWithWorker())
  mockRuns()
  renderDrawer()

  fireEvent.click(screen.getByRole('tab', { name: 'Engine' }))

  expect(await screen.findByText('Worker 1 está nesta task')).not.toBeNull()
  await waitFor(() => expect(agents.openInteraction).toHaveBeenCalledWith('worker-1', expect.any(Object)))
  expect(screen.queryByRole('button', { name: 'Acompanhar instância' })).toBeNull()
  expect(screen.queryByRole('button', { name: 'Parar de acompanhar' })).toBeNull()
  expect(agents.openMonitor).not.toHaveBeenCalled()
  expect(agents.closeMonitor).not.toHaveBeenCalled()
})

it('keeps Engine informative when no Worker is associated with the task', async () => {
  const { agents } = installDesktopAgents({ agents: [] } as unknown as DesktopAgentRuntimeState)
  mockRuns()
  renderDrawer()

  fireEvent.click(screen.getByRole('tab', { name: 'Engine' }))

  expect(await screen.findByText('Nenhum Worker nesta task agora')).not.toBeNull()
  expect(agents.openInteraction).not.toHaveBeenCalled()
  expect(agents.openMonitor).not.toHaveBeenCalled()
})

it('closes the embedded Worker when it leaves the task and restores the empty state', async () => {
  const { agents, publish } = installDesktopAgents(runtimeWithWorker())
  mockRuns()
  renderDrawer()
  fireEvent.click(screen.getByRole('tab', { name: 'Engine' }))
  await waitFor(() => expect(agents.openInteraction).toHaveBeenCalledWith('worker-1', expect.any(Object)))

  publish({ agents: [] } as unknown as DesktopAgentRuntimeState)

  expect(await screen.findByText('Nenhum Worker nesta task agora')).not.toBeNull()
  await waitFor(() => expect(agents.closeInteraction).toHaveBeenCalledWith('worker-1'))
  expect(agents.closeMonitor).not.toHaveBeenCalled()
})

it('unmounts the embedded Worker when leaving Engine without affecting the task', async () => {
  const { agents } = installDesktopAgents(runtimeWithWorker())
  mockRuns()
  renderDrawer()
  fireEvent.click(screen.getByRole('tab', { name: 'Engine' }))
  await waitFor(() => expect(agents.openInteraction).toHaveBeenCalledWith('worker-1', expect.any(Object)))

  fireEvent.click(screen.getByRole('tab', { name: 'Overview' }))

  await waitFor(() => expect(agents.closeInteraction).toHaveBeenCalledWith('worker-1'))
  expect(screen.getByRole('tab', { name: 'Overview' }).getAttribute('aria-selected')).toBe('true')
  expect(agents.openMonitor).not.toHaveBeenCalled()
})
