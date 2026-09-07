import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { api } from '../lib/api'
import type { Session } from '../types'
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
  const onRestore = vi.fn(async () => undefined)
  const onDelete = vi.fn(async () => undefined)
  const onOpenFile = vi.fn()
  const onExportChat = vi.fn(async () => undefined)
  return {
    onExecute, onRetryDependencyNetwork, onRestore, onDelete, onOpenFile, onExportChat,
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
        onSend: async () => undefined, onNewChat: async () => undefined, onSelectChat: async () => undefined, onArchiveChat: async () => undefined, onRestoreChat: onRestore, onDeleteArchivedChat: onDelete,
      }}
      inspectorProps={{
        config: { planner: 'openai', sandbox: 'docker', model: 'test', api_configured: true, chatgpt_web_embed: false }, session: current, events: [], manualPrompt: '', busy,
        onChatGPTURL: () => true, onExecute, onRetryDependencyNetwork, onApply: async () => undefined, onRejectPendingChanges: async () => undefined, onManualPlan: async () => undefined, onPlanFile: async () => '', onBundleFile: async () => '', onSession: () => undefined,
      }}
    />,
  }
}

describe('AgentWorkspace', () => {
  beforeEach(() => {
    localStorage.clear()
    window.history.replaceState({}, '', '/?wharnessWindow=primary')
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

  it('keeps the chat fixed on the left and uses the right-side tabs for the inspector', () => {
    const view = props()
    const rendered = render(view.element)
    expect(screen.getByRole('navigation', { name: 'Áreas do Agent' })).toBeTruthy()
    expect(screen.queryByText('Agent Inspector')).toBeNull()
    expect(screen.getByText('Harness chat')).toBeTruthy()
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

  it('keeps the FIFO discoverable even while it is empty and renders queued work in order', () => {
    const empty = props()
    const rendered = render(empty.element)
    fireEvent.click(screen.getByRole('button', { name: 'Fila FIFO de execução' }))
    expect(screen.getByText(/A fila está livre/)).toBeTruthy()
    rendered.rerender(<AgentWorkspace
      {...(empty.element.props)}
      executionFIFO={[
        { key: 'one', chatId: 'chat-1', chatTitle: 'Principal', planId: 'plan-one', status: 'running', addedAt: 1 },
        { key: 'two', chatId: 'chat-2', chatTitle: 'Paralelo', planId: 'plan-two', status: 'queued', position: 2, addedAt: 2 },
      ]}
    />)
    expect(screen.getByText('plan-one')).toBeTruthy()
    expect(screen.getByText('plan-two')).toBeTruthy()
    expect(screen.getByText('02')).toBeTruthy()
  })

  it('does not expose Apply or Reject from stale execution success without pending host changes', () => {
    const stale = session()
    stale.state = 'verified'
    stale.last_execution = { plan_id: 'plan-agent', success: true, started_at: '2026-09-05T10:00:00.000Z', completed_at: '2026-09-05T10:00:01.000Z', commands: [] }
    render(props(stale).element)
    expect(screen.queryByRole('button', { name: /Aplicar alterações verificadas no host/ })).toBeNull()
    expect(screen.queryByRole('button', { name: /Rejeitar alterações verificadas/ })).toBeNull()
  })

  it('makes ordinary and dependency-network approvals prominent', () => {
    const approval = session()
    approval.policy = { allowed: true, requires_approval: true, risk: 'high', reasons: ['command requests network access'] }
    const rendered = render(props(approval).element)
    expect(screen.getByRole('button', { name: 'Aprovar e executar plano' }).textContent).toContain('Aprovação necessária')

    const blocked = session()
    blocked.state = 'failed'
    blocked.failure_kind = 'offline_go_module_cache'
    blocked.last_repair_error = 'offline sandbox dependencies unavailable: module lookup disabled by GOPROXY=off'
    const view = props(blocked)
    rendered.rerender(view.element)
    const retry = screen.getByRole('button', { name: 'Permitir rede restrita e repetir' })
    expect(retry.textContent).toContain('Dependências bloqueadas')
    fireEvent.click(retry)
    expect(view.onRetryDependencyNetwork).toHaveBeenCalledTimes(1)
  })

  it('does not surface the dependency-network action from error prose alone', () => {
    // Guards against reverting to substring classification: this session's
    // prose contains the legacy sentinel text, but the backend did not set
    // failure_kind, so no button may render.
    const proseOnly = session()
    proseOnly.state = 'failed'
    proseOnly.last_repair_error = 'offline sandbox dependencies unavailable: module lookup disabled by GOPROXY=off'
    render(props(proseOnly).element)
    expect(screen.queryByRole('button', { name: 'Permitir rede restrita e repetir' })).toBeNull()
  })

  it('surfaces the dependency-network action for a planner-reported infrastructure failure', () => {
    // This is the scenario that used to be a dead end: the terminal failure
    // was "Planner reported failed: offline_host_go_module_cache: ...", which
    // never contained the sandbox sentinel substring. failure_kind is what
    // makes it recoverable regardless of the prose shape.
    const plannerReported = session()
    plannerReported.state = 'failed'
    plannerReported.failure_kind = 'offline_go_module_cache'
    plannerReported.last_repair_error = 'Planner reported failed: offline_host_go_module_cache: Os gates Go obrigatórios não puderam iniciar.'
    const view = props(plannerReported)
    render(view.element)
    const retry = screen.getByRole('button', { name: 'Permitir rede restrita e repetir' })
    fireEvent.click(retry)
    expect(view.onRetryDependencyNetwork).toHaveBeenCalledTimes(1)
  })

  it('shows an informative, non-actionable notice for a host toolchain mismatch instead of a retry button', () => {
    // Unlike the offline Go module cache case, there is no Wharness-grantable
    // recovery here (the host's own Node.js is too old for a pinned
    // dependency's postinstall) — no button should render, only a notice.
    const blocked = session()
    blocked.state = 'failed'
    blocked.failure_kind = 'host_build_toolchain_mismatch'
    blocked.last_repair_error = 'self-evolution host build failed: Electron failed to install correctly.'
    render(props(blocked).element)
    expect(screen.getByRole('status', { name: 'Build do host bloqueado por incompatibilidade de toolchain' }).textContent).toContain('Node do host incompatível')
    expect(screen.queryByRole('button', { name: 'Permitir rede restrita e repetir' })).toBeNull()
  })

  it('keeps human ChatGPT intervention visible and opens the ChatGPT inspector on acknowledgement', async () => {
    const current = session()
    const onHumanAction = vi.fn()
    const notice: DesktopChatGPTHumanAction = { cacheKey: 'chat-1', active: true, kind: 'verification', source: 'dom', message: 'Conclua a verificação humana.', detectedAt: '2026-09-05T13:00:00.000Z' }
    const view = props(current, { notice, nonce: 0, onAction: onHumanAction })
    const { rerender } = render(view.element)
    const action = screen.getByRole('button', { name: 'Ação humana necessária no ChatGPT' })
    expect(action.getAttribute('title')).toBe('Conclua a verificação humana.')
    fireEvent.click(action)
    expect(onHumanAction).toHaveBeenCalledTimes(1)
    rerender(props(current, { notice, nonce: 1, onAction: onHumanAction }).element)
    await waitFor(() => expect(screen.getByRole('button', { name: 'Engine' }).className).toContain('active'))
  })

  it('exports the active chat from the fixed chat header', () => {
    const view = props()
    render(view.element)
    const exportButton = screen.getByRole('button', { name: 'Exportar chat' })
    expect((exportButton as HTMLButtonElement).disabled).toBe(false)
    expect(exportButton.closest('header')?.className).toContain('chat-header')
    expect(exportButton.closest('.agent-activity-bar')).toBeNull()
    expect(screen.getByRole('heading', { name: 'Principal' })).toBeTruthy()
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

})
