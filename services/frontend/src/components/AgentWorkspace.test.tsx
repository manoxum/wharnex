import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { api } from '../lib/api'
import type { HarnessEvent, Session } from '../types'
import { AgentWorkspace } from './AgentWorkspace'

// Monaco has no usable DOM/worker environment under jsdom; every other test
// in this file never mounts an editor, so the real CodeEditor is not exercised
// here — only the read-only preview modal's own wiring is under test.
vi.mock('./CodeEditor', () => ({ CodeEditor: ({ path }: { path: string }) => <div data-testid="code-editor-stub">{path}</div> }))

function session(): Session {
  return {
    id: 'ses-agent', project_path: '/workspace/wharness', state: 'planned', execution_mode: 'protected', automation_mode: 'auto', created_at: new Date().toISOString(),
    context: { id: 'ctx', manifest: { id: 'ctx', project_root: '/workspace/wharness', sha256: 'abcdef123456', files: [], excluded: [], text_truncated: false } },
    plan: { protocol: 'harness.execution/v1', plan_id: 'plan-agent', request_id: 'req-agent', status: 'ready', summary: 'Atualizar UI', risk: 'low', requires_approval: false, operations: [], verification: [] },
    policy: { allowed: true, requires_approval: false, risk: 'low', reasons: [] },
  }
}

function props(current = session(), human: { notice?: DesktopChatGPTHumanAction; nonce?: number; onAction?: () => void } = {}, busy = false) {
  const onExecute = vi.fn(async () => undefined)
  const onRetryDependencyNetwork = vi.fn(async () => undefined)
  const onRetryHostDependencyRepair = vi.fn(async () => undefined)
  const onApply = vi.fn(async () => undefined)
  const onRestore = vi.fn(async () => undefined)
  const onDelete = vi.fn(async () => undefined)
  const onOpenFile = vi.fn()
  const onExportChat = vi.fn(async () => undefined)
  const onSelectChat = vi.fn(async () => undefined)
  return {
    onExecute, onRetryDependencyNetwork, onRetryHostDependencyRepair, onApply, onRestore, onDelete, onOpenFile, onExportChat, onSelectChat,
    element: <AgentWorkspace
      session={current}
      busy={busy}
      chatgptHumanAction={human.notice}
      chatgptAttentionNonce={human.nonce}
      onChatGPTHumanAction={human.onAction}
      onOpenFile={onOpenFile}
      onError={vi.fn()}
      onExportChat={onExportChat}
      chatProps={{
        session: current, items: [], chats: [{ id: 'chat-1', title: 'Principal', sessionId: current.id, createdAt: '2026-09-04T10:00:00.000Z', updatedAt: '2026-09-04T10:00:00.000Z' }, { id: 'chat-2', title: 'Paralelo', sessionId: 'ses-parallel', createdAt: '2026-09-04T09:00:00.000Z', updatedAt: '2026-09-04T09:00:00.000Z' }],
        archivedChats: [{ id: 'arch-1', title: 'Diagnóstico antigo', sessionId: 'ses-old', createdAt: '2026-09-03T10:00:00.000Z', updatedAt: '2026-09-03T11:00:00.000Z' }], activeChatId: 'chat-1', busy,
        onSend: async () => undefined, onNewChat: async () => undefined, onSelectChat, onArchiveChat: async () => undefined, onRestoreChat: onRestore, onDeleteArchivedChat: onDelete,
      }}
      inspectorProps={{
        config: { planner: 'openai', sandbox: 'docker', model: 'test', api_configured: true, chatgpt_web_embed: false }, session: current, events: [], manualPrompt: '', busy,
        onChatGPTURL: () => true, onExecute, onRetryDependencyNetwork, onRetryHostDependencyRepair, onApply, onRejectPendingChanges: async () => undefined, onManualPlan: async () => undefined, onPlanFile: async () => '', onBundleFile: async () => '', onSession: () => undefined,
      }}
    />,
  }
}

