import { useEffect, useMemo, useRef, useState, type ComponentProps } from 'react'
import type { BundleQuota, HarnessEvent, Session } from '../types'
import { ChatPanel } from './ChatPanel'
import type { ChatViewportStore } from './useProgressiveChatHistory'
import { Inspector, type InspectorTab } from './Inspector'
import { Icon } from './Icon'
import { desktopWindowScope } from '../lib/projectBindings'
import { ATTENTION_ACTION_LABEL, sessionCanApplyHost, sessionHostResolutionBlocked, summarizeAttention, type AttentionItem, type AttentionTarget, type AttentionTone } from '../lib/attentionCenter'
import { AttentionPopover } from './AttentionPopover'
import { api } from '../lib/api'

const AGENT_CHAT_WIDTH_KEY = 'whx.agent.chat-width'
const AGENT_CHAT_WIDTH_PREFIX = `${AGENT_CHAT_WIDTH_KEY}:`
const AGENT_CHAT_WIDTH_MIGRATION_KEY = 'whx.agent.chat-width.scoped-v1'

function agentChatWidthStorageKey() { return `${AGENT_CHAT_WIDTH_PREFIX}${desktopWindowScope()}` }

function loadAgentChatWidth() {
  try {
    const storageKey = agentChatWidthStorageKey()
    const scoped = Number(localStorage.getItem(storageKey)) || 0
    if (scoped) return scoped
    if (localStorage.getItem(AGENT_CHAT_WIDTH_MIGRATION_KEY) === '1') return 0
    const legacy = Number(localStorage.getItem(AGENT_CHAT_WIDTH_KEY)) || 0
    localStorage.setItem(AGENT_CHAT_WIDTH_MIGRATION_KEY, '1')
    localStorage.removeItem(AGENT_CHAT_WIDTH_KEY)
    if (legacy) localStorage.setItem(storageKey, String(legacy))
    return legacy
  } catch { return 0 }
}

function saveAgentChatWidth(width: number) {
  try { localStorage.setItem(agentChatWidthStorageKey(), String(width)) } catch { /* best effort */ }
}

// Kept in step with the grid in styles.css: the splitter width and the minimum
// a panel may be squeezed to. The activity rail is no longer part of this grid
// — it belongs to the shell, beside every mode surface.
const AGENT_SPLITTER_PX = 6
const AGENT_PANEL_MIN_PX = 320


