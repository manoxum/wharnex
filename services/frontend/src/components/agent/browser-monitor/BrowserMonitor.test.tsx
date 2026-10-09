import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { bridge } from '../../chatgpt/surface/chatGPTDesktopPaneTestFixtures'
import type { ManagedArtifact } from '../../../types'
import { BrowserMonitor } from './BrowserMonitor'
const apiMocks = vi.hoisted(() => ({
  managedArtifacts: vi.fn(async (): Promise<{ artifacts: ManagedArtifact[] }> => ({ artifacts: [] })),
  artifactEntries: vi.fn(async () => ({ entries: [{ path: 'turn.json', size: 42, dir: false }] })),
  browserMonitorChats: vi.fn(async () => ({ chats: [] as Array<{ key: string; project_path: string; chat_id: string; title: string; url: string; kind: 'workspace' }> })),
}))
vi.mock('../../../lib/transport/http/api', () => ({ api: {
  managedArtifacts: apiMocks.managedArtifacts,
  artifactEntries: apiMocks.artifactEntries,
  browserMonitorChats: apiMocks.browserMonitorChats,
  artifactURL: (_sessionId: string, artifactId: string) => `/artifact/${artifactId}`,
  artifactEntryURL: (_sessionId: string, artifactId: string, path: string) => `/artifact/${artifactId}/entry?path=${path}`,
} }))

class ResizeObserverStub { observe() {}; disconnect() {}; unobserve() {} }

beforeEach(() => { vi.stubGlobal('ResizeObserver', ResizeObserverStub) })
afterEach(() => { cleanup(); delete window.wharnessDesktop; vi.unstubAllGlobals(); localStorage.removeItem('kernl.ui.preferences.v1'); document.documentElement.removeAttribute('data-theme'); apiMocks.managedArtifacts.mockReset(); apiMocks.managedArtifacts.mockResolvedValue({ artifacts: [] }); apiMocks.artifactEntries.mockClear(); apiMocks.browserMonitorChats.mockReset(); apiMocks.browserMonitorChats.mockResolvedValue({ chats: [] }) })

it('lists every browser and follows a Worker in the independent window', async () => {
  const desktop = bridge()
  const state = await desktop.agents.state()
  vi.mocked(desktop.agents.state).mockResolvedValue({
    ...state,
    agents: [
      { ...state.agents[0], id: 'supervisor-1', label: 'Supervisor 1', role: 'supervisor' },
      state.agents[1],
      { ...state.agents[1], id: 'ephemeral-cat_123', label: 'Worker efémero', task: { type: 'ORCHESTRATOR_PLAN', task_id: 'task-1' } as DesktopAgentRuntimeTask },
    ],
  })
  window.wharnessDesktop = desktop
  render(<BrowserMonitor />)

  expect(await screen.findByText('3 instâncias')).toBeTruthy()
  expect(screen.getByLabelText('Legenda dos estados')).toBeTruthy()
  expect(screen.getByText('Na fila / a aguardar')).toBeTruthy()
  await waitFor(() => expect(desktop.agents.presentInMonitor).toHaveBeenCalledWith('supervisor-1', expect.any(Object)))
  fireEvent.click(screen.getByRole('button', { name: /Worker efémero/ }))
  await waitFor(() => expect(desktop.agents.presentInMonitor).toHaveBeenCalledWith('ephemeral-cat_123', expect.any(Object)))
  expect(desktop.agents.releaseFromMonitor).toHaveBeenCalledWith('supervisor-1')
  expect(desktop.agents.openInteraction).not.toHaveBeenCalledWith('ephemeral-cat_123', expect.any(Object))
  expect(screen.getByTitle('ORCHESTRATOR PLAN · task-1')).toBeTruthy()
  act(() => fireEvent.click(screen.getByRole('button', { name: /Worker 2/ })))
  await waitFor(() => expect(desktop.agents.presentInMonitor).toHaveBeenCalledWith('worker-2', expect.any(Object)))
  expect(desktop.agents.snapshot).not.toHaveBeenCalled()
})

