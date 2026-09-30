import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { api } from '../../../lib/transport/http/api'
import type { HarnessEvent, Session } from '../../../types'
import { useEffect, useState, type ComponentProps } from 'react'
import { AgentWorkspace } from './AgentWorkspace'
import { boundedAgentChatWidth } from '../../../lib/agent/runtime/agentLayout'
import { WorkspaceSideRail, type Drawer, type WorkspaceSideRailProps } from '../../workspace/shell/WorkspaceSideRail'
import { collectAttentionItems, type AttentionItem, type AttentionTarget } from '../../../lib/attention/center/attentionCenter'
import { executionQueueActiveCount, type ExecutionFIFOItem } from '../../../lib/execution/history/executionQueueView'

// Monaco has no usable DOM/worker environment under jsdom, so the stub exposes
// the edit/save contract that the Agent file modal wires into the real editor.
vi.mock('../../editor/canvas/CodeEditor', () => ({ CodeEditor: ({ path, value, onChange, onSave }: { path: string; value: string; onChange: (value: string) => void; onSave: () => void }) => <div data-testid="code-editor-stub"><textarea aria-label={`Editor de ${path}`} value={value} onChange={(event) => onChange(event.target.value)}/><button type="button" onClick={onSave}>Guardar no editor</button></div> }))

function session(): Session {
  return {
    id: 'ses-agent', project_path: '/workspace/wharness', state: 'planned', execution_mode: 'protected', automation_mode: 'auto', created_at: new Date().toISOString(),
    context: { id: 'ctx', manifest: { id: 'ctx', project_root: '/workspace/wharness', sha256: 'abcdef123456', files: [], excluded: [], text_truncated: false } },
    plan: { protocol: 'harness.execution/v1', plan_id: 'plan-agent', request_id: 'req-agent', status: 'ready', summary: 'Atualizar UI', risk: 'low', requires_approval: false, operations: [], verification: [] },
    policy: { allowed: true, requires_approval: false, risk: 'low', reasons: [] },
  }
}