export function AgentWorkspace({ session, busy, attentionItems = [], chatgptAttentionNonce = 0, inspectorAttention, onOpenAttention, onAttentionAction, onOpenAttentionDrawer, chatProps, inspectorProps, onExportChat, onReorderChat }: {
  session: Session
  busy: boolean
  attentionItems?: AttentionItem[]
  chatgptAttentionNonce?: number
  inspectorAttention?: { tab: InspectorTab; nonce: number }
  onOpenAttention: (item: AttentionItem) => Promise<void>
  onAttentionAction: (item: AttentionItem) => Promise<void>
  onOpenAttentionDrawer: () => void
  chatProps: ComponentProps<typeof ChatPanel>
  inspectorProps: ComponentProps<typeof Inspector>
  onExportChat?: () => Promise<void>
  onReorderChat: (sourceChatId: string, targetChatId: string) => void
}) {
  const [inspectorTab, setInspectorTab] = useState<InspectorTab>(inspectorProps.config?.planner === 'manual' ? 'chatgpt' : 'plan')
  const [attentionPopoverOpen, setAttentionPopoverOpen] = useState(false)
  const workspaceRef = useRef<HTMLElement>(null)
  const attentionClusterRef = useRef<HTMLDivElement>(null)
  const attentionTriggerRef = useRef<HTMLButtonElement>(null)
  const chatViewportStoreRef = useRef<ChatViewportStore>(new Map())
  const [chatWidth, setChatWidth] = useState(loadAgentChatWidth)
  const [draggedChatId, setDraggedChatId] = useState('')
  const [dropTargetChatId, setDropTargetChatId] = useState('')
  const [bundleQuota, setBundleQuota] = useState<BundleQuota>()
  const archived = chatProps.archivedChats || []
  const attentionSummary = summarizeAttention(attentionItems)
  const activeCommandAttention = attentionItems.find((item) => item.chatId === chatProps.activeChatId && item.action && item.action !== 'apply-host')
  const executionCommandRunning = useMemo(() => hasRunningExecutionCommand(inspectorProps.events), [inspectorProps.events])
  useEffect(() => {
    let alive = true
    const refresh = () => { void api.bundleQuota().then((value) => { if (alive) setBundleQuota(value) }).catch(() => {}) }
    refresh()
    const timer = window.setInterval(refresh, 60_000)
    return () => { alive = false; window.clearInterval(timer) }
  }, [session.id, session.artifacts?.length])
  useEffect(() => {
    if (!attentionPopoverOpen) return
    const closeOnOutsidePointer = (event: PointerEvent) => {
      if (!attentionClusterRef.current?.contains(event.target as Node)) setAttentionPopoverOpen(false)
    }
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      setAttentionPopoverOpen(false)
      attentionTriggerRef.current?.focus()
    }
    document.addEventListener('pointerdown', closeOnOutsidePointer)
    document.addEventListener('keydown', closeOnEscape)
    return () => {
      document.removeEventListener('pointerdown', closeOnOutsidePointer)
      document.removeEventListener('keydown', closeOnEscape)
    }
  }, [attentionPopoverOpen])
  useEffect(() => { if (!attentionItems.length) setAttentionPopoverOpen(false) }, [attentionItems.length])
  // Attention routing switches the inspector to the surface that needs a human,
  // but it never dismisses the left panel: the drawer closes only when the
  // operator asks it to, so incoming attention cannot pull away the plans,
  // runtime or Git view they were reading.
  useEffect(() => {
    if (!chatgptAttentionNonce) return
    setInspectorTab('chatgpt')
  }, [chatgptAttentionNonce])
  useEffect(() => {
    if (!inspectorAttention?.nonce) return
    setInspectorTab(inspectorAttention.tab)
  }, [inspectorAttention])
  const canExecute = Boolean(session.plan && session.policy?.allowed && ['planned', 'failed'].includes(session.state) && session.last_turn?.kind !== 'workflow')
  const needsApproval = Boolean(session.policy?.requires_approval)
  const direct = session.execution_mode === 'unprotected'
  const pendingCount = session.pending_host_changes?.length || 0
  const canApply = sessionCanApplyHost(session)
  const canReject = Boolean(!direct && pendingCount && (!sessionHostResolutionBlocked(session) || session.integration_conflict))

  function openInspector(tab: InspectorTab) {
    setInspectorTab(tab)
  }

  async function openAttention(item: AttentionItem) {
    setAttentionPopoverOpen(false)
    await onOpenAttention(item)
  }

  async function runAttentionAction(item: AttentionItem) {
    setAttentionPopoverOpen(false)
    await onAttentionAction(item)
  }

  function openAllAttention() {
    setAttentionPopoverOpen(false)
    onOpenAttentionDrawer()
  }

  function closeAttentionPopover() {
    setAttentionPopoverOpen(false)
    attentionTriggerRef.current?.focus()
  }

  function attentionTone(target: AttentionTarget): AttentionTone | undefined {
    const tones = attentionItems.filter((item) => item.chatId === chatProps.activeChatId && item.target === target).map((item) => item.tone)
    if (tones.includes('danger')) return 'danger'
    if (tones.includes('warning')) return 'warning'
    if (tones.includes('success')) return 'success'
    return undefined
  }

  function surfaceTabClass(target: AttentionTarget) {
    const tone = attentionTone(target)
    const executionPulse = target === 'terminal' && inspectorTab !== 'terminal' && executionCommandRunning && !tone
    return [inspectorTab === target ? 'active' : '', tone ? `attention-pulse attention-${tone}` : '', executionPulse ? 'execution-pulse' : ''].filter(Boolean).join(' ')
  }

  function beginChatDrag(event: React.DragEvent<HTMLDivElement>, chatId: string) {
    setDraggedChatId(chatId)
    setDropTargetChatId('')
    event.dataTransfer.effectAllowed = 'move'
    event.dataTransfer.setData('text/plain', chatId)
  }

  function dropChat(event: React.DragEvent<HTMLDivElement>, targetChatId: string) {
    event.preventDefault()
    const sourceChatId = draggedChatId || event.dataTransfer.getData('text/plain')
    setDraggedChatId('')
    setDropTargetChatId('')
    if (sourceChatId && sourceChatId !== targetChatId) onReorderChat(sourceChatId, targetChatId)
  }

  function moveChatWithKeyboard(event: React.KeyboardEvent<HTMLButtonElement>, chatId: string) {
    if (!event.altKey || (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight')) return
    const index = chatProps.chats.findIndex((chat) => chat.id === chatId)
    const target = chatProps.chats[index + (event.key === 'ArrowLeft' ? -1 : 1)]
    if (!target) return
    event.preventDefault()
    onReorderChat(chatId, target.id)
  }

  function trackPointerDrag(event: React.PointerEvent<HTMLButtonElement>, update: (clientX: number) => void) {
    event.currentTarget.setPointerCapture(event.pointerId)
    const move = (moveEvent: PointerEvent) => update(moveEvent.clientX)
    const finish = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', finish) }
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', finish)
  }

  function beginResize(event: React.PointerEvent<HTMLButtonElement>) {
    const root = workspaceRef.current
    if (!root) return
    const rect = root.getBoundingClientRect()
    // The activity rail and the side drawer are the shell's, outside this grid,
    // so the chat column starts at this element's own left edge.
    trackPointerDrag(event, (clientX) => {
      const available = Math.max(AGENT_PANEL_MIN_PX * 2, rect.width - AGENT_SPLITTER_PX)
      const next = Math.round(Math.max(AGENT_PANEL_MIN_PX, Math.min(available - AGENT_PANEL_MIN_PX, clientX - rect.left)))
      setChatWidth(next); saveAgentChatWidth(next)
    })
  }

  const executeLabel = direct ? 'Executar plano diretamente no host' : needsApproval ? 'Aprovar e executar plano' : 'Executar plano na sandbox'

  // The chat width is published only once the operator has actually chosen it,
  // so an untouched layout falls through to the stylesheet's 60/40 default.
  return <section ref={workspaceRef} className="agent-workspace" style={chatWidth ? { '--agent-chat-width': `${chatWidth}px` } as React.CSSProperties : undefined}>
    <header className="agent-commandbar">
      <nav className="agent-direct-chatgpt-tab" aria-label="ChatGPT direto">
        <button className={inspectorTab === 'direct-chatgpt' ? 'active' : ''} onClick={() => openInspector('direct-chatgpt')} title="ChatGPT" aria-label="ChatGPT"><Icon name="chatgpt" size={15}/></button>
      </nav>
      {(session.self_evolution || session.wharnex_instance_id) && <div className="agent-commandbar-center">
        <span className="self-evolution-badge"><Icon name="refresh" size={13}/>{session.self_evolution ? ' WHX · AUTO-EVOLUÇÃO' : ` WHX · EVOLUÇÃO DA INSTÂNCIA ${session.wharnex_instance_id}`}</span>
      </div>}
      <div className="agent-command-actions">
        {bundleQuota && <AgentBundleCounters quota={bundleQuota}/>}
        <span className="sr-only" role="status" aria-live="polite" aria-atomic="true">{attentionSummary.total} {attentionSummary.total === 1 ? 'alerta ativo' : 'alertas ativos'}; {attentionSummary.urgent} {attentionSummary.urgent === 1 ? 'urgente' : 'urgentes'}; {attentionSummary.actionable} com ação disponível.</span>
        {attentionItems.length > 0 && <div className="agent-attention-cluster" ref={attentionClusterRef}>
          <button ref={attentionTriggerRef} type="button" className={`agent-attention-summary ${attentionSummary.urgent ? 'urgent' : ''}`} onClick={() => setAttentionPopoverOpen((open) => !open)} aria-expanded={attentionPopoverOpen} aria-haspopup="dialog" aria-controls="agent-attention-popover" aria-label={`Centro de notificações, ${attentionSummary.total} alerta(s), ${attentionSummary.urgent} urgente(s), ${attentionSummary.actionable} com ação`} title="Centro de Alertas · todos os chats deste projeto"><Icon name="bell" size={14}/><span><b>{attentionSummary.total} {attentionSummary.total === 1 ? 'alerta' : 'alertas'}</b><small>{attentionSummary.urgent} {attentionSummary.urgent === 1 ? 'urgente' : 'urgentes'}</small></span></button>
          {attentionPopoverOpen && <AttentionPopover items={attentionItems} activeChatId={chatProps.activeChatId} busy={busy} onOpen={openAttention} onAction={runAttentionAction} onOpenAll={openAllAttention} onClose={closeAttentionPopover}/>}
        </div>}
        {session.policy && <span className={`agent-policy-icon ${session.policy.allowed ? '' : 'blocked'}`} title={session.policy.allowed ? `Policy autorizada · risco ${session.policy.risk}` : 'Policy bloqueada'} aria-label={session.policy.allowed ? `Policy autorizada, risco ${session.policy.risk}` : 'Policy bloqueada'}><Icon name="shield" size={14}/></span>}
        {canExecute && !needsApproval && <button type="button" className={`agent-command-icon ${direct ? 'danger' : ''}`} disabled={busy} onClick={() => void inspectorProps.onExecute(direct)} aria-label={executeLabel} title={executeLabel}><Icon name="play" size={15}/></button>}
        {canApply && activeCommandAttention?.action !== 'retry-host-apply' && <button type="button" className="agent-command-icon apply" disabled={busy} onClick={() => void inspectorProps.onApply()} aria-label="Aplicar alterações verificadas no host" title={`Aplicar ${pendingCount > 1 ? `${pendingCount} alterações verificadas` : 'alteração verificada'} no host`}><Icon name="apply" size={15}/>{pendingCount > 1 && <b>{pendingCount}</b>}</button>}
        {activeCommandAttention?.action && <button type="button" className={`agent-command-icon attention ${activeCommandAttention.tone}`} disabled={busy} onClick={() => void runAttentionAction(activeCommandAttention)} aria-label={`Ação disponível: ${ATTENTION_ACTION_LABEL[activeCommandAttention.action]}`} title={`${activeCommandAttention.title} · ${ATTENTION_ACTION_LABEL[activeCommandAttention.action]}`}><Icon name={activeCommandAttention.action.includes('host') ? 'apply' : activeCommandAttention.action.includes('dependency') || activeCommandAttention.action === 'retry-transport' ? 'network' : 'play'} size={15}/></button>}
        {canReject && <button type="button" className="agent-command-icon reject" disabled={busy} onClick={() => void inspectorProps.onRejectPendingChanges?.()} aria-label={session.integration_conflict ? 'Cancelar resolução e rejeitar alterações' : 'Rejeitar alterações verificadas'} title={session.integration_conflict ? 'Cancelar conflito e rejeitar a candidata' : 'Rejeitar alterações verificadas'}><Icon name="trash" size={14}/></button>}
      </div>
      <nav className="agent-surface-tabs" aria-label="Áreas do Agent">
        <button className={surfaceTabClass('plan')} onClick={() => openInspector('plan')} title="Plano" aria-label="Plano"><Icon name="plan" size={15}/></button>
        <button className={surfaceTabClass('terminal')} onClick={() => openInspector('terminal')} title="Execução" aria-label="Execução"><Icon name="terminal" size={15}/></button>
        <button className={surfaceTabClass('chatgpt')} onClick={() => openInspector('chatgpt')} title={session.integration_conflict ? 'Conflito Engine' : 'Engine'} aria-label={session.integration_conflict ? 'Conflito Engine' : 'Engine'}><Icon name="agent" size={15}/></button>
      </nav>
    </header>

    <nav className="agent-chat-switcher" aria-label="Conversas do Harness">
      <button className="chat-new-button" onClick={() => void chatProps.onNewChat()} title="Novo chat" aria-label="Novo chat"><Icon name="plus" size={14}/></button>
      {archived.length > 0 && <button className="chat-new-button chat-reopen-button" disabled={busy} onClick={() => void chatProps.onRestoreChat(archived[0].id)} title={`Reabrir último chat fechado: ${archived[0].title}`} aria-label="Reabrir último chat fechado"><Icon name="refresh" size={13}/></button>}
      <div className="chat-tabs">
        {chatProps.chats.map((chat) => <div
          key={chat.id}
          draggable
          className={[chat.id === chatProps.activeChatId ? 'chat-tab-group active' : 'chat-tab-group', chat.id === draggedChatId ? 'dragging' : '', chat.id === dropTargetChatId ? 'drop-target' : ''].filter(Boolean).join(' ')}
          onDragStart={(event) => beginChatDrag(event, chat.id)}
          onDragEnter={() => { if (draggedChatId && draggedChatId !== chat.id) setDropTargetChatId(chat.id) }}
          onDragOver={(event) => { if (draggedChatId && draggedChatId !== chat.id) { event.preventDefault(); event.dataTransfer.dropEffect = 'move' } }}
          onDrop={(event) => dropChat(event, chat.id)}
          onDragEnd={() => { setDraggedChatId(''); setDropTargetChatId('') }}
        >
          <button className={chat.id === chatProps.activeChatId ? 'chat-tab active' : 'chat-tab'} onClick={() => void chatProps.onSelectChat(chat.id)} onKeyDown={(event) => moveChatWithKeyboard(event, chat.id)} title={chat.chatgptUrl ? `${chat.title}\nChatGPT: ${chat.chatgptUrl}\nArraste para reordenar · Alt+←/→` : `${chat.title}\nChatGPT ainda não vinculado\nArraste para reordenar · Alt+←/→`}><span>{chat.title}</span><i className={chat.chatgptUrl ? 'chat-link-dot linked' : 'chat-link-dot'} aria-hidden="true" /></button>
          <button className="chat-tab-remove" disabled={busy} onClick={() => void chatProps.onArchiveChat(chat.id)} title={`Fechar e arquivar ${chat.title}`} aria-label={`Fechar e arquivar chat ${chat.title}`}><Icon name="close" size={11}/></button>
        </div>)}
      </div>
    </nav>

    <div className="agent-chat-stage"><ChatPanel key={chatProps.activeChatId} {...chatProps} historyViewportStore={chatViewportStoreRef.current} embedded hideSwitcher onExportChat={onExportChat} /></div>
    <button type="button" className="agent-splitter" aria-label="Redimensionar chat e Engine" title="Arraste para redimensionar" onPointerDown={beginResize}/>
    <div className="agent-inspector-stage"><Inspector {...inspectorProps} embedded activeTab={inspectorTab} onTabChange={openInspector} /></div>
  </section>
}

function AgentBundleCounters({ quota }: { quota: BundleQuota }) {
  const detail = `Bundles: ${quota.sent} enviados ao ChatGPT e ${quota.received} recebidos do ChatGPT.`
  return <div className="agent-bundle-counters" role="group" aria-label={detail} title={detail}>
    <span title="Bundles enviados"><i aria-hidden="true">↑</i><b>{quota.sent}</b></span>
    <span title="Bundles recebidos"><i aria-hidden="true">↓</i><b>{quota.received}</b></span>
  </div>
}

function hasRunningExecutionCommand(events: HarnessEvent[]) {
  const running = new Set<string>()
  for (const event of events) {
    const started = event.type === 'command.started' || event.type === 'host_dependency_repair.command_started'
    const completed = event.type === 'command.completed' || event.type === 'host_dependency_repair.command_completed'
    if (!started && !completed) continue
    const runID = typeof event.data.run_id === 'string' ? event.data.run_id : ''
    if (!runID) continue
    if (started) running.add(runID)
    else running.delete(runID)
  }
  return running.size > 0
}