it('recolhe e expande lista e detalhes de forma independente', async () => {
  const desktop = bridge()
  window.wharnessDesktop = desktop
  render(<BrowserMonitor />)
  expect(await screen.findByText('2 instâncias')).toBeTruthy()
  const list = screen.getByRole('complementary', { name: 'Instâncias' })
  const details = screen.getByLabelText('Detalhes da instância')
  expect(details.lastElementChild?.getAttribute('aria-label')).toBe('Bundles trocados')
  expect(within(screen.getByRole('banner')).queryByRole('button', { name: /lista|detalhes/ })).toBeNull()
  fireEvent.click(within(list).getByRole('button', { name: 'Recolher lista de instâncias' }))
  expect(list.isConnected).toBe(true)
  expect(within(list).queryByRole('button', { name: /Worker 1/ })).toBeNull()
  expect(within(list).getByRole('button', { name: 'Expandir lista de instâncias' }).getAttribute('aria-expanded')).toBe('false')
  expect(details.isConnected).toBe(true)
  expect(screen.getByLabelText('Navegador da instância')).toBeTruthy()
  fireEvent.click(within(details).getByRole('button', { name: 'Recolher painel de detalhes' }))
  expect(details.isConnected).toBe(true)
  expect(within(details).queryByText('Tarefa')).toBeNull()
  expect(within(details).getByRole('button', { name: 'Expandir painel de detalhes' }).getAttribute('aria-expanded')).toBe('false')
  expect(screen.getByLabelText('Navegador da instância')).toBeTruthy()
  fireEvent.click(within(list).getByRole('button', { name: 'Expandir lista de instâncias' }))
  expect(within(list).getByRole('button', { name: /Worker 1/ })).toBeTruthy()
  expect(within(details).queryByText('Tarefa')).toBeNull()
  fireEvent.click(within(details).getByRole('button', { name: 'Expandir painel de detalhes' }))
  expect(within(details).getByText('Tarefa')).toBeTruthy()
})

it('presents the real browser even when its current page is blank', async () => {
  const desktop = bridge()
  const state = await desktop.agents.state()
  vi.mocked(desktop.agents.state).mockResolvedValue({
    ...state, agents: [{ ...state.agents[0], browser: { ...state.agents[0].browser, url: '', title: '' } }],
  })
  window.wharnessDesktop = desktop
  render(<BrowserMonitor />)
  await waitFor(() => expect(desktop.agents.presentInMonitor).toHaveBeenCalledWith('worker-1', expect.any(Object)))
  expect(screen.getByLabelText('Navegador real de Worker 1')).toBeTruthy()
  expect(desktop.agents.openInteraction).not.toHaveBeenCalled()
  expect(desktop.agents.snapshot).not.toHaveBeenCalled()
})