// The rail and the Agent workspace are siblings under the shell, so the harness
// mirrors that: it owns the drawer and the attention handlers the shell owns,
// which is what lets these tests exercise the rail and the workspace together.
function props(current = session(), human: { notice?: DesktopChatGPTHumanAction; nonce?: number; onAction?: () => void } = {}, busy = false) {
  const onExecute = vi.fn(async (approve?: boolean) => { void approve })
  const onRetryDependencyNetwork = vi.fn(async () => undefined)
  const onRetryHostDependencyRepair = vi.fn(async () => undefined)
  const onApply = vi.fn(async () => undefined)
  const onRestore = vi.fn(async () => undefined)
  const onDelete = vi.fn(async () => undefined)
  const onOpenFile = vi.fn()
  const onExportChat = vi.fn(async () => undefined)
  const onSelectChat = vi.fn(async (chatId: string) => { void chatId })
  const onReorderChat = vi.fn()
  const chats = [
    { id: 'chat-1', title: 'Principal', sessionId: current.id, createdAt: '2026-09-04T10:00:00.000Z', updatedAt: '2026-09-04T10:00:00.000Z' },
    { id: 'chat-2', title: 'Paralelo', sessionId: 'ses-parallel', createdAt: '2026-09-04T09:00:00.000Z', updatedAt: '2026-09-04T09:00:00.000Z' },
  ]
  const archivedChats = [{ id: 'arch-1', title: 'Diagnóstico antigo', sessionId: 'ses-old', createdAt: '2026-09-03T10:00:00.000Z', updatedAt: '2026-09-03T11:00:00.000Z' }]

  function Harness({ session: active = current, attentionSessions = {}, chatgptHumanActions = {}, nonce = human.nonce, recoveryTab, chatProps: chatOverride, inspectorProps: inspectorOverride, workspaceProps = {}, executionFIFO = [], railVisible = false, singlePane = false }: {
    session?: Session
    attentionSessions?: Record<string, Session | undefined>
    chatgptHumanActions?: Record<string, DesktopChatGPTHumanAction>
    nonce?: number
    recoveryTab?: AttentionTarget
    chatProps?: Record<string, unknown>
    inspectorProps?: Record<string, unknown>
    workspaceProps?: Partial<Pick<ComponentProps<typeof AgentWorkspace>, 'onDetachChat' | 'onSplitChat' | 'minimalSurface'>>
    executionFIFO?: ExecutionFIFOItem[]
    railVisible?: boolean
    singlePane?: boolean
  }) {
    const [drawer, setDrawer] = useState<Drawer>('')
    const [inspectorAttention, setInspectorAttention] = useState<{ tab: AttentionTarget; nonce: number }>({ tab: 'terminal', nonce: 0 })
    const [terminalOpen, setTerminalOpen] = useState(false)
    // An external recovery action routes the inspector through the same channel
    // the shell uses, so the workspace sees exactly what production sends it.
    useEffect(() => {
      if (!recoveryTab) return
      setInspectorAttention((value) => ({ tab: recoveryTab, nonce: value.nonce + 1 }))
    }, [recoveryTab])
    const attentionItems = collectAttentionItems(chats, attentionSessions, chatgptHumanActions)
    const openAttention = async (item: AttentionItem) => {
      if (item.id.endsWith(':chatgpt-human-action') && human.notice?.active && human.onAction) { human.onAction(); return }
      if (item.chatId !== (chatOverride?.activeChatId ?? 'chat-1')) await onSelectChat(item.chatId)
      if (item.target) setInspectorAttention((value) => ({ tab: item.target as AttentionTarget, nonce: value.nonce + 1 }))
    }
    // Mirrors the shell's own handler, including the cross-chat rule: an action
    // for another chat first navigates there instead of acting on this one.
    const runAttention = async (item: AttentionItem) => {
      if (!item.action) return
      if (item.chatId !== (chatOverride?.activeChatId ?? 'chat-1')) { await openAttention(item); return }
      if (item.action === 'approve-execution') await onExecute(true)
      else if (item.action === 'retry-dependency-network') await onRetryDependencyNetwork()
      else if (item.action === 'repair-host-dependency') await onRetryHostDependencyRepair()
      else if (item.action === 'retry-transport') await (chatOverride?.onRetryTransportFailure as ((id: string) => Promise<void>) | undefined)?.(item.requestId || '')
      else if (item.action === 'retry-host-apply') await onApply()
    }
    const sharedRailProps = {
      session: active, busy, chats, archivedChats, activeChatId: 'chat-1', activeEvents: [],
      attentionItems, executionFIFO, activeExecutionCount: executionQueueActiveCount(executionFIFO),
      onOpenAttention: openAttention, onAttentionAction: runAttention, onRestoreChat: onRestore, onDeleteArchivedChat: onDelete,
      onRenameChat: async () => undefined, onGenerateChatTitle: async () => undefined, onOpenFile, onError: vi.fn(),
      terminalOpen, onToggleTerminal: () => setTerminalOpen((open) => !open),
    } satisfies Omit<WorkspaceSideRailProps, 'drawer' | 'onDrawer'>
    return <div className="workspace-body">
      <div className="workspace-main-row">
        <WorkspaceSideRail {...sharedRailProps} drawer={drawer} onDrawer={setDrawer}/>
        <div className="workspace-center-column">
          <div className="workspace-mode-stack">
            <AgentWorkspace
            session={active}
            busy={busy}
            attentionItems={attentionItems}
            chatgptAttentionNonce={nonce}
            inspectorAttention={inspectorAttention}
            singlePane={singlePane}
            onOpenAttention={openAttention}
            onAttentionAction={runAttention}
            onOpenAttentionDrawer={() => setDrawer('attention')}
            railVisible={railVisible}
            onExportChat={onExportChat}
            onReorderChat={onReorderChat}
            {...workspaceProps}
            chatProps={{
              session: active, items: [], chats, archivedChats, activeChatId: 'chat-1', busy,
              onSend: async () => undefined, onNewChat: async () => undefined, onSelectChat, onArchiveChat: async () => undefined, onRestoreChat: onRestore, onDeleteArchivedChat: onDelete,
              ...chatOverride,
            } as ComponentProps<typeof AgentWorkspace>['chatProps']}
            inspectorProps={{
              config: { planner: 'openai', sandbox: 'docker', model: 'test', api_configured: true, chatgpt_web_embed: false }, session: active, events: [], manualPrompt: '', busy,
              onChatGPTURL: () => true, onExecute, onRetryDependencyNetwork, onRetryHostDependencyRepair, onRejectPendingChanges: async () => undefined, onManualPlan: async () => undefined, onPlanFile: async () => '', onBundleFile: async () => '', onSession: () => undefined,
              ...inspectorOverride,
            } as ComponentProps<typeof AgentWorkspace>['inspectorProps']}
            />
          </div>
        </div>
        {railVisible && <WorkspaceSideRail {...sharedRailProps} side="right" tools={['project', 'database']} drawer="" onDrawer={() => undefined}/>}
      </div>
    </div>
  }

  return {
    onExecute, onRetryDependencyNetwork, onRetryHostDependencyRepair, onApply, onRestore, onDelete, onOpenFile, onExportChat, onSelectChat, onReorderChat,
    Harness,
    element: <Harness />,
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

  it('keeps chat tabs visible while switching single-pane Agent surfaces', () => {
    const view = props()
    const rendered = render(<view.Harness singlePane />)
    const areas = screen.getByRole('navigation', { name: 'Áreas do Agent' })
    const chat = within(areas).getByRole('button', { name: 'Chat' })

    expect(rendered.container.querySelector('.agent-workspace.single-pane')).toBeTruthy()
    expect(chat.className).toContain('active')
    expect(rendered.container.querySelector('.agent-inspector-stage.surface-hidden')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Redimensionar chat e Engine' })).toBeNull()
    const chatSwitcher = screen.getByRole('navigation', { name: 'Conversas do Harness' })
    expect(chatSwitcher.className).not.toContain('surface-hidden')

    fireEvent.click(within(areas).getByRole('button', { name: 'Engine' }))
    expect(rendered.container.querySelector('.agent-chat-stage.surface-hidden')).toBeTruthy()
    expect(rendered.container.querySelector('.agent-inspector-stage.surface-hidden')).toBeNull()
    expect(chatSwitcher.className).not.toContain('surface-hidden')
    expect(within(chatSwitcher).getByRole('button', { name: /^Principal$/ })).toBeTruthy()

    fireEvent.click(within(areas).getByRole('button', { name: 'Plano' }))
    expect(chatSwitcher.className).not.toContain('surface-hidden')
    expect(within(chatSwitcher).getByRole('button', { name: /^Principal$/ })).toBeTruthy()
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
    expect(within(screen.getByRole('navigation', { name: 'Conversas do Harness' })).getByRole('navigation', { name: 'Áreas do Agent' })).toBeTruthy()
  })

  it('puts save and split actions on the chat tab context menu', () => {
    const view = props()
    const onSaveChat = vi.fn(async () => undefined)
    const onSplitChat = vi.fn()
    render(<view.Harness chatProps={{ onSaveChat }} workspaceProps={{ onSplitChat }} />)

    fireEvent.contextMenu(screen.getByRole('button', { name: /^Principal/ }))
    expect(screen.getByRole('menu', { name: 'Ações da tab de chat' })).toBeTruthy()
    fireEvent.click(screen.getByRole('menuitem', { name: /Guardar em standby/ }))
    expect(onSaveChat.mock.calls).toEqual([['chat-1']])

    fireEvent.contextMenu(screen.getByRole('button', { name: /^Principal/ }))
    fireEvent.click(screen.getByRole('menuitem', { name: /Dividir à direita/ }))
    expect(onSplitChat.mock.calls).toEqual([['chat-1', 'vertical']])

    fireEvent.contextMenu(screen.getByRole('button', { name: /^Principal/ }))
    fireEvent.click(screen.getByRole('menuitem', { name: /Dividir abaixo/ }))
    expect(onSplitChat.mock.calls).toEqual([['chat-1', 'vertical'], ['chat-1', 'horizontal']])
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
    const execute = screen.getByRole('button', { name: 'Aceitar e executar' })
    fireEvent.click(execute)
    expect(view.onExecute).toHaveBeenCalledWith(true)
    fireEvent.click(screen.getByRole('button', { name: /^Plano(?: ·|$)/ }))
    expect(screen.getByText('Atualizar UI')).toBeTruthy()
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

  it('moves chat files into the inspector group immediately before Plano', async () => {
    const rendered = render(props().element)
    const agentAreas = screen.getByRole('navigation', { name: 'Áreas do Agent' })
    const files = screen.getByRole('button', { name: 'Ficheiros' })
    const plan = screen.getByRole('button', { name: /^Plano(?: ·|$)/ })

    expect(files.parentElement).toBe(agentAreas)
    expect(files.nextElementSibling).toBe(plan)
    expect(rendered.container.querySelector('.agent-chat-stage .chat-content-tabs')).toBeNull()

    fireEvent.click(files)

    const library = screen.getByRole('region', { name: 'Ficheiros do chat' })
    expect(library.closest('.agent-inspector-stage')).toBeTruthy()
    expect(await screen.findByText('Nenhum ficheiro neste chat')).toBeTruthy()
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

  it('lets users manually reorder chat tabs by drag and keyboard', () => {
    const view = props()
    render(view.element)
    const primary = screen.getByRole('button', { name: 'Principal' })
    const parallel = screen.getByRole('button', { name: 'Paralelo' })
    const source = primary.closest('.chat-tab-group') as HTMLDivElement
    const target = parallel.closest('.chat-tab-group') as HTMLDivElement
    const data = new Map<string, string>()
    const dataTransfer = {
      effectAllowed: 'none', dropEffect: 'none',
      setData: (type: string, value: string) => data.set(type, value),
      getData: (type: string) => data.get(type) || '',
    }
    fireEvent.dragStart(source, { dataTransfer })
    fireEvent.dragEnter(target, { dataTransfer })
    fireEvent.dragOver(target, { dataTransfer })
    fireEvent.drop(target, { dataTransfer })
    expect(view.onReorderChat).toHaveBeenCalledWith('chat-1', 'chat-2')

    view.onReorderChat.mockClear()
    fireEvent.keyDown(primary, { key: 'ArrowRight', altKey: true })
    expect(view.onReorderChat).toHaveBeenCalledWith('chat-1', 'chat-2')
  })

  it('lists out-of-view chats in a fixed overflow menu and keeps reorder/save/archive actions', async () => {
    const view = props()
    const save = vi.fn(async () => undefined)
    const archive = vi.fn(async () => undefined)
    const chats = [
      { id: 'chat-1', title: 'Principal', sessionId: 'ses-agent', createdAt: '2026-09-04T10:00:00.000Z', updatedAt: '2026-09-04T10:00:00.000Z' },
      { id: 'chat-2', title: 'Paralelo', sessionId: 'ses-parallel', createdAt: '2026-09-04T09:00:00.000Z', updatedAt: '2026-09-04T09:00:00.000Z' },
      { id: 'chat-3', title: 'Terceiro', sessionId: 'ses-third', createdAt: '2026-09-04T08:00:00.000Z', updatedAt: '2026-09-04T08:00:00.000Z' },
    ]
    const rect = (left: number, right: number) => ({ left, right, top: 0, bottom: 32, x: left, y: 0, width: right - left, height: 32, toJSON: () => ({}) } as DOMRect)
    const geometry = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      if (this.classList.contains('agent-workspace')) return rect(0, 1_200)
      if (this.classList.contains('chat-tabs')) return rect(0, 160)
      if (this.dataset.chatId === 'chat-1') return rect(0, 80)
      if (this.dataset.chatId === 'chat-2') return rect(80, 160)
      if (this.dataset.chatId === 'chat-3') return rect(160, 240)
      return rect(0, 40)
    })
    render(<view.Harness chatProps={{ chats, onSaveChat: save, onArchiveChat: archive }} />)

    const overflow = await screen.findByRole('button', { name: 'Chats fora da área visível, 1' })
    fireEvent.click(overflow)
    const menu = screen.getByRole('menu', { name: 'Chats não visíveis' })
    expect(within(menu).getByRole('menuitem', { name: 'Abrir chat Terceiro' })).toBeTruthy()
    fireEvent.click(within(menu).getByRole('button', { name: 'Guardar chat Terceiro' }))
    expect(save).toHaveBeenCalledWith('chat-3')
    fireEvent.click(within(menu).getByRole('button', { name: 'Fechar e arquivar chat Terceiro' }))
    expect(archive).toHaveBeenCalledWith('chat-3')

    const data = new Map<string, string>()
    const dataTransfer = { effectAllowed: 'none', dropEffect: 'none', setData: (type: string, value: string) => data.set(type, value), getData: (type: string) => data.get(type) || '' }
    const hiddenRow = within(menu).getByRole('menuitem', { name: 'Abrir chat Terceiro' }).closest('.chat-overflow-row') as HTMLDivElement
    const visibleTarget = screen.getByRole('button', { name: 'Principal' }).closest('.chat-tab-group') as HTMLDivElement
    fireEvent.dragStart(hiddenRow, { dataTransfer })
    fireEvent.dragEnter(visibleTarget, { dataTransfer })
    fireEvent.dragOver(visibleTarget, { dataTransfer })
    fireEvent.drop(visibleTarget, { dataTransfer })
    expect(view.onReorderChat).toHaveBeenCalledWith('chat-3', 'chat-1')
    geometry.mockRestore()
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

  it('does not expose a second host-apply approval for a verified candidate', () => {
    const ready = session()
    ready.state = 'verified'
    ready.pending_host_changes = [{
      plan: ready.plan!,
      execution: { plan_id: 'plan-agent', success: true, started_at: '2026-09-07T10:00:00.000Z', completed_at: '2026-09-07T10:00:01.000Z', commands: [] },
      verified_at: '2026-09-07T10:00:01.000Z',
    }]
    const view = props(ready)
    render(<view.Harness attentionSessions={{ 'chat-1': ready }} />)
    expect(screen.queryByRole('button', { name: 'Aplicar no host' })).toBeNull()
    expect(screen.getByText('Integração pendente de recuperação')).toBeTruthy()
    expect(screen.getByRole('button', { name: /^Plano(?: ·|$)/ }).className).not.toContain('attention-success')
    expect(view.onApply).not.toHaveBeenCalled()
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

  it('uses each popover alert as a link to its owning chat and surface', async () => {
    const current = session()
    const parallel = session()
    parallel.id = 'ses-parallel'
    parallel.interrupted_execution = { plan_id: 'plan-parallel', status: 'awaiting_decision', requested_at: '2026-09-07T10:00:01.000Z', approved: false }
    const view = props(current)
    render(<view.Harness attentionSessions={{ 'chat-1': current, 'chat-2': parallel }} />)
    fireEvent(window, new CustomEvent('wharnex:open-attention-drawer'))
    fireEvent.click(screen.getByRole('button', { name: /Paralelo.*Execução interrompida/ }))
    await waitFor(() => expect(view.onSelectChat).toHaveBeenCalledWith('chat-2'))
    // Routing goes through the shell's inspectorAttention channel, so the tab
    // switch lands on the state update that follows the chat selection.
    await waitFor(() => expect(screen.getByRole('button', { name: /^Execução(?: ·|$)/ }).className).toContain('active'))
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

  it('shows a non-actionable toolchain alert inside the popover', () => {
    const blocked = session()
    blocked.state = 'failed'
    blocked.failure_kind = 'host_build_toolchain_mismatch'
    blocked.last_repair_error = 'self-evolution host build failed: Electron failed to install correctly.'
    const view = props(blocked)
    render(<view.Harness attentionSessions={{ 'chat-1': blocked }} />)
    expect(screen.getByRole('button', { name: /^Execução(?: ·|$)/ }).className).toContain('attention-danger')
    fireEvent(window, new CustomEvent('wharnex:open-attention-drawer'))
    expect(screen.getByText('Build do host bloqueado')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Permitir rede e repetir' })).toBeNull()
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

  it('routes human ChatGPT attention through the popover and highlights Engine', async () => {
    const current = session()
    const onHumanAction = vi.fn()
    const notice: DesktopChatGPTHumanAction = { cacheKey: 'chat-1', active: true, kind: 'verification', source: 'dom', message: 'Conclua a verificação humana.', detectedAt: '2026-09-05T13:00:00.000Z' }
    const view = props(current, { notice, nonce: 0, onAction: onHumanAction })
    const { rerender } = render(<view.Harness attentionSessions={{ 'chat-1': current }} chatgptHumanActions={{ 'chat-1': notice }} />)
    expect(screen.queryByRole('button', { name: 'Ação humana necessária no ChatGPT' })).toBeNull()
    expect(screen.getByRole('button', { name: /^Engine(?: ·|$)/ }).className).toContain('attention-warning')
    fireEvent(window, new CustomEvent('wharnex:open-attention-drawer'))
    fireEvent.click(screen.getByRole('button', { name: /Principal.*Ação humana necessária no ChatGPT/ }))
    expect(onHumanAction).toHaveBeenCalledTimes(1)
    rerender(<view.Harness attentionSessions={{ 'chat-1': current }} chatgptHumanActions={{ 'chat-1': notice }} nonce={1} />)
    await waitFor(() => expect(screen.getByRole('button', { name: /^Engine(?: ·|$)/ }).className).toContain('active'))
  })

  it('keeps execution status stable instead of blinking while a command is running', () => {
    const view = props()
    const started: HarnessEvent = { id: 'evt-started', session_id: 'ses-agent', type: 'command.started', timestamp: '2026-09-08T15:30:00.000Z', data: { run_id: 'run-1', argv: ['npm', 'test'], cwd: 'services/frontend' } }
    const completed: HarnessEvent = { id: 'evt-completed', session_id: 'ses-agent', type: 'command.completed', timestamp: '2026-09-08T15:30:01.000Z', data: { run_id: 'run-1', argv: ['npm', 'test'], cwd: 'services/frontend', exit_code: 0, success: true } }
    const workspace = (events: HarnessEvent[]) => <view.Harness inspectorProps={{ events }} />
    const rendered = render(workspace([started]))
    expect(screen.getByRole('button', { name: 'Execução' }).className).not.toContain('execution-pulse')

    fireEvent.click(screen.getByRole('button', { name: 'Execução' }))
    expect(screen.getByRole('button', { name: 'Execução' }).className).not.toContain('execution-pulse')

    fireEvent.click(screen.getByRole('button', { name: 'Plano' }))
    expect(screen.getByRole('button', { name: 'Execução' }).className).not.toContain('execution-pulse')
    rendered.rerender(workspace([started, completed]))
    expect(screen.getByRole('button', { name: 'Execução' }).className).not.toContain('execution-pulse')
  })

  it('focuses the execution inspector when an external recovery action requests logs', async () => {
    const view = props()
    const rendered = render(view.element)
    rendered.rerender(<view.Harness recoveryTab="terminal" />)
    await waitFor(() => expect(screen.getByRole('button', { name: 'Execução' }).className).toContain('active'))
  })

  it('exports the active chat from the fixed chat header', () => {
    const view = props()
    render(view.element)
    const exportButton = screen.getByRole('button', { name: 'Exportar ZIP' })
    expect((exportButton as HTMLButtonElement).disabled).toBe(false)
    expect(exportButton.textContent).toBe('')
    expect(exportButton.closest('header')?.className).toContain('chat-header')
    expect(exportButton.closest('.chat-header-context')).toBeTruthy()
    expect(exportButton.closest('.agent-activity-bar')).toBeNull()
    expect(screen.queryByRole('heading', { name: 'Principal' })).toBeNull()
    expect(screen.getByRole('button', { name: /^Principal$/ })).toBeTruthy()
    fireEvent.click(exportButton)
    expect(view.onExportChat).toHaveBeenCalledTimes(1)
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

  it('opens archived chats from the left activity drawer', () => {
    const view = props()
    render(view.element)
    fireEvent.click(screen.getByRole('button', { name: 'Gestão de chats' }))
    expect(screen.getByRole('tab', { name: /Guardados/ }).querySelector('svg')).toBeTruthy()
    expect(screen.getByRole('tab', { name: /Arquivados/ }).querySelector('svg')).toBeTruthy()
    expect(screen.getByText('Diagnóstico antigo')).toBeTruthy()
    fireEvent.click(screen.getByText('Diagnóstico antigo'))
    fireEvent.click(screen.getByRole('button', { name: 'Restaurar chat' }))
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
    expect((screen.getByRole('button', { name: /^Paralelo$/ }) as HTMLButtonElement).disabled).toBe(false)
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
    const agentAreas = screen.getByRole('navigation', { name: 'Áreas do Agent' })
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
      project_path: '/workspace/wharness',
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
