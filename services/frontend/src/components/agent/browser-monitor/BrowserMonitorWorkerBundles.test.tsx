import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { BrowserMonitorBundles } from './BrowserMonitorBundles'

const apiMocks = vi.hoisted(() => ({
  managedArtifacts: vi.fn(async () => ({ artifacts: [] })),
  orchestratorTaskDetailFiles: vi.fn(async () => ({ files: [] as Array<{ session_id: string; artifact: Record<string, unknown> }> })),
}))
vi.mock('../../../lib/transport/http/api', () => ({ api: apiMocks }))
afterEach(() => { cleanup(); apiMocks.managedArtifacts.mockClear(); apiMocks.orchestratorTaskDetailFiles.mockReset() })

it('loads an execution Worker’s bundles from the task run session, not the queue chat id', async () => {
  const requestId = 'req_20261005T100000_1234567890abcdef'
  const name = `whx_bundle_res_agent-chat_${requestId}.zip`
  apiMocks.orchestratorTaskDetailFiles.mockResolvedValue({ files: [{ session_id: 'ses_run', artifact: {
    id: 'bundle-run', request_id: requestId, direction: 'output', kind: 'bundle', name,
    bundle: true, size: 1024, sha256: 'a'.repeat(64), created_at: '2026-10-05T10:00:00Z', expires_at: '2026-11-05T10:00:00Z',
  } }] })
  const agent = {
    id: 'worker-2', label: 'Worker 2', role: 'worker', status: 'running', draining: false,
    chat_id: 'otk_task', project_id: '/work', error: '',
    browser: { available: true, web_contents_id: 12, url: 'https://chatgpt.com/c/task', title: 'Task', loading: false },
    task: { type: 'ORCHESTRATOR_EXECUTE', task_id: 'cat_1', chat_id: 'otk_task', session_id: 'ses_owner', request_id: 'otk_task:run:1', project_id: '/work' },
  } as DesktopAgentRuntimeAgent
  render(<BrowserMonitorBundles agent={agent} onExplorerOpenChange={() => undefined} />)
  expect(await screen.findByText(name)).toBeTruthy()
  expect(apiMocks.orchestratorTaskDetailFiles).toHaveBeenCalledWith('ses_owner', 'otk_task')
  expect(apiMocks.managedArtifacts).not.toHaveBeenCalled()
})

it('does not widen an execution bundle lookup when its owner session is missing', async () => {
  const agent = {
    id: 'worker-2', label: 'Worker 2', role: 'worker', status: 'running', draining: false,
    chat_id: 'otk_task', project_id: '/work', error: '',
    browser: { available: true, web_contents_id: 12, url: 'https://chatgpt.com/c/task', title: 'Task', loading: false },
    task: { type: 'ORCHESTRATOR_EXECUTE', task_id: 'cat_1', chat_id: 'otk_task', project_id: '/work' },
  } as DesktopAgentRuntimeAgent
  render(<BrowserMonitorBundles agent={agent} onExplorerOpenChange={() => undefined} />)
  expect(await screen.findByRole('alert')).toHaveProperty('textContent', 'Sessão da tarefa indisponível para consultar os bundles.')
  expect(apiMocks.managedArtifacts).not.toHaveBeenCalled()
  expect(apiMocks.orchestratorTaskDetailFiles).not.toHaveBeenCalled()
})

it('keeps the Orchestrator task bundle lineage while a Worker awaits its response', async () => {
  apiMocks.orchestratorTaskDetailFiles.mockResolvedValue({ files: [] })
  const agent = {
    id: 'worker-2', label: 'Worker 2', role: 'worker', status: 'running', draining: false,
    chat_id: 'otk_task', project_id: '/work', error: '',
    browser: { available: true, web_contents_id: 12, url: 'https://chatgpt.com/c/task', title: 'Task', loading: false },
    task: { type: 'AWAIT_RESPONSE', task_id: 'cat_2', chat_id: 'otk_task', session_id: 'ses_run', project_id: '/work' },
  } as DesktopAgentRuntimeAgent
  render(<BrowserMonitorBundles agent={agent} onExplorerOpenChange={() => undefined} />)
  await screen.findByText('Nenhum bundle persistido para esta instância.')
  expect(apiMocks.orchestratorTaskDetailFiles).toHaveBeenCalledWith('ses_run', 'otk_task')
  expect(apiMocks.managedArtifacts).not.toHaveBeenCalled()
})
