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

afterEach(() => vi.restoreAllMocks())

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
