import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AgentRuntimeDrawer } from './AgentRuntimeDrawer'

const dialog = vi.hoisted(() => ({ confirm: vi.fn(async () => true) }))
vi.mock('../lib/appDialog', () => ({ confirmDialog: dialog.confirm }))

class TestResizeObserver {
  observe() {}
  disconnect() {}
  unobserve() {}
}

function runtime(desiredWorkers = 6, desiredSupervisors = 3): DesktopAgentRuntimeState {
  return {
    instance_id: 'desktop-test',
    desired_supervisors: desiredSupervisors,
    configured_supervisors: desiredSupervisors,
    desired_workers: desiredWorkers,
    configured_workers: desiredWorkers,
    policies: { auto_scale: false, auto_scale_max_supervisors: 12, auto_scale_max_workers: 6, keep_flowing_global: false, keep_flowing_workers: [], workers_suspended: false, workers_suspended_until: '', rate_limit_cooldown_minutes: 7.5, auto_scaled_supervisors: 0, auto_scaled_workers: 0 },
    limits: { min_supervisors: 1, max_supervisors: 12, min_workers: 1, max_workers: 6 },
    scheduler: { running: true, backend_reachable: true, last_refresh_at: '2026-09-11T10:00:00Z', last_error: '' },
    queue: { queued: 2, counts: { RUNNING: 1, WAITING: 1 }, due: 1, scheduled: 0, blocked: 0, oldest_due_created_at: '2026-09-11T09:55:00Z', next_not_before: '2026-09-11T10:00:10Z' },
    provider: { provider: 'chatgpt', paused: false, paused_until: '', reason: '', updated_at: '2026-09-11T10:00:00Z' },
    worker_pause: { paused: false, paused_until: '' },
    memory: { available: true, total_workers_bytes: 340 * 1024 * 1024, total_supervisors_bytes: 220 * 1024 * 1024, total_agents_bytes: 560 * 1024 * 1024, desktop_bytes: 420 * 1024 * 1024, total_bytes: 980 * 1024 * 1024 },
    agents: [
      { id: 'supervisor-1', label: 'Supervisor 1', role: 'supervisor', status: 'idle', draining: false, chat_id: 'chat-human', error: '', browser: { available: true, web_contents_id: 10, os_process_id: 1010, url: 'https://chatgpt.com/c/human', title: 'Chat humano', loading: false }, memory: { available: true, rss_bytes: 110 * 1024 * 1024, os_process_id: 1010, shared_process: false } },
      { id: 'supervisor-2', label: 'Supervisor 2', role: 'supervisor', status: 'idle', draining: false, chat_id: '', error: '', browser: { available: false, web_contents_id: 0, os_process_id: 0, url: '', title: '', loading: false }, memory: { available: false, rss_bytes: 0, os_process_id: 0, shared_process: false } },
      { id: 'supervisor-3', label: 'Supervisor 3', role: 'supervisor', status: 'idle', draining: false, chat_id: '', error: '', browser: { available: false, web_contents_id: 0, os_process_id: 0, url: '', title: '', loading: false }, memory: { available: false, rss_bytes: 0, os_process_id: 0, shared_process: false } },
      { id: 'worker-1', label: 'Worker 1', role: 'worker', status: 'running', draining: false, chat_id: 'chat-1', task: { task_id: 'task-1', type: 'AWAIT_RESPONSE', chat_id: 'chat-1', project_id: '/home/op/alpha', request_id: 'req-1', root_request_id: 'req-root', conversation_id: 'conv-1', status: 'RUNNING', attempt: 2, max_attempts: 30, assigned_worker: '', keep_flowing: false, lease_expires_at: '2026-09-11T10:01:00Z', not_before: '2026-09-11T10:00:00Z', last_error: '', created_at: '2026-09-11T09:55:00Z', updated_at: '2026-09-11T10:00:00Z' }, last_claim_at: '2026-09-11T10:00:00Z', loop_active: true, error: '', browser: { available: true, web_contents_id: 11, os_process_id: 2011, url: 'https://chatgpt.com/c/worker', title: 'Chat worker', loading: false }, memory: { available: true, rss_bytes: 340 * 1024 * 1024, os_process_id: 2011, shared_process: false } },
    ],
  }
}