it('shows the instance the tray asked for and manages the instance policies', async () => {
  const desktop = bridge()
  const state = await desktop.agents.state()
  vi.mocked(desktop.agents.state).mockResolvedValue({
    ...state, configured_supervisors: 2, configured_workers: 2, worker_pause: { paused: false, paused_until: '' },
    limits: { min_supervisors: 1, max_supervisors: 6, min_workers: 1, max_workers: 6 },
    policies: { auto_scale: false, auto_scale_max_supervisors: 6, auto_scale_max_workers: 3, keep_flowing_global: false, keep_flowing_workers: [], workers_suspended: false, workers_suspended_until: '', rate_limit_cooldown_minutes: 7.5, auto_scaled_supervisors: 0, auto_scaled_workers: 0 },
  })
  let select: (selection: { agentId: string }) => void = () => undefined
  vi.mocked(desktop.agents.onMonitorSelect).mockImplementation((callback) => { select = callback; return () => undefined })
  window.wharnessDesktop = desktop
  render(<BrowserMonitor />)
  await waitFor(() => expect(desktop.agents.presentInMonitor).toHaveBeenCalledWith('worker-1', expect.any(Object)))
  act(() => select({ agentId: 'worker-2' }))
  await waitFor(() => expect(desktop.agents.presentInMonitor).toHaveBeenCalledWith('worker-2', expect.any(Object)))
  vi.mocked(desktop.agents.setPolicies).mockResolvedValue(await desktop.agents.state())
  vi.mocked(desktop.agents.releaseFromMonitor).mockClear()
  fireEvent.click(screen.getByRole('button', { name: /Políticas/ }))
  const policies = screen.getByRole('complementary', { name: 'Políticas das instâncias' })
  // The policies sit beside the real browser, which stays presented.
  expect(screen.getByLabelText('Navegador da instância')).toBeTruthy()
  expect(desktop.agents.releaseFromMonitor).not.toHaveBeenCalled()
  fireEvent.click(within(policies).getByRole('switch', { name: 'Auto scale' }))
  expect(desktop.agents.setPolicies).toHaveBeenCalledWith({ auto_scale: true })
  fireEvent.click(within(policies).getByRole('button', { name: 'Fechar políticas' }))
  expect(screen.queryByRole('complementary', { name: 'Políticas das instâncias' })).toBeNull()
})
it('switches between instance and GPT-link views without losing the selected browser', async () => {
  const desktop = bridge()
  const state = await desktop.agents.state()
  vi.mocked(desktop.agents.state).mockResolvedValue({
    ...state,
    agents: [
      { ...state.agents[0], browser: { ...state.agents[0].browser, url: 'https://chatgpt.com/c/shared?x=1' } },
      { ...state.agents[1], browser: { ...state.agents[1].browser, url: 'https://chatgpt.com/c/shared' } },
    ],
  })
  apiMocks.browserMonitorChats.mockResolvedValue({ chats: [{ key: 'workspace:chat-2', project_path: '/work', chat_id: 'chat-2', title: 'Conversa da equipa', url: 'https://chatgpt.com/c/shared', kind: 'workspace' }] })
  window.wharnessDesktop = desktop
  render(<BrowserMonitor />)
  expect(await screen.findByRole('tab', { name: 'Instâncias' })).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: /Worker 2/ }))
  fireEvent.click(screen.getByRole('tab', { name: 'Links GPT' }))
  const list = screen.getByRole('complementary', { name: 'Instâncias' })
  expect(await within(list).findByText('Conversa da equipa')).toBeTruthy()
  vi.mocked(desktop.agents.presentInMonitor).mockClear()
  fireEvent.click(within(list).getByRole('button', { name: /Conversa da equipa/ }))
  await waitFor(() => expect(desktop.agents.presentInMonitor).toHaveBeenCalledWith('worker-1', expect.any(Object)))
  expect(desktop.agents.presentLinkInMonitor).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('tab', { name: 'Instâncias' }))
  expect(within(list).getByRole('button', { name: /Worker 2/ }).getAttribute('aria-pressed')).toBe('true')
  fireEvent.keyDown(screen.getByRole('tab', { name: 'Instâncias' }), { key: 'ArrowRight' })
  expect(screen.getByRole('tab', { name: 'Links GPT' }).getAttribute('aria-selected')).toBe('true')
})
it('lists only bundles of the selected chat and opens their existing explorer', async () => {
  const desktop = bridge()
  const state = await desktop.agents.state()
  vi.mocked(desktop.agents.state).mockResolvedValue({ ...state, agents: [state.agents[0], { ...state.agents[1], id: 'worker-2', occupied: true }] })
  const requestId = 'req_20261005T100000_1234567890abcdef'
  const bundle = { id: 'bundle-1', request_id: requestId, direction: 'output' as const, kind: 'bundle', name: `whx_bundle_res_chat-2_${requestId}.zip`, size: 2048, sha256: 'a'.repeat(64), created_at: '2026-10-05T10:00:00Z', expires_at: '2026-11-05T10:00:00Z', bundle: true }
  apiMocks.managedArtifacts.mockResolvedValue({ artifacts: [
    { session_id: 'ses_2', project_path: '/work', chat_id: 'chat-2', artifact: bundle },
    { session_id: 'ses_2', project_path: '/work', chat_id: 'chat-2', artifact: { ...bundle, id: 'auxiliary', name: 'context.zip' } },
    { session_id: 'ses_2', project_path: '/work', chat_id: 'chat-2', artifact: { ...bundle, id: 'mismatched', name: `whx_bundle_res_chat-other_${requestId}.zip` } },
    { session_id: 'ses_other', project_path: '/work', chat_id: 'chat-other', artifact: { ...bundle, id: 'other', name: 'other.zip' } },
  ] })
  window.wharnessDesktop = desktop
  render(<BrowserMonitor />)
  expect(await screen.findByText(bundle.name)).toBeTruthy()
  expect(apiMocks.managedArtifacts).toHaveBeenCalledWith('chat-2', true, 'bundle')
  expect(screen.queryByText('other.zip')).toBeNull()
  expect(screen.queryByText('context.zip')).toBeNull()
  expect(screen.queryByText(`whx_bundle_res_chat-other_${requestId}.zip`)).toBeNull()
  fireEvent.click(screen.getByTitle(`Explorar ${bundle.name}`))
  await waitFor(() => expect(apiMocks.artifactEntries).toHaveBeenCalledWith('ses_2', 'bundle-1'), { timeout: 5_000 })
  expect(screen.getByRole('dialog', { name: `Explorar ${bundle.name}` })).toBeTruthy()
  await waitFor(() => expect(desktop.agents.releaseFromMonitor).toHaveBeenCalledWith('worker-2'))
  fireEvent.click(screen.getByRole('button', { name: /Worker 1/ }))
  expect(screen.queryByText(bundle.name)).toBeNull()
  expect(screen.queryByRole('dialog', { name: `Explorar ${bundle.name}` })).toBeNull()
})

