import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AgentRuntimeDrawer } from './AgentRuntimeDrawer'

class TestResizeObserver {
  observe() {}
  disconnect() {}
  unobserve() {}
}

function runtime(desiredWorkers = 3): DesktopAgentRuntimeState {
  return {
    instance_id: 'desktop-test',
    desired_workers: desiredWorkers,
    limits: { min_workers: 1, max_workers: 6, supervisors: 1 },
    scheduler: { running: true, backend_reachable: true, last_refresh_at: '2026-09-11T10:00:00Z', last_error: '' },
    queue: { total: 2, counts: { RUNNING: 1, WAITING: 1 }, oldest_created_at: '2026-09-11T09:55:00Z', next_not_before: '2026-09-11T10:00:10Z' },
    provider: { provider: 'chatgpt', paused: false, paused_until: '', reason: '', updated_at: '2026-09-11T10:00:00Z' },
    agents: [
      { id: 'supervisor', label: 'Supervisor', role: 'supervisor', status: 'idle', draining: false, chat_id: 'chat-human', error: '', browser: { available: true, web_contents_id: 10, url: 'https://chatgpt.com/c/human', title: 'Chat humano', loading: false } },
      { id: 'worker-1', label: 'Worker 1', role: 'worker', status: 'running', draining: false, chat_id: 'chat-1', task: { task_id: 'task-1', type: 'AWAIT_RESPONSE', chat_id: 'chat-1', request_id: 'req-1', root_request_id: 'req-root', conversation_id: 'conv-1', status: 'RUNNING', attempt: 2, max_attempts: 30, lease_expires_at: '2026-09-11T10:01:00Z', not_before: '2026-09-11T10:00:00Z', last_error: '', created_at: '2026-09-11T09:55:00Z', updated_at: '2026-09-11T10:00:00Z' }, last_claim_at: '2026-09-11T10:00:00Z', loop_active: true, error: '', browser: { available: true, web_contents_id: 11, url: 'https://chatgpt.com/c/worker', title: 'Chat worker', loading: false } },
    ],
  }
}

function agentsBridge(state: DesktopAgentRuntimeState = runtime()) {
  return {
    state: vi.fn(async () => state),
    setWorkerCount: vi.fn(async (count: number) => runtime(count)),
    resumeProvider: vi.fn(async () => runtime()),
    snapshot: vi.fn(async (agentId: string) => ({ agentId, dataUrl: 'data:image/png;base64,AA==', capturedAt: '2026-09-10T23:00:00Z' })),
    openInteraction: vi.fn(async (agentId: string, bounds: DesktopBounds) => ({ ok: true, agentId, bounds })),
    setInteractionBounds: vi.fn(async (agentId: string, bounds: DesktopBounds) => ({ ok: true, agentId, bounds })),
    closeInteraction: vi.fn(async (agentId: string) => ({ ok: true, agentId, closed: true })),
    onState: vi.fn(() => () => undefined),
  }
}

describe('AgentRuntimeDrawer', () => {
  beforeEach(() => vi.stubGlobal('ResizeObserver', TestResizeObserver))

  afterEach(() => {
    delete window.wharnessDesktop
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('lists runtime instances, exposes task details and scales workers', async () => {
    const agents = agentsBridge()
    window.wharnessDesktop = { agents } as unknown as WharnessDesktopBridge

    render(<AgentRuntimeDrawer onClose={() => undefined} />)
    expect(await screen.findByText('Worker 1')).toBeTruthy()
    fireEvent.click(screen.getByText('Worker 1'))
    expect(screen.getByText(/AWAIT_RESPONSE · task-1/)).toBeTruthy()
    expect(screen.getByText('RUNNING')).toBeTruthy()
    expect(screen.getByText('WebContents #11')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Aumentar workers' }))
    await waitFor(() => expect(agents.setWorkerCount).toHaveBeenCalledWith(4))
  })

  it('shows a durable leased task as occupied instead of available', async () => {
    const state = runtime()
    const worker = state.agents[1]
    worker.status = 'claimed'
    if (worker.task) worker.task.status = 'LEASED'
    window.wharnessDesktop = { agents: agentsBridge(state) } as unknown as WharnessDesktopBridge

    render(<AgentRuntimeDrawer onClose={() => undefined} />)
    expect(await screen.findByText('Worker · Ocupado')).toBeTruthy()
  })

  it('opens and closes live interaction for a Worker browser', async () => {
    const agents = agentsBridge()
    window.wharnessDesktop = { agents } as unknown as WharnessDesktopBridge

    render(<AgentRuntimeDrawer onClose={() => undefined} />)
    fireEvent.click(await screen.findByText('Worker 1'))
    fireEvent.click(screen.getByRole('button', { name: /Interagir com navegador/ }))
    await waitFor(() => expect(agents.openInteraction).toHaveBeenCalledWith('worker-1', expect.objectContaining({ width: 1, height: 1 })))
    expect(screen.getByLabelText('Navegador interativo de Worker 1')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: /Terminar interação/ }))
    await waitFor(() => expect(agents.closeInteraction).toHaveBeenCalledWith('worker-1'))
  })

  it('captures a created browser even before it has a page URL', async () => {
    const state = runtime()
    state.agents[0].browser = { ...state.agents[0].browser, url: '', title: '' }
    const agents = agentsBridge(state)
    window.wharnessDesktop = { agents } as unknown as WharnessDesktopBridge

    render(<AgentRuntimeDrawer onClose={() => undefined} />)
    const button = await screen.findByRole('button', { name: /Capturar imagem/ })
    expect(button).not.toHaveProperty('disabled', true)
    fireEvent.click(button)
    await waitFor(() => expect(agents.snapshot).toHaveBeenCalledWith('supervisor'))
    expect(await screen.findByRole('img', { name: /Captura do navegador de Supervisor/ })).toBeTruthy()
  })

  it('shows queue/provider health and explicitly resumes a paused provider', async () => {
    const paused = runtime()
    paused.provider = { ...paused.provider, paused: true, reason: 'Verificação humana necessária' }
    const agents = agentsBridge(paused)
    agents.resumeProvider = vi.fn(async () => runtime())
    window.wharnessDesktop = { agents } as unknown as WharnessDesktopBridge

    render(<AgentRuntimeDrawer onClose={() => undefined} />)
    expect(await screen.findByText('Pausado globalmente')).toBeTruthy()
    expect(screen.getByText('1 WAITING')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Retomar provider' }))
    await waitFor(() => expect(agents.resumeProvider).toHaveBeenCalledTimes(1))
  })
})
