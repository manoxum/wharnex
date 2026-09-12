import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AgentRuntimeDrawer } from './AgentRuntimeDrawer'

class TestResizeObserver {
  observe() {}
  disconnect() {}
  unobserve() {}
}

function runtime(desiredWorkers = 6): DesktopAgentRuntimeState {
  return {
    instance_id: 'desktop-test',
    desired_workers: desiredWorkers,
    configured_workers: desiredWorkers,
    policies: { auto_scale: false, keep_flowing_global: false, keep_flowing_workers: [], auto_scaled_workers: 0 },
    limits: { min_workers: 1, max_workers: 6, supervisors: 2 },
    scheduler: { running: true, backend_reachable: true, last_refresh_at: '2026-09-11T10:00:00Z', last_error: '' },
    queue: { queued: 2, counts: { RUNNING: 1, WAITING: 1 }, due: 1, scheduled: 0, blocked: 0, oldest_due_created_at: '2026-09-11T09:55:00Z', next_not_before: '2026-09-11T10:00:10Z' },
    provider: { provider: 'chatgpt', paused: false, paused_until: '', reason: '', updated_at: '2026-09-11T10:00:00Z' },
    agents: [
      { id: 'supervisor-1', label: 'Supervisor 1', role: 'supervisor', status: 'idle', draining: false, chat_id: 'chat-human', error: '', browser: { available: true, web_contents_id: 10, url: 'https://chatgpt.com/c/human', title: 'Chat humano', loading: false } },
      { id: 'supervisor-2', label: 'Supervisor 2', role: 'supervisor', status: 'idle', draining: false, chat_id: '', error: '', browser: { available: false, web_contents_id: 0, url: '', title: '', loading: false } },
      { id: 'worker-1', label: 'Worker 1', role: 'worker', status: 'running', draining: false, chat_id: 'chat-1', task: { task_id: 'task-1', type: 'AWAIT_RESPONSE', chat_id: 'chat-1', request_id: 'req-1', root_request_id: 'req-root', conversation_id: 'conv-1', status: 'RUNNING', attempt: 2, max_attempts: 30, lease_expires_at: '2026-09-11T10:01:00Z', not_before: '2026-09-11T10:00:00Z', last_error: '', created_at: '2026-09-11T09:55:00Z', updated_at: '2026-09-11T10:00:00Z' }, last_claim_at: '2026-09-11T10:00:00Z', loop_active: true, error: '', browser: { available: true, web_contents_id: 11, url: 'https://chatgpt.com/c/worker', title: 'Chat worker', loading: false } },
    ],
  }
}