it('uses the saved interface theme in the standalone monitor window', () => {
  localStorage.setItem('kernl.ui.preferences.v1', JSON.stringify({ theme: 'vscode-dark' }))
  document.documentElement.dataset.theme = 'light'
  window.wharnessDesktop = bridge()
  render(<BrowserMonitor />)
  expect(document.documentElement.dataset.theme).toBe('dark')
  expect(document.documentElement.dataset.uiTheme).toBe('vscode-dark')
})

it('finds bundles for a planning Worker by its request when its queue chat is not the artifact chat', async () => {
  const desktop = bridge()
  const state = await desktop.agents.state()
  const requestId = 'orp_20261005T100000_1234567890abcdef'
  const worker = { ...state.agents[1], id: 'worker-2', chat_id: requestId, project_id: '/work', task: { ...state.agents[1].task!, type: 'ORCHESTRATOR_PLAN', chat_id: requestId, request_id: requestId, project_id: '/work' } }
  const bundle = { id: 'planning-bundle', request_id: requestId, direction: 'input' as const, kind: 'bundle', name: `whx_bundle_req_orchestrator_${requestId}.zip`, size: 4096, sha256: 'a'.repeat(64), created_at: '2026-10-05T10:00:00Z', expires_at: '2026-11-05T10:00:00Z', bundle: true }
  vi.mocked(desktop.agents.state).mockResolvedValue({ ...state, agents: [worker] })
  apiMocks.managedArtifacts.mockResolvedValue({ artifacts: [
    { session_id: 'ses_owner', project_path: '/work', chat_id: 'owner-chat', artifact: bundle },
    { session_id: 'ses_other', project_path: '/other', chat_id: 'owner-chat', artifact: { ...bundle, id: 'other-project' } },
  ] })
  window.wharnessDesktop = desktop
  render(<BrowserMonitor />)
  await waitFor(() => expect(apiMocks.managedArtifacts).toHaveBeenCalledWith(requestId, true, 'bundle'))
  expect(await screen.findByText(bundle.name)).toBeTruthy()
  expect(screen.getByRole('region', { name: 'Bundles trocados' }).querySelectorAll('button[title^="Explorar"]')).toHaveLength(1)
})
