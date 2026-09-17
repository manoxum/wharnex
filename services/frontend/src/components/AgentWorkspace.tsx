import { useEffect, useRef, useState, type ComponentProps } from 'react'
import type { BundleQuota, Session } from '../types'
import { ChatPanel, type ChatPanelHandle } from './ChatPanel'
import type { ChatViewportStore } from './useProgressiveChatHistory'
import { Inspector, type InspectorTab } from './Inspector'
import { Icon } from './Icon'
import { desktopWindowScope } from '../lib/projectBindings'
import { summarizeAttention, type AttentionItem, type AttentionTarget, type AttentionTone } from '../lib/attentionCenter'
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
  const chatPanelRef = useRef<ChatPanelHandle>(null)
  const [chatWidth, setChatWidth] = useState(loadAgentChatWidth)
  const [draggedChatId, setDraggedChatId] = useState('')
  const [dropTargetChatId, setDropTargetChatId] = useState('')
  const [bundleQuota, setBundleQuota] = useState<BundleQuota>()
  const archived = chatProps.archivedChats || []
  const attentionSummary = summarizeAttention(attentionItems)
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
    return [inspectorTab === target ? 'active' : '', tone ? `has-attention attention-${tone}` : ''].filter(Boolean).join(' ')
  }

  function surfaceAttention(target: AttentionTarget) {
    return attentionItems.filter((item) => item.chatId === chatProps.activeChatId && item.target === target)
  }

  function surfaceTabTitle(target: AttentionTarget, fallback: string) {
    const items = surfaceAttention(target)
    return items.length ? `${fallback} · ${items.map((item) => item.title).join(' · ')}` : fallback
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

  // The chat width is published only once the operator has actually chosen it,
  // so an untouched layout falls through to the stylesheet's 60/40 default.
  return <section ref={workspaceRef} className="agent-workspace" style={chatWidth ? { '--agent-chat-width': `${chatWidth}px` } as React.CSSProperties : undefined}>
    <header className="agent-commandbar">
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
      </div>
      <nav className="agent-surface-tabs" aria-label="Áreas do Agent">
        <button className={inspectorTab === 'files' ? 'active' : ''} onClick={() => openInspector('files')} title="Ficheiros" aria-label="Ficheiros"><Icon name="folder" size={15}/></button>
        <button className={surfaceTabClass('plan')} onClick={() => openInspector('plan')} title={surfaceTabTitle('plan', 'Plano')} aria-label={surfaceTabTitle('plan', 'Plano')}><Icon name="plan" size={15}/>{surfaceAttention('plan').length > 0 && <span className="surface-attention-count">{surfaceAttention('plan').length}</span>}</button>
        <button className={surfaceTabClass('terminal')} onClick={() => openInspector('terminal')} title={surfaceTabTitle('terminal', 'Execução')} aria-label={surfaceTabTitle('terminal', 'Execução')}><Icon name="terminal" size={15}/>{surfaceAttention('terminal').length > 0 && <span className="surface-attention-count">{surfaceAttention('terminal').length}</span>}</button>
        <button className={surfaceTabClass('chatgpt')} onClick={() => openInspector('chatgpt')} title={surfaceTabTitle('chatgpt', session.integration_conflict ? 'Conflito Engine' : 'Engine')} aria-label={surfaceTabTitle('chatgpt', session.integration_conflict ? 'Conflito Engine' : 'Engine')}><Icon name="agent" size={15}/>{surfaceAttention('chatgpt').length > 0 && <span className="surface-attention-count">{surfaceAttention('chatgpt').length}</span>}</button>
      </nav>
      <nav className="agent-direct-chatgpt-tab" aria-label="ChatGPT direto">
        <button className={inspectorTab === 'direct-chatgpt' ? 'active' : ''} onClick={() => openInspector('direct-chatgpt')} title="ChatGPT" aria-label="ChatGPT"><Icon name="chatgpt" size={15}/></button>
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

    <div className="agent-chat-stage"><ChatPanel ref={chatPanelRef} key={chatProps.activeChatId} {...chatProps} historyViewportStore={chatViewportStoreRef.current} embedded hideSwitcher onExportChat={onExportChat} /></div>
    <button type="button" className="agent-splitter" aria-label="Redimensionar chat e Engine" title="Arraste para redimensionar" onPointerDown={beginResize}/>
    <div className="agent-inspector-stage"><Inspector {...inspectorProps} embedded activeTab={inspectorTab} onTabChange={openInspector} onAdjustExecutionPlan={() => { if (session.plan) chatPanelRef.current?.prepareExecutionPlanAdjustment(session.plan) }} /></div>
  </section>
}

function AgentBundleCounters({ quota }: { quota: BundleQuota }) {
  const detail = `Bundles: ${quota.sent} enviados ao ChatGPT e ${quota.received} recebidos do ChatGPT.`
  return <div className="agent-bundle-counters" role="group" aria-label={detail} title={detail}>
    <span title="Bundles enviados"><i aria-hidden="true">↑</i><b>{quota.sent}</b></span>
    <span title="Bundles recebidos"><i aria-hidden="true">↓</i><b>{quota.received}</b></span>
  </div>
}