describe('AgentWorkspace', () => {
  beforeEach(() => {
    localStorage.clear()
    window.history.replaceState({}, '', '/?wharnessWindow=primary')
    vi.spyOn(api, 'bundleQuota').mockResolvedValue({ window_hours: 3, limit: 80, sent: 12, received: 10, total: 22, warning: false, window_start: '2026-09-09T15:00:00Z', window_end: '2026-09-09T18:00:00Z' })
  })
  afterEach(() => {
    vi.restoreAllMocks()
    window.history.replaceState({}, '', '/')
  })

  it('migrates the legacy chat width once and leaves a new desktop window on the default split', () => {
    localStorage.setItem('whx.agent.chat-width', '777')
    const primary = render(props().element)
    expect((primary.container.querySelector('.agent-workspace') as HTMLElement).style.getPropertyValue('--agent-chat-width')).toBe('777px')
    expect(localStorage.getItem('whx.agent.chat-width:primary')).toBe('777')
    expect(localStorage.getItem('whx.agent.chat-width')).toBeNull()
    primary.unmount()

    window.history.replaceState({}, '', '/?wharnessWindow=secondary')
    const secondary = render(props().element)
    expect((secondary.container.querySelector('.agent-workspace') as HTMLElement).style.getPropertyValue('--agent-chat-width')).toBe('')
  })

  it('keeps only compact sent and received bundle counters in embedded Agent chrome', async () => {
    vi.mocked(api.bundleQuota).mockResolvedValueOnce({ window_hours: 3, limit: 80, sent: 24, received: 21, total: 45, warning: false, window_start: '2026-09-09T15:00:00Z', window_end: '2026-09-09T18:00:00Z' })
    const rendered = render(props().element)
    expect(await screen.findByRole('group', { name: 'Bundles: 24 enviados ao ChatGPT e 21 recebidos do ChatGPT.' })).toBeTruthy()
    expect(rendered.container.querySelector('.agent-bundle-counters')?.textContent).toBe('↑24↓21')
    expect(rendered.container.querySelector('.agent-bundle-quota-track')).toBeNull()
    expect(rendered.container.querySelector('.agent-bundle-quota-fill')).toBeNull()
  })

  it('does not turn the Agent counters into a quota warning when the configured sent limit is reached', async () => {
    vi.mocked(api.bundleQuota).mockResolvedValueOnce({ window_hours: 3, limit: 80, sent: 80, received: 76, total: 156, warning: true, window_start: '2026-09-09T15:00:00Z', window_end: '2026-09-09T18:00:00Z' })
    const rendered = render(props().element)
    expect(await screen.findByRole('group', { name: 'Bundles: 80 enviados ao ChatGPT e 76 recebidos do ChatGPT.' })).toBeTruthy()
    expect(rendered.container.querySelector('.agent-bundle-counters')?.textContent).toBe('↑80↓76')
    expect(rendered.container.querySelector('.agent-bundle-quota.warning')).toBeNull()
  })

  it('keeps the chat fixed on the left and uses the right-side tabs for the inspector', () => {
    const view = props()
    const rendered = render(view.element)
    expect(screen.getByRole('navigation', { name: 'Áreas do Agent' })).toBeTruthy()
    expect(screen.queryByText('Agent Inspector')).toBeNull()
    expect(screen.getByText('Contexto isolado')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Chat' })).toBeNull()
    const chatSwitcher = screen.getByRole('navigation', { name: 'Conversas do Harness' })
    const newChat = screen.getByRole('button', { name: 'Novo chat' })
    expect(newChat.textContent).toBe('')
    expect(newChat.querySelector('svg')).toBeTruthy()
    expect(chatSwitcher.className).toContain('agent-chat-switcher')
    expect(chatSwitcher.closest('.agent-commandbar')).toBeNull()
    expect(rendered.container.querySelector('.agent-chat-stage .chat-panel')).toBeTruthy()
    expect(rendered.container.querySelector('.agent-inspector-stage .inspector-panel')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Redimensionar chat e Engine' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Engine' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'ChatGPT' })).toBeTruthy()
    const execute = screen.getByRole('button', { name: 'Executar plano na sandbox' })
    expect(execute.textContent).toBe('')
    fireEvent.click(execute)
    expect(view.onExecute).toHaveBeenCalledWith(false)
    fireEvent.click(screen.getByRole('button', { name: 'Plano' }))
    expect(screen.getByText('Atualizar UI')).toBeTruthy()
  })

  it('restores each chat viewport across the keyed chat panel remount', async () => {
    const base = props()
    const chatAItems = Array.from({ length: 45 }, (_, index) => ({ id: `chat-a-${index + 1}`, role: 'user' as const, text: `chat A mensagem ${index + 1}` }))
    const chatBItems = Array.from({ length: 12 }, (_, index) => ({ id: `chat-b-${index + 1}`, role: 'user' as const, text: `chat B mensagem ${index + 1}` }))
    const workspace = (activeChatId: string, items: typeof chatAItems) => <AgentWorkspace
      {...base.element.props}
      chatProps={{ ...base.element.props.chatProps, activeChatId, items }}
    />
    const rendered = render(workspace('chat-1', chatAItems))

    let stream = rendered.container.querySelector('.chat-stream') as HTMLDivElement
    Object.defineProperty(stream, 'scrollHeight', { configurable: true, value: 2000 })
    Object.defineProperty(stream, 'clientHeight', { configurable: true, value: 400 })
    stream.scrollTop = 0
    fireEvent.scroll(stream)
    await waitFor(() => expect(screen.getByText('chat A mensagem 6')).toBeTruthy())
    stream.scrollTop = 320
    fireEvent.scroll(stream)

    rendered.rerender(workspace('chat-2', chatBItems))
    stream = rendered.container.querySelector('.chat-stream') as HTMLDivElement
    Object.defineProperty(stream, 'scrollHeight', { configurable: true, value: 1200 })
    Object.defineProperty(stream, 'clientHeight', { configurable: true, value: 400 })
    stream.scrollTop = 140
    fireEvent.scroll(stream)

    rendered.rerender(workspace('chat-1', chatAItems))
    stream = rendered.container.querySelector('.chat-stream') as HTMLDivElement
    expect(stream.scrollTop).toBe(320)
    expect(screen.getByText('chat A mensagem 6')).toBeTruthy()

    rendered.rerender(workspace('chat-2', chatBItems))
    stream = rendered.container.querySelector('.chat-stream') as HTMLDivElement
    expect(stream.scrollTop).toBe(140)
  })

  it('keeps the FIFO discoverable even while it is empty and renders queued work in order', () => {
    const empty = props()
    const rendered = render(empty.element)
    fireEvent.click(screen.getByRole('button', { name: 'Fila FIFO de execução' }))
    expect(screen.getByText(/Sem trabalho ativo ou recente/)).toBeTruthy()
    rendered.rerender(<AgentWorkspace
      {...(empty.element.props)}
      executionFIFO={[
        { key: 'one', chatId: 'chat-1', chatTitle: 'Principal', planId: 'plan-one', status: 'running', addedAt: 1 },
        { key: 'two', chatId: 'chat-2', chatTitle: 'Paralelo', planId: 'plan-two', status: 'queued', position: 2, addedAt: 2 },
      ]}
    />)
    expect(screen.getByText('plan-one')).toBeTruthy()
    expect(screen.getByText('plan-two')).toBeTruthy()
    expect(screen.getByText('#02')).toBeTruthy()
    expect(screen.getAllByText('Em execução').length).toBeGreaterThan(0)
    expect(screen.getByText('Na fila')).toBeTruthy()
  })

  it('exposes the per-project execution concurrency next to the queue it governs', async () => {
    vi.spyOn(api, 'executionConcurrency').mockResolvedValue({ concurrency: 1, max: 8 })
    const update = vi.spyOn(api, 'updateExecutionConcurrency').mockResolvedValue({ concurrency: 3, max: 8 })
    render(props().element)
    fireEvent.click(screen.getByRole('button', { name: 'Fila FIFO de execução' }))
    const input = await screen.findByLabelText('Execuções simultâneas por projeto')
    expect(input.tagName).toBe('SELECT')
    expect((input as HTMLSelectElement).value).toBe('1')
    fireEvent.change(input, { target: { value: '3' } })
    await waitFor(() => expect(update).toHaveBeenCalledWith(3))
    await waitFor(() => expect((screen.getByLabelText('Execuções simultâneas por projeto') as HTMLSelectElement).value).toBe('3'))
  })

  it('keeps the execution queue usable when the concurrency limit cannot be read', async () => {
    vi.spyOn(api, 'executionConcurrency').mockRejectedValue(new Error('backend unavailable'))
    render(props().element)
    fireEvent.click(screen.getByRole('button', { name: 'Fila FIFO de execução' }))
    expect(screen.getByText(/Sem trabalho ativo ou recente/)).toBeTruthy()
    await waitFor(() => expect(screen.queryByLabelText('Execuções simultâneas por projeto')).toBeNull())
  })

  it('does not expose Apply or Reject from stale execution success without pending host changes', () => {
    const stale = session()
    stale.state = 'verified'
    stale.last_execution = { plan_id: 'plan-agent', success: true, started_at: '2026-09-05T10:00:00.000Z', completed_at: '2026-09-05T10:00:01.000Z', commands: [] }
    render(props(stale).element)
    expect(screen.queryByRole('button', { name: /Aplicar alterações verificadas no host/ })).toBeNull()
    expect(screen.queryByRole('button', { name: /Rejeitar alterações verificadas/ })).toBeNull()
  })

  it('keeps verified host Apply available after opening its alert and highlights Plano', () => {
    const ready = session()
    ready.state = 'verified'
    ready.pending_host_changes = [{
      plan: ready.plan!,
      execution: { plan_id: 'plan-agent', success: true, started_at: '2026-09-07T10:00:00.000Z', completed_at: '2026-09-07T10:00:01.000Z', commands: [] },
      verified_at: '2026-09-07T10:00:01.000Z',
    }]
    const view = props(ready)
    render(<AgentWorkspace {...view.element.props} attentionSessions={{ 'chat-1': ready }} />)
    expect(screen.getByRole('button', { name: 'Aplicar alterações verificadas no host' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Plano' }).className).toContain('attention-success')
    fireEvent.click(screen.getByRole('button', { name: /Centro de notificações/ }))
    expect(screen.getByRole('dialog', { name: 'Alertas ativos' })).toBeTruthy()
    const apply = screen.getByRole('button', { name: 'Aplicar no host' })
    fireEvent.click(apply)
    expect(view.onApply).toHaveBeenCalledTimes(1)
  })

  it('opens a compact alert popover first, then the full alert panel', async () => {
    const current = session()
    const parallel = session()
    parallel.id = 'ses-parallel'
    parallel.state = 'verified'
    parallel.pending_host_changes = [{
      plan: { ...parallel.plan!, plan_id: 'plan-parallel', request_id: 'req-parallel' },
      execution: { plan_id: 'plan-parallel', success: true, started_at: '2026-09-07T10:00:00.000Z', completed_at: '2026-09-07T10:00:01.000Z', commands: [] },
      verified_at: '2026-09-07T10:00:01.000Z',
    }]
    const view = props(current)
    render(<AgentWorkspace {...view.element.props} attentionSessions={{ 'chat-1': current, 'chat-2': parallel }} />)
    const summary = screen.getByRole('button', { name: /Centro de notificações, 1 alerta/ })
    expect(summary.textContent).toContain('1 alerta')
    expect(summary.textContent).toContain('0 urgentes')
    fireEvent.click(summary)
    expect(screen.getByRole('dialog', { name: 'Alertas ativos' })).toBeTruthy()
    expect(screen.getByRole('button', { name: /Paralelo.*Alterações prontas para o host/ })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Ver todos os alertas' }))
    expect(screen.getByRole('region', { name: 'Centro de notificações' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /Paralelo.*Alterações prontas para o host/ }))
    await waitFor(() => expect(view.onSelectChat).toHaveBeenCalledWith('chat-2'))
  })

  it('keeps an inactive chat action visible and routes it to the owning chat', async () => {
    const current = session()
    const parallel = session()
    parallel.id = 'ses-parallel'
    parallel.state = 'verified'
    parallel.pending_host_changes = [{
      plan: { ...parallel.plan!, plan_id: 'plan-parallel', request_id: 'req-parallel' },
      execution: { plan_id: 'plan-parallel', success: true, started_at: '2026-09-07T10:00:00.000Z', completed_at: '2026-09-07T10:00:01.000Z', commands: [] },
      verified_at: '2026-09-07T10:00:01.000Z',
    }]
    const view = props(current)
    render(<AgentWorkspace {...view.element.props} attentionSessions={{ 'chat-1': current, 'chat-2': parallel }} />)
    fireEvent.click(screen.getByRole('button', { name: /Centro de notificações/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Abrir Paralelo para Aplicar no host' }))
    await waitFor(() => expect(view.onSelectChat).toHaveBeenCalledWith('chat-2'))
    expect(view.onApply).not.toHaveBeenCalled()
  })

  it('exposes the owning chat recovery action after navigating from a global transport alert', async () => {
    const current = session()
    const parallel = session()
    parallel.id = 'ses-parallel'
    parallel.state = 'failed'
    parallel.failure_kind = 'remote_input_transport'
    parallel.last_request_id = 'req-transport'
    parallel.last_repair_error = 'Remote input communication failed'
    const view = props(current)
    const retry = vi.fn(async () => undefined)
    const rendered = render(<AgentWorkspace {...view.element.props} attentionSessions={{ 'chat-1': current, 'chat-2': parallel }} chatProps={{ ...view.element.props.chatProps, onRetryTransportFailure: retry }} />)
    fireEvent.click(screen.getByRole('button', { name: /Centro de notificações/ }))
    fireEvent.click(screen.getByRole('button', { name: /Paralelo.*Falha na ligação ao ChatGPT/ }))
    await waitFor(() => expect(view.onSelectChat).toHaveBeenCalledWith('chat-2'))

    rendered.rerender(<AgentWorkspace
      {...view.element.props}
      session={parallel}
      attentionSessions={{ 'chat-1': current, 'chat-2': parallel }}
      chatProps={{ ...view.element.props.chatProps, session: parallel, activeChatId: 'chat-2', onRetryTransportFailure: retry }}
      inspectorProps={{ ...view.element.props.inspectorProps, session: parallel }}
    />)
    fireEvent.click(screen.getByRole('button', { name: 'Ação disponível: Repetir pedido' }))
    expect(retry).toHaveBeenCalledWith('req-transport')
  })

  it('uses each popover alert as a link to its owning chat and surface', async () => {
    const current = session()
    const parallel = session()
    parallel.id = 'ses-parallel'
    parallel.interrupted_execution = { plan_id: 'plan-parallel', status: 'awaiting_decision', requested_at: '2026-09-07T10:00:01.000Z', approved: false }
    const view = props(current)
    render(<AgentWorkspace {...view.element.props} attentionSessions={{ 'chat-1': current, 'chat-2': parallel }} />)
    fireEvent.click(screen.getByRole('button', { name: /Centro de notificações/ }))
    fireEvent.click(screen.getByRole('button', { name: /Paralelo.*Execução interrompida/ }))
    await waitFor(() => expect(view.onSelectChat).toHaveBeenCalledWith('chat-2'))
    expect(screen.getByRole('button', { name: 'Execução' }).className).toContain('active')
  })

  it('keeps approval and dependency recovery actions inside the alert popover', () => {
    const approval = session()
    approval.policy = { allowed: true, requires_approval: true, risk: 'high', reasons: ['command requests network access'] }
    const approvalView = props(approval)
    const rendered = render(<AgentWorkspace {...approvalView.element.props} attentionSessions={{ 'chat-1': approval }} />)
    expect(screen.queryByRole('button', { name: 'Aprovar e executar plano' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /Centro de notificações/ }))
    const approve = screen.getByRole('button', { name: 'Aprovar e executar' })
    fireEvent.click(approve)
    expect(approvalView.onExecute).toHaveBeenCalledWith(true)

    const blocked = session()
    blocked.state = 'failed'
    blocked.failure_kind = 'offline_go_module_cache'
    blocked.last_repair_error = 'offline sandbox dependencies unavailable: module lookup disabled by GOPROXY=off'
    blocked.last_execution = { plan_id: blocked.plan!.plan_id, success: false, started_at: '2026-09-07T10:00:00.000Z', completed_at: '2026-09-07T10:00:01.000Z', commands: [] }
    const blockedView = props(blocked)
    rendered.rerender(<AgentWorkspace {...blockedView.element.props} attentionSessions={{ 'chat-1': blocked }} />)
    fireEvent.click(screen.getByRole('button', { name: /Centro de notificações/ }))
    expect(screen.getByText('Dependências precisam de rede')).toBeTruthy()
    const retry = screen.getByRole('button', { name: 'Permitir rede e repetir' })
    fireEvent.click(retry)
    expect(blockedView.onRetryDependencyNetwork).toHaveBeenCalledTimes(1)
  })

  it('does not infer dependency-network permission from error prose alone', () => {
    // Guards against reverting to substring classification: this session's
    // prose contains the legacy sentinel text, but the backend did not set
    // failure_kind, so the restricted network action must stay hidden. The
    // unclassified terminal error still gets the generic manual GPT fallback.
    const proseOnly = session()
    proseOnly.state = 'failed'
    proseOnly.last_repair_error = 'offline sandbox dependencies unavailable: module lookup disabled by GOPROXY=off'
    const view = props(proseOnly)
    render(<AgentWorkspace {...view.element.props} attentionSessions={{ 'chat-1': proseOnly }} />)
    fireEvent.click(screen.getByRole('button', { name: /Centro de notificações/ }))
    expect(screen.queryByRole('button', { name: 'Permitir rede e repetir' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Corrigir com GPT' })).toBeTruthy()
  })

  it('surfaces the dependency-network action for a planner-reported infrastructure failure with a coherent failed plan', () => {
    // The structured failure kind, not error prose, makes this recoverable —
    // but only once a coherent failed plan/last_execution pair backs it (see
    // the "never has a plan" test below for the case where it does not).
    const plannerReported = session()
    plannerReported.state = 'failed'
    plannerReported.failure_kind = 'offline_go_module_cache'
    plannerReported.last_repair_error = 'Planner reported failed: offline_host_go_module_cache: Os gates Go obrigatórios não puderam iniciar.'
    plannerReported.last_execution = { plan_id: plannerReported.plan!.plan_id, success: false, started_at: '2026-09-07T10:00:00.000Z', completed_at: '2026-09-07T10:00:01.000Z', commands: [] }
    const view = props(plannerReported)
    render(<AgentWorkspace {...view.element.props} attentionSessions={{ 'chat-1': plannerReported }} />)
    fireEvent.click(screen.getByRole('button', { name: /Centro de notificações/ }))
    const retry = screen.getByRole('button', { name: 'Permitir rede e repetir' })
    fireEvent.click(retry)
    expect(view.onRetryDependencyNetwork).toHaveBeenCalledTimes(1)
  })

  it('never offers the dependency-network action for a planner-reported failure without a plan', () => {
    // Per SoT/AI_PROTOCOL.md a blocked/failed planner turn never carries a
    // plan, so RetryDependencyNetwork's "requires the currently failed plan"
    // guard can never be satisfied here — offering the button would promise a
    // recovery the backend always rejects.
    const plannerReported = session()
    plannerReported.state = 'failed'
    plannerReported.failure_kind = 'offline_go_module_cache'
    plannerReported.last_repair_error = 'Planner reported failed: offline_host_go_module_cache: Os gates Go obrigatórios não puderam iniciar.'
    plannerReported.plan = undefined
    plannerReported.policy = undefined
    plannerReported.last_turn = { protocol: 'harness.turn/v1', request_id: 'req-blocked', kind: 'blocked', message: 'O build list Go não pode ser resolvido com GOPROXY=off.' }
    const view = props(plannerReported)
    render(<AgentWorkspace {...view.element.props} attentionSessions={{ 'chat-1': plannerReported }} />)
    fireEvent.click(screen.getByRole('button', { name: /Centro de notificações/ }))
    expect(screen.queryByRole('button', { name: 'Permitir rede e repetir' })).toBeNull()
    expect(screen.getByText('Pedido bloqueado')).toBeTruthy()
  })

  it('shows a non-actionable toolchain alert inside the popover', () => {
    const blocked = session()
    blocked.state = 'failed'
    blocked.failure_kind = 'host_build_toolchain_mismatch'
    blocked.last_repair_error = 'self-evolution host build failed: Electron failed to install correctly.'
    const view = props(blocked)
    render(<AgentWorkspace {...view.element.props} attentionSessions={{ 'chat-1': blocked }} />)
    expect(screen.getByRole('button', { name: 'Execução' }).className).toContain('attention-danger')
    fireEvent.click(screen.getByRole('button', { name: /Centro de notificações/ }))
    expect(screen.getByText('Build do host bloqueado')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Permitir rede e repetir' })).toBeNull()
  })

  it('offers host dependency repair from the alert popover', () => {
    const blocked = session()
    blocked.state = 'verified'
    blocked.failure_kind = 'host_dependency_state'
    const view = props(blocked)
    render(<AgentWorkspace {...view.element.props} attentionSessions={{ 'chat-1': blocked }} />)
    fireEvent.click(screen.getByRole('button', { name: /Centro de notificações/ }))
    const retry = screen.getByRole('button', { name: 'Reinstalar dependências e repetir' })
    fireEvent.click(retry)
    expect(view.onRetryHostDependencyRepair).toHaveBeenCalledTimes(1)
  })

  it('offers retry-apply from the alert popover for local coordination blocks', () => {
    for (const failureKind of ['self_evolution_transaction_busy', 'self_evolution_transaction_metadata_mismatch', 'host_integration_race'] as const) {
      const blocked = session()
      blocked.state = 'failed'
      blocked.failure_kind = failureKind
      blocked.pending_host_changes = [{
        plan: blocked.plan!,
        execution: { plan_id: 'plan-agent', success: true, started_at: '2026-09-05T13:00:00.000Z', completed_at: '2026-09-05T13:01:00.000Z', commands: [] },
        verified_at: '2026-09-05T13:01:00.000Z',
      }]
      const view = props(blocked)
      const rendered = render(<AgentWorkspace {...view.element.props} attentionSessions={{ 'chat-1': blocked }} />)
      fireEvent.click(screen.getByRole('button', { name: /Centro de notificações/ }))
      const retry = screen.getByRole('button', { name: 'Repetir aplicação' })
      fireEvent.click(retry)
      expect(view.onApply).toHaveBeenCalledTimes(1)
      rendered.unmount()
    }
  })

  it('routes human ChatGPT attention through the popover and highlights Engine', async () => {
    const current = session()
    const onHumanAction = vi.fn()
    const notice: DesktopChatGPTHumanAction = { cacheKey: 'chat-1', active: true, kind: 'verification', source: 'dom', message: 'Conclua a verificação humana.', detectedAt: '2026-09-05T13:00:00.000Z' }
    const view = props(current, { notice, nonce: 0, onAction: onHumanAction })
    const { rerender } = render(<AgentWorkspace {...view.element.props} attentionSessions={{ 'chat-1': current }} chatgptHumanActions={{ 'chat-1': notice }} />)
    expect(screen.queryByRole('button', { name: 'Ação humana necessária no ChatGPT' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Engine' }).className).toContain('attention-warning')
    fireEvent.click(screen.getByRole('button', { name: /Centro de notificações/ }))
    fireEvent.click(screen.getByRole('button', { name: /Principal.*Ação humana necessária no ChatGPT/ }))
    expect(onHumanAction).toHaveBeenCalledTimes(1)
    rerender(<AgentWorkspace {...props(current, { notice, nonce: 1, onAction: onHumanAction }).element.props} attentionSessions={{ 'chat-1': current }} chatgptHumanActions={{ 'chat-1': notice }} />)
    await waitFor(() => expect(screen.getByRole('button', { name: 'Engine' }).className).toContain('active'))
  })

  it('pulses the inactive execution tab while a command is running', () => {
    const view = props()
    const started: HarnessEvent = { id: 'evt-started', session_id: 'ses-agent', type: 'command.started', timestamp: '2026-09-08T15:30:00.000Z', data: { run_id: 'run-1', argv: ['npm', 'test'], cwd: 'services/frontend' } }
    const completed: HarnessEvent = { id: 'evt-completed', session_id: 'ses-agent', type: 'command.completed', timestamp: '2026-09-08T15:30:01.000Z', data: { run_id: 'run-1', argv: ['npm', 'test'], cwd: 'services/frontend', exit_code: 0, success: true } }
    const workspace = (events: HarnessEvent[]) => <AgentWorkspace
      {...view.element.props}
      inspectorProps={{ ...view.element.props.inspectorProps, events }}
    />
    const rendered = render(workspace([started]))
    expect(screen.getByRole('button', { name: 'Execução' }).className).toContain('execution-pulse')

    fireEvent.click(screen.getByRole('button', { name: 'Execução' }))
    expect(screen.getByRole('button', { name: 'Execução' }).className).not.toContain('execution-pulse')

    fireEvent.click(screen.getByRole('button', { name: 'Plano' }))
    expect(screen.getByRole('button', { name: 'Execução' }).className).toContain('execution-pulse')
    rendered.rerender(workspace([started, completed]))
    expect(screen.getByRole('button', { name: 'Execução' }).className).not.toContain('execution-pulse')
  })

  it('focuses the execution inspector when an external recovery action requests logs', async () => {
    const view = props()
    const rendered = render(view.element)
    rendered.rerender(<AgentWorkspace {...view.element.props} inspectorAttention={{ tab: 'terminal', nonce: 1 }} />)
    await waitFor(() => expect(screen.getByRole('button', { name: 'Execução' }).className).toContain('active'))
  })

  it('exports the active chat from the fixed chat header', () => {
    const view = props()
    render(view.element)
    const exportButton = screen.getByRole('button', { name: 'Exportar ZIP' })
    expect((exportButton as HTMLButtonElement).disabled).toBe(false)
    expect(exportButton.textContent).toBe('')
    expect(exportButton.closest('header')?.className).toContain('chat-header')
    expect(exportButton.closest('.agent-activity-bar')).toBeNull()
    expect(screen.queryByRole('heading', { name: 'Principal' })).toBeNull()
    expect(screen.getByRole('button', { name: /^Principal$/ })).toBeTruthy()
    fireEvent.click(exportButton)
    expect(view.onExportChat).toHaveBeenCalledTimes(1)
  })

  it('opens archived chats from the left activity drawer', () => {
    const view = props()
    render(view.element)
    fireEvent.click(screen.getByRole('button', { name: 'Chats arquivados' }))
    expect(screen.getByText('Diagnóstico antigo')).toBeTruthy()
    fireEvent.click(screen.getByText('Diagnóstico antigo'))
    fireEvent.click(screen.getByRole('button', { name: 'Restaurar chat' }))
    expect(view.onRestore).toHaveBeenCalledWith('arch-1')
  })

  it('opens a JetBrains-style project tree from the second activity icon', async () => {
    vi.spyOn(api, 'listFiles').mockResolvedValue({ files: [
      { path: 'README.md', name: 'README.md', kind: 'file', size: 100 },
      { path: 'services', name: 'services', kind: 'directory', size: 0 },
      { path: 'services/frontend', name: 'frontend', kind: 'directory', size: 0 },
    ] })
    vi.spyOn(api, 'readFile').mockResolvedValue({ path: 'README.md', content: '# Wharness', sha256: 'abc', size: 100 })
    const view = props()
    render(view.element)
    fireEvent.click(screen.getByRole('button', { name: 'Explorador do projeto' }))
    const readme = await screen.findByRole('button', { name: 'Abrir README.md no Editor' })
    fireEvent.click(readme)
    // Browsing a file from the agentic-mode explorer must preview it in place,
    // never redirect out of agent mode into the standalone editor surface.
    expect(view.onOpenFile).not.toHaveBeenCalled()
    expect(await screen.findByRole('dialog', { name: 'Pré-visualização de README.md' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Abrir no Editor' }))
    expect(view.onOpenFile).toHaveBeenCalledWith('README.md')
  })
  it('keeps chat navigation available while the active chat is processing', () => {
    const view = props(session(), {}, true)
    render(view.element)
    expect((screen.getByRole('button', { name: 'Novo chat' }) as HTMLButtonElement).disabled).toBe(false)
    expect((screen.getByRole('button', { name: /^Paralelo$/ }) as HTMLButtonElement).disabled).toBe(false)
  })

  it('shows the WHX evolution badge and evidence action only for backend-qualified self-evolution', async () => {
    const normal = props()
    const rendered = render(normal.element)
    expect(screen.queryByText('WHX · AUTO-EVOLUÇÃO')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Logs de auto-evolução' })).toBeNull()

    const self = { ...session(), self_evolution: true }
    vi.spyOn(api, 'evolutionEvidence').mockResolvedValue({ events: [], counts: {}, projects: [], categories: [], total: 0, truncated: false })
    rendered.rerender(props(self).element)
    const badge = screen.getByText('WHX · AUTO-EVOLUÇÃO')
    const directChatGPT = screen.getByRole('navigation', { name: 'ChatGPT direto' })
    const agentAreas = screen.getByRole('navigation', { name: 'Áreas do Agent' })
    expect(badge).toBeTruthy()
    const commandbar = directChatGPT.closest('.agent-commandbar')
    const centeredBadge = badge.closest('.agent-commandbar-center')
    expect(commandbar?.firstElementChild).toBe(directChatGPT)
    expect(centeredBadge?.parentElement).toBe(commandbar)
    expect(commandbar?.lastElementChild).toBe(agentAreas)
    expect(agentAreas.previousElementSibling?.classList.contains('agent-command-actions')).toBe(true)
    expect(directChatGPT.querySelector('[aria-label="ChatGPT"]')).toBeTruthy()
    expect(agentAreas.querySelector('[aria-label="ChatGPT"]')).toBeNull()
    expect(agentAreas.querySelector('[aria-label="Plano"]')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Logs de auto-evolução' }))
    await waitFor(() => expect(screen.getByText('não tratados')).toBeTruthy())
  })

  it('opens project-wide plan and execution drawers with full details', async () => {
    const current = session()
    current.last_execution = { plan_id: 'plan-agent', success: true, started_at: '2026-09-05T10:00:00.000Z', completed_at: '2026-09-05T10:00:01.000Z', commands: [{ argv: ['npm', 'test'], cwd: 'services/frontend', exit_code: 0, stdout: 'tests ok', stderr: '', duration_ms: 900, success: true }] }
    const getSession = vi.spyOn(api, 'getSession').mockResolvedValue({ ...current, id: 'ses-parallel', plan: { ...current.plan!, plan_id: 'plan-parallel', summary: 'Plano paralelo' } })
    render(props(current).element)
    fireEvent.click(screen.getByRole('button', { name: 'Planos do projeto' }))
    await waitFor(() => expect(screen.getAllByText('Plano paralelo').length).toBeGreaterThan(0))
    fireEvent.click(screen.getByRole('button', { name: 'Execuções do projeto' }))
    await waitFor(() => expect(screen.getByText('npm test')).toBeTruthy())
    await waitFor(() => expect(screen.getByText(/tests ok/)).toBeTruthy())
    expect(getSession).toHaveBeenCalledTimes(2)
  })

  it('opens the project knowledge explorer from the left activity rail', async () => {
    vi.spyOn(api, 'projectKnowledge').mockResolvedValue({ knowledge: { project_path: '/workspace/wharness', content: '# Arquitetura\n\n- API local.', version: 2, updated_at: '2026-09-07T10:00:00.000Z', updated_by_request_id: 'req-review' } })
    render(props().element)
    fireEvent.click(screen.getByTitle('Conhecimento adquirido'))
    expect(await screen.findByRole('navigation', { name: 'Tópicos do conhecimento' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Arquitetura' })).toBeTruthy()
  })

})
