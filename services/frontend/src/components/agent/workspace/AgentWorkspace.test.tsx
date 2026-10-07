import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { api } from '../../../lib/transport/http/api'
import { boundedAgentChatWidth } from '../../../lib/agent/runtime/agentLayout'
import './testing/setup'
import { props, session } from './testing/fixtures'
describe('AgentWorkspace', () => {
it('bounds a restored split so chat and Engine keep their usable minimums', () => {
    expect(boundedAgentChatWidth(1_400, 1_200)).toBe(794)
    expect(boundedAgentChatWidth(120, 1_200)).toBe(480)
    expect(boundedAgentChatWidth(700, 800)).toBe(0)
  })

it('opens the notification center when the project chrome requests it', () => {
    render(props().element)
    fireEvent(window, new CustomEvent('wharnex:open-attention-drawer'))
    expect(screen.getByRole('region', { name: 'Centro de notificações' })).toBeTruthy()
    expect(screen.getByText('Nada requer atenção')).toBeTruthy()
    expect(screen.getByText('Alertas de todos os chats abertos deste projeto aparecerão aqui.')).toBeTruthy()
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

it('keeps both panes mounted while visual focus follows the direct ChatGPT surface', () => {
    const view = props()
    const rendered = render(view.element)
    const workspace = rendered.container.querySelector('.agent-workspace') as HTMLElement
    const chatStage = rendered.container.querySelector('.agent-chat-stage') as HTMLElement

    expect(workspace.getAttribute('data-focused-pane')).toBe('chat')
    expect(workspace.getAttribute('data-inspector-tab')).toBe('plan')
    expect(chatStage).toBeTruthy()
    expect(rendered.container.querySelector('.agent-inspector-stage')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'ChatGPT' }))
    expect(workspace.getAttribute('data-focused-pane')).toBe('inspector')
    expect(workspace.getAttribute('data-inspector-tab')).toBe('direct-chatgpt')
    expect(rendered.container.querySelector('.agent-chat-stage')).toBeTruthy()

    fireEvent.pointerDown(chatStage)
    expect(workspace.getAttribute('data-focused-pane')).toBe('chat')
    expect(workspace.getAttribute('data-inspector-tab')).toBe('direct-chatgpt')
  })

it('mounts Agent shortcuts inside the existing right workspace rail', async () => {
    const view = props()
    render(<view.Harness railVisible />)
    const rightRail = screen.getByRole('complementary', { name: 'Ferramentas laterais direitas' })
    await waitFor(() => {
      const commandbar = rightRail.querySelector('.agent-commandbar')
      expect(commandbar).toBeTruthy()
      expect(commandbar?.closest('.workspace-agent-rail-slot')).toBeTruthy()
      expect(commandbar?.closest('.agent-workspace')).toBeNull()
    })
    expect(within(rightRail).getByRole('button', { name: 'Explorador do projeto' })).toBeTruthy()
    expect(within(rightRail).queryByRole('navigation', { name: 'Áreas do Agent' })).toBeNull()
    expect(within(rightRail).getByRole('navigation', { name: 'ChatGPT direto' })).toBeTruthy()
    expect(within(screen.getByRole('navigation', { name: 'Conversas do Wharnex' })).getByRole('tablist', { name: 'Áreas do Agent' })).toBeTruthy()
  })

it('opens the global file library from the left workspace rail', async () => {
    vi.spyOn(api, 'managedArtifacts').mockResolvedValue({ artifacts: [] })
    vi.spyOn(api, 'storage').mockResolvedValue({ total_bytes: 0, state_bytes: 0, context_bytes: 0, sandbox_bytes: 0, artifact_bytes: 0, archive_bytes: 0, orphan_bytes: 0, projects: [] })
    const rendered = render(props().element)
    const rail = screen.getByRole('complementary', { name: 'Ferramentas do workspace' })
    const libraryButton = within(rail).getByRole('button', { name: 'Biblioteca de ficheiros' })

    fireEvent.click(libraryButton)

    expect(await screen.findByText('Todos os artefactos guardados')).toBeTruthy()
    expect(rendered.container.querySelector('.agent-drawer .file-library-panel')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Fechar biblioteca' }))
    expect(screen.queryByText('Todos os artefactos guardados')).toBeNull()
  })

it('removes execute affordances while the active plan is already being dispatched or executed', () => {
    const running = session()
    running.interrupted_execution = { plan_id: running.plan!.plan_id, requested_at: '2026-09-12T19:00:00.000Z', approved: false, status: 'running' }
    const runningView = props(running)
    const rendered = render(runningView.element)
    expect(screen.queryByRole('button', { name: 'Aceitar e executar' })).toBeNull()

    rendered.rerender(props(session(), {}, true).element)
    expect((screen.getByRole('button', { name: 'Aceitar e executar' }) as HTMLButtonElement).disabled).toBe(true)
  })

it('restores each chat viewport across the keyed chat panel remount', async () => {
    const base = props()
    const chatAItems = Array.from({ length: 45 }, (_, index) => ({ id: `chat-a-${index + 1}`, role: 'user' as const, text: `chat A mensagem ${index + 1}` }))
    const chatBItems = Array.from({ length: 12 }, (_, index) => ({ id: `chat-b-${index + 1}`, role: 'user' as const, text: `chat B mensagem ${index + 1}` }))
    const workspace = (activeChatId: string, items: typeof chatAItems) => <base.Harness chatProps={{ activeChatId, items }} />
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
  }, 10_000)

it('keeps the FIFO discoverable even while it is empty and renders queued work in order', async () => {
    const empty = props()
    const rendered = render(empty.element)
    vi.spyOn(api, 'projectTasks').mockResolvedValue({ tasks: [] })
    fireEvent.click(screen.getByRole('button', { name: 'Tarefas do projeto' }))
    expect(await screen.findByText(/Sem execuções ativas ou recentes/)).toBeTruthy()
    rendered.rerender(<empty.Harness executionFIFO={[
      { key: 'one', chatId: 'chat-1', chatTitle: 'Principal', planId: 'plan-one', status: 'running', addedAt: 1 },
      { key: 'two', chatId: 'chat-2', chatTitle: 'Paralelo', planId: 'plan-two', status: 'queued', position: 2, addedAt: 2 },
    ]} />)
    expect(screen.getByText('plan-one')).toBeTruthy()
    expect(screen.getByText('plan-two')).toBeTruthy()
    expect(screen.getByText('#02')).toBeTruthy()
    expect(screen.getAllByText('Em execução').length).toBeGreaterThan(0)
    expect(screen.getByText('Na fila')).toBeTruthy()
  })

it('exposes the per-project execution concurrency next to the queue it governs', async () => {
    vi.spyOn(api, 'executionConcurrency').mockResolvedValue({ concurrency: 1, max: 8 })
    const update = vi.spyOn(api, 'updateExecutionConcurrency').mockResolvedValue({ concurrency: 3, max: 8 })
    vi.spyOn(api, 'projectTasks').mockResolvedValue({ tasks: [] })
    render(props().element)
    fireEvent.click(screen.getByRole('button', { name: 'Tarefas do projeto' }))
    const input = await screen.findByLabelText('Execuções simultâneas por projeto')
    expect(input.tagName).toBe('SELECT')
    expect((input as HTMLSelectElement).value).toBe('1')
    fireEvent.change(input, { target: { value: '3' } })
    await waitFor(() => expect(update).toHaveBeenCalledWith(3))
    await waitFor(() => expect((screen.getByLabelText('Execuções simultâneas por projeto') as HTMLSelectElement).value).toBe('3'))
  })

it('keeps the execution queue usable when the concurrency limit cannot be read', async () => {
    vi.spyOn(api, 'executionConcurrency').mockRejectedValue(new Error('backend unavailable'))
    vi.spyOn(api, 'projectTasks').mockResolvedValue({ tasks: [] })
    render(props().element)
    fireEvent.click(screen.getByRole('button', { name: 'Tarefas do projeto' }))
    expect(await screen.findByText(/Sem execuções ativas ou recentes/)).toBeTruthy()
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

it('opens the full alert panel from the project chrome request', async () => {
    const current = session()
    const parallel = session()
    parallel.id = 'ses-parallel'
    parallel.state = 'planned'
    parallel.plan = { ...parallel.plan!, plan_id: 'plan-parallel', request_id: 'req-parallel', risk: 'high', requires_approval: true }
    parallel.policy = { allowed: true, requires_approval: true, risk: 'high', reasons: ['approval required'] }
    const view = props(current)
    render(<view.Harness attentionSessions={{ 'chat-1': current, 'chat-2': parallel }} />)
    fireEvent(window, new CustomEvent('wharnex:open-attention-drawer'))
    expect(screen.getByRole('region', { name: 'Centro de notificações' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /Paralelo.*Aprovação necessária/ }))
    await waitFor(() => expect(view.onSelectChat).toHaveBeenCalledWith('chat-2'))
  })

it('keeps an inactive chat action visible and routes it to the owning chat', async () => {
    const current = session()
    const parallel = session()
    parallel.id = 'ses-parallel'
    parallel.state = 'planned'
    parallel.plan = { ...parallel.plan!, plan_id: 'plan-parallel', request_id: 'req-parallel', risk: 'high', requires_approval: true }
    parallel.policy = { allowed: true, requires_approval: true, risk: 'high', reasons: ['approval required'] }
    const view = props(current)
    render(<view.Harness attentionSessions={{ 'chat-1': current, 'chat-2': parallel }} />)
    fireEvent(window, new CustomEvent('wharnex:open-attention-drawer'))
    fireEvent.click(screen.getByRole('button', { name: 'Abrir Paralelo para Aprovar e executar' }))
    await waitFor(() => expect(view.onSelectChat).toHaveBeenCalledWith('chat-2'))
    expect(view.onExecute).not.toHaveBeenCalled()
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
    const rendered = render(<view.Harness attentionSessions={{ 'chat-1': current, 'chat-2': parallel }} chatProps={{ onRetryTransportFailure: retry }} />)
    fireEvent(window, new CustomEvent('wharnex:open-attention-drawer'))
    fireEvent.click(screen.getByRole('button', { name: /Paralelo.*Falha na ligação ao ChatGPT/ }))
    await waitFor(() => expect(view.onSelectChat).toHaveBeenCalledWith('chat-2'))

    rendered.rerender(<view.Harness
      session={parallel}
      attentionSessions={{ 'chat-1': current, 'chat-2': parallel }}
      chatProps={{ session: parallel, activeChatId: 'chat-2', onRetryTransportFailure: retry }}
      inspectorProps={{ session: parallel }}
    />)
    fireEvent(window, new CustomEvent('wharnex:open-attention-drawer'))
    fireEvent.click(within(screen.getByRole('region', { name: 'Centro de notificações' })).getByRole('button', { name: 'Repetir pedido' }))
    expect(retry).toHaveBeenCalledWith('req-transport')
  })

it('keeps approval and dependency recovery actions inside the alert popover', () => {
    const approval = session()
    approval.policy = { allowed: true, requires_approval: true, risk: 'high', reasons: ['command requests network access'] }
    const approvalView = props(approval)
    const rendered = render(<approvalView.Harness attentionSessions={{ 'chat-1': approval }} />)
    expect(screen.queryByRole('button', { name: 'Aprovar e executar plano' })).toBeNull()
    fireEvent(window, new CustomEvent('wharnex:open-attention-drawer'))
    const approve = screen.getByRole('button', { name: 'Aprovar e executar' })
    fireEvent.click(approve)
    expect(approvalView.onExecute).toHaveBeenCalledWith(true)

    const blocked = session()
    blocked.state = 'failed'
    blocked.failure_kind = 'offline_go_module_cache'
    blocked.last_repair_error = 'offline sandbox dependencies unavailable: module lookup disabled by GOPROXY=off'
    blocked.last_execution = { plan_id: blocked.plan!.plan_id, success: false, started_at: '2026-09-07T10:00:00.000Z', completed_at: '2026-09-07T10:00:01.000Z', commands: [] }
    const blockedView = props(blocked)
    rendered.rerender(<blockedView.Harness attentionSessions={{ 'chat-1': blocked }} />)
    fireEvent(window, new CustomEvent('wharnex:open-attention-drawer'))
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
    render(<view.Harness attentionSessions={{ 'chat-1': proseOnly }} />)
    fireEvent(window, new CustomEvent('wharnex:open-attention-drawer'))
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
    render(<view.Harness attentionSessions={{ 'chat-1': plannerReported }} />)
    fireEvent(window, new CustomEvent('wharnex:open-attention-drawer'))
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
    render(<view.Harness attentionSessions={{ 'chat-1': plannerReported }} />)
    fireEvent(window, new CustomEvent('wharnex:open-attention-drawer'))
    expect(screen.queryByRole('button', { name: 'Permitir rede e repetir' })).toBeNull()
    expect(screen.getByText('Pedido bloqueado')).toBeTruthy()
  })

it('offers host dependency repair from the alert popover', () => {
    const blocked = session()
    blocked.state = 'verified'
    blocked.failure_kind = 'host_dependency_state'
    const view = props(blocked)
    render(<view.Harness attentionSessions={{ 'chat-1': blocked }} />)
    fireEvent(window, new CustomEvent('wharnex:open-attention-drawer'))
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
      const rendered = render(<view.Harness attentionSessions={{ 'chat-1': blocked }} />)
      fireEvent(window, new CustomEvent('wharnex:open-attention-drawer'))
      const retry = screen.getByRole('button', { name: 'Repetir aplicação' })
      fireEvent.click(retry)
      expect(view.onApply).toHaveBeenCalledTimes(1)
      rendered.unmount()
    }
  })

it('offers saving an active chat without archiving it', () => {
    const view = props()
    const onSaveChat = vi.fn(async () => undefined)
    render(<view.Harness chatProps={{ onSaveChat }} />)
    fireEvent.click(screen.getByRole('button', { name: 'Guardar chat Principal' }))
    expect(onSaveChat).toHaveBeenCalledWith('chat-1')
  })

it('reopens the latest closed chat directly from the Agent chat switcher', () => {
    const view = props()
    render(view.element)
    const reopen = screen.getByRole('button', { name: 'Reabrir último chat fechado' })
    expect(reopen.getAttribute('title')).toContain('Diagnóstico antigo')
    fireEvent.click(reopen)
    expect(view.onRestore).toHaveBeenCalledWith('arch-1')
  })

it('opens project files as editable documents without leaving Agent mode', async () => {
    vi.spyOn(api, 'listFiles').mockResolvedValue({ files: [
      { path: 'README.md', name: 'README.md', kind: 'file', size: 100 },
      { path: 'services', name: 'services', kind: 'directory', size: 0 },
      { path: 'services/frontend', name: 'frontend', kind: 'directory', size: 0 },
    ] })
    vi.spyOn(api, 'readFile').mockResolvedValue({ path: 'README.md', content: '# Wharnex', sha256: 'abc', size: 100 })
    const writeFile = vi.spyOn(api, 'writeFile').mockResolvedValue({ path: 'README.md', content: '# Wharnex editado', sha256: 'def', size: 108 })
    const view = props()
    render(view.element)
    fireEvent.click(screen.getByRole('button', { name: 'Explorador do projeto' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Abrir README.md' }))

    expect(view.onOpenFile).not.toHaveBeenCalled()
    expect(await screen.findByRole('dialog', { name: 'Pré-visualização de README.md' })).toBeTruthy()
    const editor = screen.getByRole('textbox', { name: 'Editor de README.md' })
    fireEvent.change(editor, { target: { value: '# Wharnex editado' } })
    expect(screen.getByText('Alterado')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Guardar' }))
    await waitFor(() => expect(writeFile).toHaveBeenCalledWith('ses-agent', { path: 'README.md', content: '# Wharnex editado', sha256: 'abc' }))
    await waitFor(() => expect(screen.queryByText('Alterado')).toBeNull())

    fireEvent.click(screen.getByRole('button', { name: 'Abrir no Editor' }))
    await waitFor(() => expect(view.onOpenFile).toHaveBeenCalledWith('README.md'))
  })

it('keeps chat navigation available while the active chat is processing', () => {
    const view = props(session(), {}, true)
    render(view.element)
    expect((screen.getByRole('button', { name: 'Novo chat' }) as HTMLButtonElement).disabled).toBe(false)
    expect((screen.getByRole('tab', { name: /^Paralelo$/ }) as HTMLButtonElement).disabled).toBe(false)
  })

it('keeps self-evolution status out of the Agent rail while preserving its evidence action', async () => {
    const normal = props()
    const rendered = render(normal.element)
    expect(screen.queryByText('WHX · AUTO-EVOLUÇÃO')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Logs de auto-evolução' })).toBeNull()

    const self = { ...session(), self_evolution: true }
    vi.spyOn(api, 'evolutionEvidence').mockResolvedValue({ events: [], counts: {}, projects: [], categories: [], total: 0, truncated: false, knowledge: [], knowledge_counts: {}, knowledge_categories: [], knowledge_total: 0, knowledge_truncated: false })
    rendered.rerender(props(self).element)
    expect(screen.queryByText('WHX · AUTO-EVOLUÇÃO')).toBeNull()
    const directChatGPT = screen.getByRole('navigation', { name: 'ChatGPT direto' })
    const agentAreas = screen.getByRole('tablist', { name: 'Áreas do Agent' })
    const commandbar = directChatGPT.closest('.agent-commandbar')
    expect(commandbar?.getAttribute('aria-label')).toBe('Atalhos do Agent')
    expect(commandbar?.lastElementChild).toBe(directChatGPT)
    expect(commandbar?.querySelector('[aria-label="Áreas do Agent"]')).toBeNull()
    expect(agentAreas.closest('.agent-chat-fixed-tools')).toBeTruthy()
    expect(agentAreas.closest('.agent-chat-switcher')).toBeTruthy()
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

it('opens every drawer at the same width with a resizable left panel', async () => {
    // A per-drawer clamp made the workspace jump to a different geometry on
    // each selection; the equal split is what makes switching drawers calm.
    const { container } = render(props().element)

    fireEvent.click(screen.getByRole('button', { name: 'Planos do projeto' }))
    const drawer = await waitFor(() => {
      const node = container.querySelector('.agent-drawer')
      if (!node) throw new Error('drawer not open')
      return node
    })
    expect(drawer.className).toContain('agent-drawer')
    expect(drawer.className).toContain('workspace-side-drawer-left')
    expect(container.querySelector('.agent-drawer-splitter')).toBeTruthy()

    fireEvent.click(screen.getByTitle('Conhecimento adquirido'))
    const knowledge = await waitFor(() => {
      const node = container.querySelector('.agent-drawer')
      if (!node) throw new Error('drawer not open')
      return node
    })
    // Side identity is allowed for two configurable rails, but no drawer-specific
    // geometry class may make different tools open at different widths.
    expect(knowledge.className).toContain('agent-drawer')
    expect(knowledge.className).toContain('workspace-side-drawer-left')

    // Untouched widths publish no inline override: the stylesheet's default
    // side-panel share stays in charge until the operator drags a splitter.
    const workspace = container.querySelector('.agent-workspace') as HTMLElement
    expect(workspace.getAttribute('style')).toBeNull()
  })

it('persists a dragged side-panel width against the shell, not the workspace', async () => {
    const { container } = render(props().element)
    fireEvent.click(screen.getByRole('button', { name: 'Planos do projeto' }))
    const splitter = await waitFor(() => {
      const node = container.querySelector('.agent-drawer-splitter') as HTMLElement | null
      if (!node) throw new Error('drawer splitter not rendered')
      return node
    })
    // The rail and drawer are the shell's columns now, so the drag measures
    // against the shell row rather than the Agent workspace.
    const body = container.querySelector('.workspace-body') as HTMLElement
    const row = container.querySelector('.workspace-main-row') as HTMLElement
    const centre = container.querySelector('.workspace-center-column') as HTMLElement
    const shellRect = { x: 0, y: 0, top: 0, left: 0, right: 1600, bottom: 900, width: 1600, height: 900, toJSON: () => ({}) }
    body.getBoundingClientRect = () => shellRect
    row.getBoundingClientRect = () => shellRect
    centre.getBoundingClientRect = () => ({ ...shellRect, right: 900, width: 900 })
    splitter.setPointerCapture = () => undefined

    fireEvent.pointerDown(splitter, { pointerId: 1, clientX: 400 })
    fireEvent(window, Object.assign(new Event('pointermove'), { clientX: 500 }))
    fireEvent(window, new Event('pointerup'))

    const drawer = container.querySelector('.agent-drawer') as HTMLElement
    await waitFor(() => expect(drawer.style.getPropertyValue('--workspace-drawer-width')).toBe('456px'))

    // Production wraps the mode stack in `.workspace-center-column`. Its live
    // width must not be counted as reserved chrome or it creates a false upper
    // bound that stops the divider while plenty of centre space remains.
    fireEvent.pointerDown(splitter, { pointerId: 2, clientX: 500 })
    fireEvent(window, Object.assign(new Event('pointermove'), { clientX: 900 }))
    fireEvent(window, new Event('pointerup'))
    await waitFor(() => expect(drawer.style.getPropertyValue('--workspace-drawer-width')).toBe('856px'))
    // The Agent's own chat/inspector split is a separate measurement and must
    // not be rewritten by a drag of the shell's side panel.
    const workspace = container.querySelector('.agent-workspace') as HTMLElement
    expect(workspace.style.getPropertyValue('--agent-chat-width')).toBe('')
    // Each rail owns its width independently, scoped to the desktop window.
    expect(localStorage.getItem('whx.workspace.drawer-width:left:primary')).toBe('456')

    // The divider must also travel below the old 240px drawer floor. A narrow
    // drawer remains recoverable because its rail and splitter stay mounted.
    fireEvent.pointerDown(splitter, { pointerId: 3, clientX: 900 })
    fireEvent(window, Object.assign(new Event('pointermove'), { clientX: 80 }))
    fireEvent(window, new Event('pointerup'))
    await waitFor(() => expect(drawer.style.getPropertyValue('--workspace-drawer-width')).toBe('160px'))
    expect(localStorage.getItem('whx.workspace.drawer-width:left:primary')).toBe('160')
  })

it('keeps required panel controls in one shared upper-right toolbar', async () => {
    vi.spyOn(api, 'listFiles').mockResolvedValue({ files: [] })
    vi.spyOn(api, 'gitOverview').mockResolvedValue({ available: false, pending: [] } as never)
    const { container } = render(props().element)

    fireEvent.click(screen.getByTitle('Explorador do projeto'))
    const toolbar = await screen.findByRole('toolbar', { name: 'Ferramentas do painel Explorador do projeto' })
    expect(within(toolbar).getByRole('button', { name: 'Diminuir texto do painel Explorador do projeto' })).toBeTruthy()
    expect(within(toolbar).getByRole('button', { name: 'Aumentar texto do painel Explorador do projeto' })).toBeTruthy()
    expect(within(toolbar).getByRole('button', { name: 'Recarregar painel Explorador do projeto' })).toBeTruthy()
    expect(within(toolbar).getByRole('button', { name: 'Fechar painel Explorador do projeto' })).toBeTruthy()

    const drawer = container.querySelector('.workspace-side-drawer') as HTMLElement
    fireEvent.click(within(toolbar).getByRole('button', { name: 'Aumentar texto do painel Explorador do projeto' }))
    expect(drawer.style.getPropertyValue('--workspace-panel-font-scale')).toBe('1.1')
    expect(JSON.parse(localStorage.getItem('whx.workspace.panel-font-scales.v1:primary') || '{}').project).toBe(1.1)

    await waitFor(() => expect(api.listFiles).toHaveBeenCalledTimes(1))
    fireEvent.click(within(toolbar).getByRole('button', { name: 'Recarregar painel Explorador do projeto' }))
    await waitFor(() => expect(api.listFiles).toHaveBeenCalledTimes(2))

    fireEvent.click(within(toolbar).getByRole('button', { name: 'Fechar painel Explorador do projeto' }))
    await waitFor(() => expect(container.querySelector('.agent-drawer')).toBeNull())
  })

it('keeps the left panel open across attention routing and offers every drawer a close control', async () => {
    // Attention used to dismiss the drawer, so an alert arriving while the
    // operator read the runtime or Git view pulled it out from under them.
    const view = props()
    const { container, rerender } = render(<view.Harness />)
    fireEvent.click(screen.getByTitle('Explorador do projeto'))
    await waitFor(() => expect(container.querySelector('.agent-drawer')).toBeTruthy())
    expect(screen.getByRole('button', { name: 'Fechar explorador' })).toBeTruthy()

    // Same harness instance: attention arriving must not dismiss the panel.
    rerender(<view.Harness nonce={9} />)
    expect(container.querySelector('.agent-drawer')).toBeTruthy()
    rerender(<view.Harness recoveryTab="terminal" />)
    expect(container.querySelector('.agent-drawer')).toBeTruthy()

    // Only the explicit control dismisses it.
    fireEvent.click(screen.getByRole('button', { name: 'Fechar explorador' }))
    await waitFor(() => expect(container.querySelector('.agent-drawer')).toBeNull())
  })

it('opens the project knowledge explorer from the left activity rail', async () => {
    vi.spyOn(api, 'projectKnowledgeCatalog').mockResolvedValue({ catalog: {
      project_path: '/workspace/wharnex',
      revision: 2,
      updated_at: '2026-09-07T10:00:00.000Z',
      updated_by_request_id: 'req-review',
      entries: [{ id: 'arquitetura', category: 'product_domain', content: '# Arquitetura\n\n- API local.', version: 2, updated_at: '2026-09-07T10:00:00.000Z', updated_by_request_id: 'req-review' }],
    } })
    render(props().element)
    fireEvent.click(screen.getByTitle('Conhecimento adquirido'))
    expect(await screen.findByRole('navigation', { name: 'Registos de conhecimento' })).toBeTruthy()
    expect(screen.getByRole('button', { name: /arquitetura/ })).toBeTruthy()
  })
})