function agentsBridge(state: DesktopAgentRuntimeState = runtime()) {
  return {
    state: vi.fn(async () => state),
    setWorkerCount: vi.fn(async (count: number) => runtime(count)),
    setPolicies: vi.fn(async (policies: { auto_scale?: boolean; keep_flowing_global?: boolean }) => ({ ...state, policies: { ...state.policies, ...policies } })),
    setWorkerKeepFlowing: vi.fn(async (agentId: string, enabled: boolean) => ({ ...state, agents: state.agents.map((agent) => agent.id === agentId ? { ...agent, keep_flowing: enabled } : agent) })),
    pauseProvider: vi.fn(async (_pausedUntil?: string) => ({ ...state, provider: { ...state.provider, paused: true } })),
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
    expect(screen.getByText('RUNNING', { selector: '.agent-runtime-detail dd' })).toBeTruthy()
    expect(screen.getByText('WebContents #11')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Diminuir workers' }))
    await waitFor(() => expect(agents.setWorkerCount).toHaveBeenCalledWith(5))
  })

  it('toggles Auto scale and global Keep flowing policies', async () => {
    const agents = agentsBridge()
    window.wharnessDesktop = { agents } as unknown as WharnessDesktopBridge

    render(<AgentRuntimeDrawer onClose={() => undefined} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Inativo' }))
    await waitFor(() => expect(agents.setPolicies).toHaveBeenCalledWith({ auto_scale: true }))
    fireEvent.click(screen.getByRole('button', { name: 'Global inativo' }))
    await waitFor(() => expect(agents.setPolicies).toHaveBeenCalledWith({ keep_flowing_global: true }))
  })

  it('configures Keep flowing for one Worker when global mode is disabled', async () => {
    const agents = agentsBridge()
    window.wharnessDesktop = { agents } as unknown as WharnessDesktopBridge

    render(<AgentRuntimeDrawer onClose={() => undefined} />)
    fireEvent.click(await screen.findByText('Worker 1'))
    fireEvent.click(screen.getByRole('button', { name: 'Keep flowing · inativo' }))
    await waitFor(() => expect(agents.setWorkerKeepFlowing).toHaveBeenCalledWith('worker-1', true))
  })

  it('reports a fully deferred queue as scheduled rather than as pending backlog', async () => {
    // Bundle-retention cleanup is enqueued PENDING but deferred for days. Such
    // a queue is idle, and must not present an age that suggests stuck work.
    const state = runtime()
    state.queue = {
      queued: 36, counts: { PENDING: 36 }, due: 0, scheduled: 36, blocked: 0,
      oldest_due_created_at: '', next_not_before: '2026-09-13T22:32:18Z',
    }
    window.wharnessDesktop = { agents: agentsBridge(state) } as unknown as WharnessDesktopBridge

    const { container } = render(<AgentRuntimeDrawer onClose={() => undefined} />)
    expect(await screen.findByText('Mais antiga por executar: —')).toBeTruthy()
    const rows = [...container.querySelectorAll('.agent-runtime-queue')].map((row) => row.textContent)
    expect(rows).toContain('0 por executar36 agendadas')
  })

  it('reports exclusivity-guarded work separately from Worker backlog', async () => {
    const state = runtime()
    state.queue = {
      queued: 2, counts: { PENDING: 1, WAITING: 1 }, due: 0, scheduled: 1, guarded: 1, blocked: 0,
      oldest_due_created_at: '', next_not_before: '2026-09-13T22:32:18Z',
    }
    window.wharnessDesktop = { agents: agentsBridge(state) } as unknown as WharnessDesktopBridge

    const { container } = render(<AgentRuntimeDrawer onClose={() => undefined} />)
    await screen.findByText('Worker 1')
    const rows = [...container.querySelectorAll('.agent-runtime-queue')].map((row) => row.textContent)
    expect(rows).toContain('0 por executar1 agendadas1 aguardam liberação')
  })

  it('counts only queued work, never settled tasks or a lifetime total', async () => {
    // A settled task has left the queue; its tally described past throughput
    // while saying nothing about what is waiting to run now.
    const state = runtime()
    state.queue = {
      queued: 3, counts: { PENDING: 2, RUNNING: 1 }, due: 2, scheduled: 1, blocked: 0,
      oldest_due_created_at: '2026-09-11T09:55:00Z', next_not_before: '2026-09-11T10:00:10Z',
    }
    window.wharnessDesktop = { agents: agentsBridge(state) } as unknown as WharnessDesktopBridge

    const { container } = render(<AgentRuntimeDrawer onClose={() => undefined} />)
    await screen.findByText('Worker 1')
    const rows = [...container.querySelectorAll('.agent-runtime-queue')].map((row) => row.textContent)
    expect(rows).toContain('2 PENDING1 RUNNING')
    expect(rows.join(' ')).not.toMatch(/tarefas/)
    expect(rows.join(' ')).not.toMatch(/DONE|FAILED|CANCELLED|ATTENTION/)
  })

  it('shows a durable leased task as occupied instead of available', async () => {
    const state = runtime()
    const worker = state.agents.find((agent) => agent.id === 'worker-1')!
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
    fireEvent.click(screen.getByRole('button', { name: /Interagir aqui/ }))
    await waitFor(() => expect(agents.openInteraction).toHaveBeenCalledWith('worker-1', expect.objectContaining({ width: 1, height: 1 })))
    expect(screen.getByLabelText('Navegador interativo de Worker 1')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: /Terminar interação/ }))
    await waitFor(() => expect(agents.closeInteraction).toHaveBeenCalledWith('worker-1'))
  })


  it('moves a Worker into the main Engine flow when Seguir is requested', async () => {
    const agents = agentsBridge()
    const onClose = vi.fn()
    const listener = vi.fn()
    window.wharnessDesktop = { agents } as unknown as WharnessDesktopBridge
    window.addEventListener('wharnex:agent-follow', listener)

    render(<AgentRuntimeDrawer onClose={onClose} />)
    fireEvent.click(await screen.findByText('Worker 1'))
    fireEvent.click(screen.getByRole('button', { name: /Seguir \(flow\)/ }))

    expect(listener).toHaveBeenCalledTimes(1)
    expect((listener.mock.calls[0][0] as CustomEvent).detail).toEqual({ agentId: 'worker-1' })
    // Following a Worker must not dismiss the panel: the drawer closes only
    // when the operator asks it to.
    expect(onClose).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Fechar agentes' })).toBeTruthy()
    window.removeEventListener('wharnex:agent-follow', listener)
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
    await waitFor(() => expect(agents.snapshot).toHaveBeenCalledWith('supervisor-1'))
    expect(await screen.findByRole('img', { name: /Captura do navegador de Supervisor 1/ })).toBeTruthy()
  })

  it('suspends all new agentic work with an automatic resume deadline', async () => {
    const agents = agentsBridge()
    window.wharnessDesktop = { agents } as unknown as WharnessDesktopBridge

    render(<AgentRuntimeDrawer onClose={() => undefined} />)
    await screen.findByText('Trabalhos agentic')
    fireEvent.change(screen.getByLabelText('Minutos até retoma automática'), { target: { value: '30' } })
    fireEvent.click(screen.getByRole('button', { name: 'Suspender trabalhos' }))

    await waitFor(() => expect(agents.pauseProvider).toHaveBeenCalledTimes(1))
    const pausedUntil = String(agents.pauseProvider.mock.calls[0][0] || '')
    expect(Date.parse(pausedUntil)).toBeGreaterThan(Date.now() + 29 * 60_000)
    expect(Date.parse(pausedUntil)).toBeLessThan(Date.now() + 31 * 60_000)
  })

  it('supports indefinite suspension and explicit resume from the Agents panel', async () => {
    const agents = agentsBridge()
    window.wharnessDesktop = { agents } as unknown as WharnessDesktopBridge

    const { unmount } = render(<AgentRuntimeDrawer onClose={() => undefined} />)
    await screen.findByText('Trabalhos agentic')
    fireEvent.change(screen.getByLabelText('Modo de retoma'), { target: { value: 'manual' } })
    fireEvent.click(screen.getByRole('button', { name: 'Suspender trabalhos' }))
    await waitFor(() => expect(agents.pauseProvider).toHaveBeenCalledWith(undefined))
    unmount()

    const paused = runtime()
    paused.provider = { ...paused.provider, paused: true, paused_until: '', reason: 'Suspenso pelo utilizador até retoma manual' }
    const pausedAgents = agentsBridge(paused)
    pausedAgents.resumeProvider = vi.fn(async () => runtime())
    window.wharnessDesktop = { agents: pausedAgents } as unknown as WharnessDesktopBridge
    render(<AgentRuntimeDrawer onClose={() => undefined} />)

    const pausedLabel = await screen.findByText('Pausado globalmente')
    expect(pausedLabel.closest('.agent-runtime-diagnostic-row')?.className).toContain('tone-warning')
    expect(screen.getByText('Suspensos · retoma manual')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Retomar agora' }))
    await waitFor(() => expect(pausedAgents.resumeProvider).toHaveBeenCalledTimes(1))
  })
})