function agentsBridge(state: DesktopAgentRuntimeState = runtime()) {
  return {
    state: vi.fn(async () => state),
    setSupervisorCount: vi.fn(async (count: number) => runtime(count, count)),
    setWorkerCount: vi.fn(async (count: number) => runtime(count)),
    setPolicies: vi.fn(async (policies: { auto_scale?: boolean; auto_scale_max_supervisors?: number; auto_scale_max_workers?: number; keep_flowing_global?: boolean; rate_limit_cooldown_minutes?: number }) => ({ ...state, policies: { ...state.policies, ...policies } })),
    setWorkerKeepFlowing: vi.fn(async (agentId: string, enabled: boolean) => ({ ...state, agents: state.agents.map((agent) => agent.id === agentId ? { ...agent, keep_flowing: enabled } : agent) })),
    pauseWorkers: vi.fn(async (pausedUntil?: string, taskTypes: string[] = []) => ({ ...state, worker_pause: { paused: true, paused_until: pausedUntil || '', task_types: taskTypes } })),
    resumeWorkers: vi.fn(async () => ({ ...state, worker_pause: { paused: false, paused_until: '' } })),
    pauseProvider: vi.fn(async (pausedUntil?: string) => ({ ...state, provider: { ...state.provider, paused: true, paused_until: pausedUntil || '' } })),
    resumeProvider: vi.fn(async () => runtime()),
    snapshot: vi.fn(async (agentId: string) => ({ agentId, dataUrl: 'data:image/png;base64,AA==', capturedAt: '2026-09-10T23:00:00Z' })),
    openMonitor: vi.fn(async (agentId: string) => ({ ok: true, agentId })),
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

  it('preserves IPC error messages even when they come from another realm', async () => {
    const agents = agentsBridge()
    agents.state = vi.fn(async () => Promise.reject({ message: 'Object has been destroyed' }))
    const onError = vi.fn()
    window.wharnessDesktop = { agents } as unknown as WharnessDesktopBridge

    render(<AgentRuntimeDrawer projectPath="/home/op/alpha" onClose={() => undefined} onError={onError} />)

    await waitFor(() => expect(onError).toHaveBeenCalledWith('Object has been destroyed'))
  })

  it('lists runtime instances, exposes task details and scales workers', async () => {
    const agents = agentsBridge()
    window.wharnessDesktop = { agents } as unknown as WharnessDesktopBridge

    render(<AgentRuntimeDrawer projectPath="/home/op/alpha" onClose={() => undefined} />)
    expect(await screen.findByText('Worker 1')).toBeTruthy()
    fireEvent.click(screen.getByText('Worker 1'))
    expect(screen.getByText(/AWAIT_RESPONSE · task-1/)).toBeTruthy()
    expect(screen.getByText('RUNNING', { selector: '.agent-runtime-detail dd' })).toBeTruthy()
    expect(screen.getByText('WebContents #11 · PID 2011')).toBeTruthy()
    expect(screen.getByText('340 MiB', { selector: '.agent-runtime-detail dd' })).toBeTruthy()
    fireEvent.click(screen.getByRole('tab', { name: /Runtime/ }))
    expect(screen.getByText('Total Workers').parentElement?.textContent).toContain('340 MiB')
    expect(screen.getByText('Total Supervisores').parentElement?.textContent).toContain('220 MiB')
    expect(screen.getByText('Total Agent').parentElement?.textContent).toContain('560 MiB')
    expect(screen.getByText('Desktop').parentElement?.textContent).toContain('420 MiB')
    expect(screen.getByText('Total', { selector: '.agent-runtime-memory-summary small' }).parentElement?.textContent).toContain('980 MiB')

    fireEvent.click(screen.getByRole('tab', { name: /Políticas/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Diminuir workers' }))
    await waitFor(() => expect(agents.setWorkerCount).toHaveBeenCalledWith(5))
  })

  it('keeps a Worker pinned to an Orchestrator task on that task between rounds', async () => {
    const state = runtime()
    state.agents = [
      { ...state.agents[1], id: 'worker-1', label: 'Worker 1', role: 'worker', status: 'claimed', occupied: true, pinned_task_id: 'otk_20260928T004456_8f3615e75b5eb52c', chat_id: 'otk_20260928T004456_8f3615e75b5eb52c', task: undefined },
    ]
    window.wharnessDesktop = { agents: agentsBridge(state) } as unknown as WharnessDesktopBridge

    const { container } = render(<AgentRuntimeDrawer projectPath="/home/op/alpha" onClose={() => undefined} />)

    expect(await screen.findByText('Worker · Preso à tarefa')).toBeTruthy()
    expect(container.querySelector('.agent-runtime-list > button.state-waiting')).toBeTruthy()
    expect(screen.queryByText('Worker · Ocioso')).toBeNull()
  })

  it('makes idle, writing, listening, waiting and chat-without-jobs states distinct at a glance', async () => {
    const state = runtime()
    state.agents = [
      { ...state.agents[1], id: 'worker-idle', label: 'Worker idle', role: 'worker', status: 'idle', chat_id: '', task: undefined },
      { ...state.agents[0], id: 'supervisor-empty', label: 'Supervisor empty', status: 'idle', chat_id: 'chat-human', task: undefined },
      { ...state.agents[0], id: 'supervisor-writing', label: 'Supervisor writing', status: 'running', chat_id: 'chat-human', task: { ...state.agents[3].task!, type: 'BOT_WRITE', status: 'RUNNING' } },
      { ...state.agents[3], id: 'worker-listening', label: 'Worker listening', status: 'running', task: { ...state.agents[3].task!, type: 'AWAIT_RESPONSE', status: 'RUNNING' } },
      { ...state.agents[3], id: 'worker-waiting', label: 'Worker waiting', status: 'claimed', task: { ...state.agents[3].task!, type: 'DELETE_BUNDLE', status: 'WAITING' } },
    ]
    window.wharnessDesktop = { agents: agentsBridge(state) } as unknown as WharnessDesktopBridge

    const { container } = render(<AgentRuntimeDrawer projectPath="/home/op/alpha" onClose={() => undefined} />)

    expect(await screen.findByText('Worker · Ocioso')).toBeTruthy()
    expect(screen.getByText('Supervisor · Chat sem jobs')).toBeTruthy()
    expect(screen.getByText('Supervisor · A escrever')).toBeTruthy()
    expect(screen.getByText('Worker · A escutar')).toBeTruthy()
    expect(screen.getByText('Worker · A aguardar')).toBeTruthy()
    for (const stateName of ['idle', 'chat-empty', 'writing', 'listening', 'waiting']) {
      expect(container.querySelector(`.agent-runtime-list > button.state-${stateName}`)).toBeTruthy()
    }
  })

  it('shows the phase a Worker reports instead of inferring it from the task type', async () => {
    const state = runtime()
    const plan = { ...state.agents[3].task!, type: 'ORCHESTRATOR_PLAN', status: 'RUNNING' }
    const since = '2026-09-28T01:44:13.000Z'
    state.agents = [
      { ...state.agents[3], id: 'worker-queued', label: 'Worker queued', status: 'running', task: plan, activity: { phase: 'waiting_turn', since, task_id: plan.task_id } },
      { ...state.agents[3], id: 'worker-uploading', label: 'Worker uploading', status: 'running', task: plan, activity: { phase: 'uploading', since, task_id: plan.task_id } },
      { ...state.agents[3], id: 'worker-processing', label: 'Worker processing', status: 'running', task: plan, activity: { phase: 'processing', since, task_id: plan.task_id } },
      { ...state.agents[3], id: 'worker-downloading', label: 'Worker downloading', status: 'running', task: plan, activity: { phase: 'downloading', since, task_id: plan.task_id } },
    ]
    window.wharnessDesktop = { agents: agentsBridge(state) } as unknown as WharnessDesktopBridge

    render(<AgentRuntimeDrawer projectPath="/home/op/alpha" onClose={() => undefined} />)

    // Without the phase, every one of these read "A escrever".
    expect(await screen.findByText('Worker · Na fila de envio')).toBeTruthy()
    expect(screen.getByText('Worker · A carregar ZIP')).toBeTruthy()
    expect(screen.getByText('Worker · GPT a processar')).toBeTruthy()
    expect(screen.getByText('Worker · A descarregar resposta')).toBeTruthy()

    // Every colour a row can take has a legend entry.
    const legend = screen.getByLabelText('Legenda dos estados dos agentes')
    for (const stateName of ['idle', 'waiting', 'loading', 'working', 'writing', 'listening', 'chat-empty', 'paused', 'error', 'stopped', 'draining']) {
      expect(legend.querySelector(`.agent-runtime-dot.state-${stateName}`)).toBeTruthy()
    }
    expect(legend.textContent).toContain('GPT a processar')
    expect(legend.textContent).toContain('A preparar / validar')
  })

  it('groups policy controls into readable operational sections', async () => {
    window.wharnessDesktop = { agents: agentsBridge() } as unknown as WharnessDesktopBridge

    render(<AgentRuntimeDrawer projectPath="/home/op/alpha" onClose={() => undefined} />)
    fireEvent.click(await screen.findByRole('tab', { name: /Políticas/ }))

    const provider = screen.getByRole('region', { name: 'Proteção do provedor' })
    const capacity = screen.getByRole('region', { name: 'Capacidade dos agentes' })
    const automation = screen.getByRole('region', { name: 'Automação dos Workers' })

    expect(provider.querySelectorAll('.agent-runtime-policy-wide')).toHaveLength(2)
    expect(capacity.querySelectorAll('.agent-runtime-scale-card')).toHaveLength(4)
    expect(automation.querySelectorAll('.agent-runtime-scale-card')).toHaveLength(2)
  })

  it('toggles Auto scale and global Keep flowing policies', async () => {
    const agents = agentsBridge()
    window.wharnessDesktop = { agents } as unknown as WharnessDesktopBridge

    render(<AgentRuntimeDrawer projectPath="/home/op/alpha" onClose={() => undefined} />)
    fireEvent.click(await screen.findByRole('tab', { name: /Políticas/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Inativo' }))
    await waitFor(() => expect(agents.setPolicies).toHaveBeenCalledWith({ auto_scale: true }))
    fireEvent.click(screen.getByRole('button', { name: 'Global inativo' }))
    await waitFor(() => expect(agents.setPolicies).toHaveBeenCalledWith({ keep_flowing_global: true }))
  })

  it('configures the Auto scale ceiling independently from the hard maximum', async () => {
    const agents = agentsBridge()
    window.wharnessDesktop = { agents } as unknown as WharnessDesktopBridge

    render(<AgentRuntimeDrawer projectPath="/home/op/alpha" onClose={() => undefined} />)
    fireEvent.click(await screen.findByRole('tab', { name: /Políticas/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Diminuir teto Auto scale' }))
    await waitFor(() => expect(agents.setPolicies).toHaveBeenCalledWith({ auto_scale_max_workers: 5 }))
  })

  it('persists the automatic rate-limit suspension from the Policies tab', async () => {
    const agents = agentsBridge()
    window.wharnessDesktop = { agents } as unknown as WharnessDesktopBridge

    render(<AgentRuntimeDrawer projectPath="/home/op/alpha" onClose={() => undefined} />)
    fireEvent.click(await screen.findByRole('tab', { name: /Políticas/ }))
    const input = screen.getByRole('spinbutton', { name: 'Minutos de suspensão automática por rate limit' })
    expect((input as HTMLInputElement).valueAsNumber).toBe(7.5)
    fireEvent.change(input, { target: { value: '12.5' } })
    fireEvent.blur(input)
    await waitFor(() => expect(agents.setPolicies).toHaveBeenCalledWith({ rate_limit_cooldown_minutes: 12.5 }))
  })

  it('configures Keep flowing for one Worker when global mode is disabled', async () => {
    const agents = agentsBridge()
    window.wharnessDesktop = { agents } as unknown as WharnessDesktopBridge

    render(<AgentRuntimeDrawer projectPath="/home/op/alpha" onClose={() => undefined} />)
    fireEvent.click(await screen.findByText('Worker 1'))
    fireEvent.click(screen.getByRole('button', { name: 'Keep flowing · inativo' }))
    await waitFor(() => expect(agents.setWorkerKeepFlowing).toHaveBeenCalledWith('worker-1', true))
  })

  it('renders runtime actions as icon-only controls with accessible names', async () => {
    window.wharnessDesktop = { agents: agentsBridge() } as unknown as WharnessDesktopBridge

    render(<AgentRuntimeDrawer projectPath="/home/op/alpha" onClose={() => undefined} />)
    fireEvent.click(await screen.findByText('Worker 1'))

    for (const name of ['Keep flowing · inativo', 'Seguir (flow)', 'Interagir aqui', 'Capturar imagem']) {
      const button = screen.getByRole('button', { name })
      expect(button.textContent).toBe('')
      expect(button.querySelector('svg')).toBeTruthy()
      expect(button.getAttribute('title')).toBeTruthy()
    }
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

    const { container } = render(<AgentRuntimeDrawer projectPath="/home/op/alpha" onClose={() => undefined} />)
    fireEvent.click(await screen.findByRole('tab', { name: /Runtime/ }))
    expect(screen.getByText('Mais antiga por executar: —')).toBeTruthy()
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

    const { container } = render(<AgentRuntimeDrawer projectPath="/home/op/alpha" onClose={() => undefined} />)
    fireEvent.click(await screen.findByRole('tab', { name: /Runtime/ }))
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

    const { container } = render(<AgentRuntimeDrawer projectPath="/home/op/alpha" onClose={() => undefined} />)
    fireEvent.click(await screen.findByRole('tab', { name: /Runtime/ }))
    const rows = [...container.querySelectorAll('.agent-runtime-queue')].map((row) => row.textContent)
    expect(rows).toContain('2 PENDING1 RUNNING')
    expect(rows.join(' ')).not.toMatch(/tarefas/)
    expect(rows.join(' ')).not.toMatch(/DONE|FAILED|CANCELLED|ATTENTION/)
  })

  it('shows a durable leased response observation as listening instead of idle', async () => {
    const state = runtime()
    const worker = state.agents.find((agent) => agent.id === 'worker-1')!
    worker.status = 'claimed'
    if (worker.task) worker.task.status = 'LEASED'
    window.wharnessDesktop = { agents: agentsBridge(state) } as unknown as WharnessDesktopBridge

    render(<AgentRuntimeDrawer projectPath="/home/op/alpha" onClose={() => undefined} />)
    expect(await screen.findByText('Worker · A escutar')).toBeTruthy()
  })

  it('opens and closes live interaction for a Worker browser', async () => {
    const state = runtime()
    const worker = state.agents.find((agent) => agent.id === 'worker-1')!
    worker.status = 'idle'
    worker.task = undefined
    const agents = agentsBridge(state)
    window.wharnessDesktop = { agents } as unknown as WharnessDesktopBridge

    render(<AgentRuntimeDrawer projectPath="/home/op/alpha" onClose={() => undefined} />)
    fireEvent.click(await screen.findByText('Worker 1'))
    fireEvent.click(screen.getByRole('button', { name: /Interagir aqui/ }))
    await waitFor(() => expect(agents.openInteraction).toHaveBeenCalledWith('worker-1', expect.objectContaining({ width: 1, height: 1 })))
    expect(screen.getByLabelText('Navegador interativo de Worker 1')).toBeTruthy()

    const blocker = document.createElement('div')
    blocker.setAttribute('data-chatgpt-overlay-blocker', 'true')
    document.body.appendChild(blocker)
    await waitFor(() => expect(agents.closeInteraction).toHaveBeenCalledWith('worker-1'))

    const openedBeforeRestore = agents.openInteraction.mock.calls.length
    blocker.remove()
    await waitFor(() => expect(agents.openInteraction.mock.calls.length).toBeGreaterThan(openedBeforeRestore))

    fireEvent.click(screen.getByRole('button', { name: /Terminar interação/ }))
    await waitFor(() => expect(agents.closeInteraction).toHaveBeenCalledWith('worker-1'))
  })

  it('opens the full-size Worker window when interacting during an active task', async () => {
    const agents = agentsBridge()
    const listener = vi.fn()
    window.wharnessDesktop = { agents } as unknown as WharnessDesktopBridge
    window.addEventListener('wharnex:agent-follow', listener)
    render(<AgentRuntimeDrawer projectPath="/home/op/alpha" onClose={() => undefined} />)
    fireEvent.click(await screen.findByText('Worker 1'))
    fireEvent.click(screen.getByRole('button', { name: /Interagir aqui/ }))
    await waitFor(() => expect(agents.openMonitor).toHaveBeenCalledWith('worker-1'))
    expect(agents.openInteraction).not.toHaveBeenCalled()
    await waitFor(() => expect(listener).toHaveBeenCalledTimes(1))
    window.removeEventListener('wharnex:agent-follow', listener)
  })

  it('closes an idle inline interaction before following its Worker', async () => {
    const state = runtime()
    const worker = state.agents.find((agent) => agent.id === 'worker-1')!
    worker.status = 'idle'
    worker.task = undefined
    const agents = agentsBridge(state)
    const steps: string[] = []
    agents.closeInteraction.mockImplementation(async () => { steps.push('close'); return { ok: true, agentId: 'worker-1', closed: true } })
    agents.openMonitor.mockImplementation(async () => { steps.push('open'); return { ok: true, agentId: 'worker-1' } })
    window.wharnessDesktop = { agents } as unknown as WharnessDesktopBridge
    render(<AgentRuntimeDrawer projectPath="/home/op/alpha" onClose={() => undefined} />)
    fireEvent.click(await screen.findByText('Worker 1'))
    fireEvent.click(screen.getByRole('button', { name: /Interagir aqui/ }))
    await waitFor(() => expect(agents.openInteraction).toHaveBeenCalled())
    fireEvent.click(screen.getByRole('button', { name: /Seguir \(flow\)/ }))
    await waitFor(() => expect(agents.openMonitor).toHaveBeenCalledWith('worker-1'))
    expect(steps.indexOf('close')).toBeLessThan(steps.indexOf('open'))
  })


  it('moves a Worker into the main Engine flow when Seguir is requested', async () => {
    const agents = agentsBridge()
    const onClose = vi.fn()
    const listener = vi.fn()
    window.wharnessDesktop = { agents } as unknown as WharnessDesktopBridge
    window.addEventListener('wharnex:agent-follow', listener)

    render(<AgentRuntimeDrawer projectPath="/home/op/alpha" onClose={onClose} />)
    fireEvent.click(await screen.findByText('Worker 1'))
    fireEvent.click(screen.getByRole('button', { name: /Seguir \(flow\)/ }))

    await waitFor(() => expect(listener).toHaveBeenCalledTimes(1))
    expect(agents.openMonitor).toHaveBeenCalledWith('worker-1')
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

    render(<AgentRuntimeDrawer projectPath="/home/op/alpha" onClose={() => undefined} />)
    const button = await screen.findByRole('button', { name: /Capturar imagem/ })
    expect(button).not.toHaveProperty('disabled', true)
    fireEvent.click(button)
    await waitFor(() => expect(agents.snapshot).toHaveBeenCalledWith('supervisor-1'))
    expect(await screen.findByRole('img', { name: /Captura do navegador de Supervisor 1/ })).toBeTruthy()
  })


  it('moves durable Worker suspension from Agents into the Policies tab', async () => {
    const agents = agentsBridge()
    window.wharnessDesktop = { agents } as unknown as WharnessDesktopBridge

    render(<AgentRuntimeDrawer projectPath="/home/op/alpha" onClose={() => undefined} />)
    await screen.findByText('Worker 1')
    expect(screen.queryByLabelText('Âmbito da suspensão dos Workers')).toBeNull()

    fireEvent.click(screen.getByRole('tab', { name: /Políticas/ }))
    expect(await screen.findByText('Cooldown durável dos Workers')).toBeTruthy()
    fireEvent.change(screen.getByLabelText('Minutos até retoma dos Workers'), { target: { value: '30' } })
    fireEvent.click(screen.getByRole('button', { name: 'Suspender Workers' }))

    await waitFor(() => expect(agents.pauseWorkers).toHaveBeenCalledTimes(1))
    const pausedUntil = String(agents.pauseWorkers.mock.calls[0][0] || '')
    expect(Date.parse(pausedUntil)).toBeGreaterThan(Date.now() + 29 * 60_000)
    expect(Date.parse(pausedUntil)).toBeLessThan(Date.now() + 31 * 60_000)
    expect(agents.pauseProvider).not.toHaveBeenCalled()
  })

  it('supports manual Worker suspension and explicit release without pausing Supervisors', async () => {
    const agents = agentsBridge()
    window.wharnessDesktop = { agents } as unknown as WharnessDesktopBridge

    const { unmount } = render(<AgentRuntimeDrawer projectPath="/home/op/alpha" onClose={() => undefined} />)
    fireEvent.click(await screen.findByRole('tab', { name: /Políticas/ }))
    fireEvent.change(screen.getByLabelText('Modo de retoma dos Workers'), { target: { value: 'manual' } })
    fireEvent.click(screen.getByRole('button', { name: 'Suspender Workers' }))
    await waitFor(() => expect(agents.pauseWorkers).toHaveBeenCalledWith(undefined, []))
    unmount()

    const paused = runtime()
    paused.worker_pause = { paused: true, paused_until: '' }
    paused.policies = { ...paused.policies, workers_suspended: true, workers_suspended_until: '' }
    paused.agents = paused.agents.map((agent) => agent.role === 'worker' ? { ...agent, suspended: true, status: 'idle', task: undefined } : agent)
    const pausedAgents = agentsBridge(paused)
    window.wharnessDesktop = { agents: pausedAgents } as unknown as WharnessDesktopBridge
    render(<AgentRuntimeDrawer projectPath="/home/op/alpha" onClose={() => undefined} />)

    expect(await screen.findByText('Worker · Suspenso')).toBeTruthy()
    expect(screen.getByText('Supervisor · Chat sem jobs')).toBeTruthy()
    fireEvent.click(screen.getByRole('tab', { name: /Políticas/ }))
    expect(await screen.findByText('Todos os tipos suspensos · aguardam liberação manual')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Retomar Workers' }))
    await waitFor(() => expect(pausedAgents.resumeWorkers).toHaveBeenCalledTimes(1))
    expect(pausedAgents.resumeProvider).not.toHaveBeenCalled()
  })

  it('releases an active rate-limit suspension only after confirmation', async () => {
    const limited = runtime()
    limited.provider = { ...limited.provider, paused: true, paused_until: '2026-09-28T02:30:00.000Z' }
    const agents = agentsBridge(limited)
    window.wharnessDesktop = { agents } as unknown as WharnessDesktopBridge
    render(<AgentRuntimeDrawer projectPath="/home/op/alpha" onClose={() => undefined} />)
    fireEvent.click(await screen.findByRole('tab', { name: /Políticas/ }))

    dialog.confirm.mockResolvedValueOnce(false)
    fireEvent.click(screen.getByRole('button', { name: 'Libertar suspensão por rate limit' }))
    await waitFor(() => expect(dialog.confirm).toHaveBeenCalledTimes(1))
    expect(agents.resumeProvider).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'Libertar suspensão por rate limit' }))
    await waitFor(() => expect(agents.resumeProvider).toHaveBeenCalledTimes(1))
  })

  it('suspends only the selected Worker task types', async () => {
    const agents = agentsBridge()
    window.wharnessDesktop = { agents } as unknown as WharnessDesktopBridge

    render(<AgentRuntimeDrawer projectPath="/home/op/alpha" onClose={() => undefined} />)
    fireEvent.click(await screen.findByRole('tab', { name: /Políticas/ }))
    fireEvent.change(screen.getByLabelText('Âmbito da suspensão dos Workers'), { target: { value: 'types' } })
    expect(screen.getByText('Task')).toBeTruthy()
    expect(screen.getByRole('region', { name: 'Auxiliar' })).toBeTruthy()
    expect(screen.getByRole('region', { name: 'Funcional' })).toBeTruthy()
    fireEvent.click(screen.getByRole('checkbox', { name: /Renomear chat/ }))
    fireEvent.click(screen.getByRole('checkbox', { name: /Classificar TODO/ }))
    fireEvent.change(screen.getByLabelText('Modo de retoma dos Workers'), { target: { value: 'manual' } })
    fireEvent.click(screen.getByRole('button', { name: 'Suspender Workers' }))

    await waitFor(() => expect(agents.pauseWorkers).toHaveBeenCalledWith(undefined, ['RENAME_CHAT', 'TODO_CLASSIFY']))
  })

  it('selects an entire auxiliary branch from the Worker task tree', async () => {
    const agents = agentsBridge()
    window.wharnessDesktop = { agents } as unknown as WharnessDesktopBridge

    render(<AgentRuntimeDrawer projectPath="/home/op/alpha" onClose={() => undefined} />)
    fireEvent.click(await screen.findByRole('tab', { name: /Políticas/ }))
    fireEvent.change(screen.getByLabelText('Âmbito da suspensão dos Workers'), { target: { value: 'types' } })
    fireEvent.click(screen.getByRole('checkbox', { name: 'Suspender grupo Auxiliar' }))
    fireEvent.change(screen.getByLabelText('Modo de retoma dos Workers'), { target: { value: 'manual' } })
    fireEvent.click(screen.getByRole('button', { name: 'Suspender Workers' }))

    await waitFor(() => expect(agents.pauseWorkers).toHaveBeenCalledWith(undefined, [
      'ORGANIZE_CHAT', 'RENAME_CHAT', 'ARCHIVE_CHAT', 'DELETE_CHAT', 'DELETE_TEMP_CHAT',
      'DELETE_BUNDLE', 'TITLE_DISCOVER', 'TITLE_GENERATE_TEMP', 'TITLE_AWAIT',
    ]))
  })

  it('keeps automatic provider rate-limit state separate from manual Worker cooldown', async () => {
    const state = runtime()
    state.provider = { ...state.provider, paused: true, paused_until: '2026-09-11T10:30:00Z', reason: 'HTTP 429' }
    const agents = agentsBridge(state)
    window.wharnessDesktop = { agents } as unknown as WharnessDesktopBridge

    render(<AgentRuntimeDrawer projectPath="/home/op/alpha" onClose={() => undefined} />)
    fireEvent.click(await screen.findByRole('tab', { name: /Políticas/ }))

    expect(await screen.findByText(/Rate limit ativo/)).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Suspender Workers' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Retomar Workers' })).toBeNull()
  })

  // The pool is shared across every open project. Without naming the owning
  // project, this panel reports "0 available" beside cards that all look idle
  // to whoever reads it from the project that is not running.
  it('marks an agent occupied with another project and names that project', async () => {
    window.wharnessDesktop = { agents: agentsBridge() } as unknown as WharnessDesktopBridge

    render(<AgentRuntimeDrawer projectPath="/home/op/beta" onClose={() => undefined} />)

    expect(await screen.findByText('Outro projeto · alpha')).toBeTruthy()
    const elsewhere = screen.getByText('noutro projeto').previousSibling
    expect(elsewhere?.textContent).toBe('1')
  })

  it('does not mark an agent running this project’s own work', async () => {
    window.wharnessDesktop = { agents: agentsBridge() } as unknown as WharnessDesktopBridge

    render(<AgentRuntimeDrawer projectPath="/home/op/alpha" onClose={() => undefined} />)

    expect(await screen.findByText('Worker 1')).toBeTruthy()
    expect(screen.queryByText(/Outro projeto ·/)).toBeNull()
    const elsewhere = screen.getByText('noutro projeto').previousSibling
    expect(elsewhere?.textContent).toBe('0')
  })

  // The operator reading this panel is looking for the conversation, not for
  // the opaque string that addresses it — and having found it, wants to be in
  // it rather than to go hunting for it in the chat list.
  it('names the chat a slot is bound to and opens it', async () => {
    const onGoToChat = vi.fn()
    window.wharnessDesktop = { agents: agentsBridge() } as unknown as WharnessDesktopBridge

    render(<AgentRuntimeDrawer projectPath="/home/op/alpha" chats={[{ id: 'chat-human', title: 'Refatorar o parser', sessionId: 'sess-1' }]} onGoToChat={onGoToChat} onClose={() => undefined} />)

    // supervisor-1 is the panel's default selection, so its detail is already open.
    expect(await screen.findByText('Refatorar o parser')).toBeTruthy()
    fireEvent.click(screen.getByLabelText('Abrir o chat Refatorar o parser'))
    expect(onGoToChat).toHaveBeenCalledWith('chat-human', 'sess-1')
  })

  // A slot occupied by another project stays described by that project alone:
  // the shared pool may expose which project is busy, never its conversation.
  it('keeps a foreign slot’s conversation unnamed and offers its project instead', async () => {
    const onFocusProject = vi.fn()
    window.wharnessDesktop = { agents: agentsBridge() } as unknown as WharnessDesktopBridge

    render(<AgentRuntimeDrawer projectPath="/home/op/beta" chats={[{ id: 'chat-1', title: 'Não deve aparecer', sessionId: 'sess-x' }]} onFocusProject={onFocusProject} onClose={() => undefined} />)

    fireEvent.click(await screen.findByText('Worker 1'))
    expect(screen.queryByText('Não deve aparecer')).toBeNull()
    expect(screen.getByText('Conversa do projeto alpha')).toBeTruthy()
    fireEvent.click(screen.getByLabelText('Trazer o projeto alpha para foco'))
    expect(onFocusProject).toHaveBeenCalledWith('/home/op/alpha')
  })

  // A Supervisor mid-request hands its lease back between observations. Reading
  // the lease alone painted it as available on every cycle, which is what made
  // its card flicker for the whole length of an apply.
  it('reports a held Supervisor as occupied with its task between observations', async () => {
    const state = runtime()
    const task = { task_id: 'task-9', type: 'AWAIT_RESPONSE', chat_id: 'chat-human', project_id: '/home/op/alpha', request_id: 'req-9', root_request_id: 'req-9', conversation_id: 'conv-9', status: 'LEASED', attempt: 1, max_attempts: 30, assigned_worker: '', keep_flowing: false, lease_expires_at: '', not_before: '', last_error: '', created_at: '2026-09-11T09:55:00Z', updated_at: '2026-09-11T10:00:00Z' }
    state.agents[0] = { ...state.agents[0], status: 'claimed', occupied: true, project_id: '/home/op/alpha', binding_hold: 'bundle-delivery', last_task: task }
    window.wharnessDesktop = { agents: agentsBridge(state) } as unknown as WharnessDesktopBridge

    render(<AgentRuntimeDrawer projectPath="/home/op/alpha" onClose={() => undefined} />)

    expect((await screen.findByText(/AWAIT_RESPONSE · task-9/)).textContent).not.toMatch(/última/)
    expect(screen.getByText('Retido · bundle-delivery')).toBeTruthy()
  })
})
