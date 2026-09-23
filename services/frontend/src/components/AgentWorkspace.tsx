import { useEffect, useLayoutEffect, useRef, useState, type ComponentProps } from 'react'
import { createPortal } from 'react-dom'
import { workspaceDragEndedOutside, type WorkspaceSurfaceTransferPoint } from '../lib/workspaceSurface'
import type { Session } from '../types'
import { ChatPanel, type ChatPanelHandle } from './ChatPanel'
import type { ChatViewportStore } from './useProgressiveChatHistory'
import { Inspector, type InspectorTab } from './Inspector'
import { Icon } from './Icon'
import { desktopWindowScope } from '../lib/projectBindings'
import { type AttentionItem, type AttentionTarget, type AttentionTone } from '../lib/attentionCenter'
import { boundedAgentChatWidth } from '../lib/agentLayout'

const AGENT_CHAT_WIDTH_KEY = 'whx.agent.chat-width'
const AGENT_CHAT_WIDTH_PREFIX = `${AGENT_CHAT_WIDTH_KEY}:`
const AGENT_CHAT_WIDTH_MIGRATION_KEY = 'whx.agent.chat-width.scoped-v1'
type AgentPaneFocus = 'chat' | 'inspector'

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
export function AgentWorkspace({ session, busy, attentionItems = [], chatgptAttentionNonce = 0, inspectorAttention, singlePane = false, onOpenAttentionDrawer, chatProps, inspectorProps, onExportChat, onReorderChat, railVisible = false, surfaceMode = false, minimalSurface = false, onDetachChat, onSplitChat }: {
  session: Session
  busy: boolean
  attentionItems?: AttentionItem[]
  chatgptAttentionNonce?: number
  inspectorAttention?: { tab: InspectorTab; nonce: number }
  singlePane?: boolean
  onOpenAttention: (item: AttentionItem) => Promise<void>
  onAttentionAction: (item: AttentionItem) => Promise<void>
  onOpenAttentionDrawer: () => void
  chatProps: ComponentProps<typeof ChatPanel>
  inspectorProps: ComponentProps<typeof Inspector>
  onExportChat?: () => Promise<void>
  onReorderChat: (sourceChatId: string, targetChatId: string) => void
  railVisible?: boolean
  surfaceMode?: boolean
  minimalSurface?: boolean
  onDetachChat?: (chatId: string, point?: WorkspaceSurfaceTransferPoint) => void
  onSplitChat?: (chatId: string, direction: 'vertical' | 'horizontal') => void
}) {
  const [inspectorTab, setInspectorTab] = useState<InspectorTab>(inspectorProps.config?.planner === 'manual' ? 'chatgpt' : 'plan')
  const [singlePaneSurface, setSinglePaneSurface] = useState<'chat' | 'inspector'>('chat')
  const [focusedPane, setFocusedPane] = useState<AgentPaneFocus>('chat')
  const workspaceRef = useRef<HTMLElement>(null)
  const [railTarget, setRailTarget] = useState<HTMLElement | null>(null)
  const chatTabsRef = useRef<HTMLDivElement>(null)
  const overflowRef = useRef<HTMLDivElement>(null)
  const overflowTriggerRef = useRef<HTMLButtonElement>(null)
  const chatViewportStoreRef = useRef<ChatViewportStore>(new Map())
  const chatPanelRef = useRef<ChatPanelHandle>(null)
  const [chatWidth, setChatWidth] = useState(loadAgentChatWidth)
  const [draggedChatId, setDraggedChatId] = useState('')
  const [dropTargetChatId, setDropTargetChatId] = useState('')
  const [hiddenChatIds, setHiddenChatIds] = useState<string[]>([])
  const [overflowOpen, setOverflowOpen] = useState(false)
  const [chatTabMenu, setChatTabMenu] = useState<{ chatId: string; x: number; y: number }>()
  const archived = chatProps.archivedChats || []
  const hiddenChats = chatProps.chats.filter((chat) => hiddenChatIds.includes(chat.id))
  useLayoutEffect(() => {
    if (!railVisible) { setRailTarget(null); return }
    const target = workspaceRef.current?.closest('.workspace-main-row')?.querySelector<HTMLElement>('.workspace-agent-rail-slot') || null
    setRailTarget(target)
  }, [railVisible])
  useLayoutEffect(() => {
    const root = workspaceRef.current
    if (!root) return
    const reconcile = () => {
      const next = boundedAgentChatWidth(chatWidth, root.getBoundingClientRect().width)
      if (next && next !== chatWidth) { setChatWidth(next); saveAgentChatWidth(next) }
    }
    reconcile()
    const ResizeObserverCtor = window.ResizeObserver
    if (ResizeObserverCtor) {
      const observer = new ResizeObserverCtor(reconcile)
      observer.observe(root)
      return () => observer.disconnect()
    }
    window.addEventListener('resize', reconcile)
    return () => window.removeEventListener('resize', reconcile)
  }, [chatWidth])
  useEffect(() => {
    if (!singlePane) return
    setSinglePaneSurface('chat')
    setFocusedPane('chat')
  }, [singlePane])
  useEffect(() => {
    const openDrawer = () => onOpenAttentionDrawer()
    window.addEventListener('wharnex:open-attention-drawer', openDrawer)
    return () => window.removeEventListener('wharnex:open-attention-drawer', openDrawer)
  }, [onOpenAttentionDrawer])
  useLayoutEffect(() => {
    const root = chatTabsRef.current
    if (!root) return
    const measure = () => {
      const bounds = root.getBoundingClientRect()
      const hidden = Array.from(root.querySelectorAll<HTMLElement>('.chat-tab-group[data-chat-id]'))
        .filter((node) => { const rect = node.getBoundingClientRect(); return rect.left < bounds.left - 1 || rect.right > bounds.right + 1 })
        .map((node) => node.dataset.chatId || '')
        .filter(Boolean)
      setHiddenChatIds((current) => current.length === hidden.length && current.every((id, index) => id === hidden[index]) ? current : hidden)
    }
    const frame = window.requestAnimationFrame(measure)
    const ResizeObserverCtor = window.ResizeObserver
    if (ResizeObserverCtor) {
      const observer = new ResizeObserverCtor(measure)
      observer.observe(root)
      Array.from(root.children).forEach((child) => observer.observe(child))
      return () => { window.cancelAnimationFrame(frame); observer.disconnect() }
    }
    window.addEventListener('resize', measure)
    return () => { window.cancelAnimationFrame(frame); window.removeEventListener('resize', measure) }
  }, [chatProps.chats])
  useEffect(() => {
    if (!overflowOpen) return
    const close = (event: PointerEvent) => {
      if (event.target instanceof Node && !overflowRef.current?.contains(event.target)) setOverflowOpen(false)
    }
    const escape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      setOverflowOpen(false)
      overflowTriggerRef.current?.focus()
    }
    document.addEventListener('pointerdown', close)
    document.addEventListener('keydown', escape)
    return () => { document.removeEventListener('pointerdown', close); document.removeEventListener('keydown', escape) }
  }, [overflowOpen])
  useEffect(() => { if (!hiddenChats.length) setOverflowOpen(false) }, [hiddenChats.length])
  useEffect(() => {
    if (!chatTabMenu) return
    const close = () => setChatTabMenu(undefined)
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') close() }
    document.addEventListener('pointerdown', close)
    document.addEventListener('keydown', escape)
    return () => { document.removeEventListener('pointerdown', close); document.removeEventListener('keydown', escape) }
  }, [chatTabMenu])
  // Attention routing switches the inspector to the surface that needs a human,
  // but it never dismisses the left panel: the drawer closes only when the
  // operator asks it to, so incoming attention cannot pull away the plans,
  // runtime or Git view they were reading.
  useEffect(() => {
    if (!chatgptAttentionNonce) return
    setInspectorTab('chatgpt')
    setFocusedPane('inspector')
    if (singlePane) setSinglePaneSurface('inspector')
  }, [chatgptAttentionNonce, singlePane])
  useEffect(() => {
    if (!inspectorAttention?.nonce) return
    setInspectorTab(inspectorAttention.tab)
    setFocusedPane('inspector')
    if (singlePane) setSinglePaneSurface('inspector')
  }, [inspectorAttention, singlePane])
  function openInspector(tab: InspectorTab) {
    setInspectorTab(tab)
    setFocusedPane('inspector')
    if (singlePane) setSinglePaneSurface('inspector')
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
    setOverflowOpen(false)
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
      const next = boundedAgentChatWidth(clientX - rect.left, rect.width)
      if (!next) return
      setChatWidth(next); saveAgentChatWidth(next)
    })
  }

  const surfaceTabs = <nav className="agent-chat-surface-tabs" aria-label="Áreas do Agent">
    {singlePane && <button className={singlePaneSurface === 'chat' ? 'active' : ''} onClick={() => { setSinglePaneSurface('chat'); setFocusedPane('chat') }} title="Chat" aria-label="Chat"><Icon name="send" size={15}/></button>}
    <button className={inspectorTab === 'files' ? 'active' : ''} onClick={() => openInspector('files')} title="Ficheiros" aria-label="Ficheiros"><Icon name="folder" size={15}/></button>
    <button className={surfaceTabClass('plan')} onClick={() => openInspector('plan')} title={surfaceTabTitle('plan', 'Plano')} aria-label={surfaceTabTitle('plan', 'Plano')}><Icon name="plan" size={15}/>{surfaceAttention('plan').length > 0 && <span className="surface-attention-count">{surfaceAttention('plan').length}</span>}</button>
    <button className={surfaceTabClass('terminal')} onClick={() => openInspector('terminal')} title={surfaceTabTitle('terminal', 'Execução')} aria-label={surfaceTabTitle('terminal', 'Execução')}><Icon name="terminal" size={15}/>{surfaceAttention('terminal').length > 0 && <span className="surface-attention-count">{surfaceAttention('terminal').length}</span>}</button>
    <button className={surfaceTabClass('chatgpt')} onClick={() => openInspector('chatgpt')} title={surfaceTabTitle('chatgpt', session.integration_conflict ? 'Conflito Engine' : 'Engine')} aria-label={surfaceTabTitle('chatgpt', session.integration_conflict ? 'Conflito Engine' : 'Engine')}><Icon name="agent" size={15}/>{surfaceAttention('chatgpt').length > 0 && <span className="surface-attention-count">{surfaceAttention('chatgpt').length}</span>}</button>
  </nav>

  if (minimalSurface) return <section ref={workspaceRef} className="agent-workspace agent-surface-only">
    <div className="agent-chat-stage"><ChatPanel ref={chatPanelRef} key={chatProps.activeChatId} {...chatProps} historyViewportStore={chatViewportStoreRef.current} embedded hideSwitcher onExportChat={onExportChat} /></div>
  </section>

  const commandbar = <header className="agent-commandbar" aria-label="Atalhos do Agent">
    <nav className="agent-direct-chatgpt-tab" aria-label="ChatGPT direto">
      <button className={inspectorTab === 'direct-chatgpt' ? 'active' : ''} onClick={() => openInspector('direct-chatgpt')} title="ChatGPT" aria-label="ChatGPT"><Icon name="chatgpt" size={15}/></button>
    </nav>
  </header>


  // The Agent shortcuts reuse the shell's existing right tool rail in the real
  // workbench. Standalone consumers keep the inline rail as a safe fallback.
  return <section
    ref={workspaceRef}
    className={`agent-workspace${singlePane ? ' single-pane' : ''} ${railVisible ? 'agent-rail-unified' : ''}`.trim()}
    data-focused-pane={focusedPane}
    data-inspector-tab={inspectorTab}
    style={chatWidth ? { '--agent-chat-width': `${chatWidth}px` } as React.CSSProperties : undefined}
  >
    {railVisible ? (railTarget ? createPortal(commandbar, railTarget) : null) : commandbar}
    <nav className="agent-chat-switcher" aria-label="Conversas do Harness">
      {!surfaceMode && <button className="chat-new-button" onClick={() => void chatProps.onNewChat()} title="Novo chat" aria-label="Novo chat"><Icon name="plus" size={14}/></button>}
      {!surfaceMode && archived.length > 0 && <button className="chat-new-button chat-reopen-button" disabled={busy} onClick={() => void chatProps.onRestoreChat(archived[0].id)} title={`Reabrir último chat fechado: ${archived[0].title}`} aria-label="Reabrir último chat fechado"><Icon name="refresh" size={13}/></button>}
      <div className="chat-tabs" ref={chatTabsRef} onScroll={() => { const root = chatTabsRef.current; if (!root) return; const bounds = root.getBoundingClientRect(); setHiddenChatIds(Array.from(root.querySelectorAll<HTMLElement>('.chat-tab-group[data-chat-id]')).filter((node) => { const rect = node.getBoundingClientRect(); return rect.left < bounds.left - 1 || rect.right > bounds.right + 1 }).map((node) => node.dataset.chatId || '').filter(Boolean)) }}>
        {chatProps.chats.map((chat) => <div
          key={chat.id}
          data-chat-id={chat.id}
          draggable={!surfaceMode}
          className={[chat.id === chatProps.activeChatId ? 'chat-tab-group active' : 'chat-tab-group', chat.id === draggedChatId ? 'dragging' : '', chat.id === dropTargetChatId ? 'drop-target' : ''].filter(Boolean).join(' ')}
          onDragStart={(event) => beginChatDrag(event, chat.id)}
          onDragEnter={() => { if (draggedChatId && draggedChatId !== chat.id) setDropTargetChatId(chat.id) }}
          onDragOver={(event) => { if (draggedChatId && draggedChatId !== chat.id) { event.preventDefault(); event.dataTransfer.dropEffect = 'move' } }}
          onDrop={(event) => dropChat(event, chat.id)}
          onContextMenu={(event) => { event.preventDefault(); setChatTabMenu({ chatId: chat.id, x: event.clientX, y: event.clientY }) }}
          onDragEnd={(event) => { if (onDetachChat && workspaceDragEndedOutside(event)) onDetachChat(chat.id, { screenX: event.screenX, screenY: event.screenY }); setDraggedChatId(''); setDropTargetChatId('') }}
        >
          <button className={chat.id === chatProps.activeChatId ? 'chat-tab active' : 'chat-tab'} onClick={() => void chatProps.onSelectChat(chat.id)} onKeyDown={(event) => moveChatWithKeyboard(event, chat.id)} title={chat.chatgptUrl ? `${chat.title}\nChatGPT: ${chat.chatgptUrl}\nArraste para reordenar · Alt+←/→` : `${chat.title}\nChatGPT ainda não vinculado\nArraste para reordenar · Alt+←/→`}><span>{chat.title}</span><i className={chat.chatgptUrl ? 'chat-link-dot linked' : 'chat-link-dot'} aria-hidden="true" /></button>
          <button className="chat-tab-remove" disabled={busy} onClick={() => void chatProps.onArchiveChat(chat.id)} title={`Fechar e arquivar ${chat.title}`} aria-label={`Fechar e arquivar chat ${chat.title}`}><Icon name="close" size={11}/></button>
        </div>)}
      </div>
      <div className="agent-chat-fixed-tools">
        {hiddenChats.length > 0 && <div className="chat-overflow-control" ref={overflowRef}>
          <button ref={overflowTriggerRef} type="button" className="chat-overflow-trigger" aria-haspopup="menu" aria-expanded={overflowOpen} aria-label={`Chats fora da área visível, ${hiddenChats.length}`} title={`${hiddenChats.length} chat(s) fora da área visível`} onClick={() => setOverflowOpen((current) => !current)}><Icon name="list" size={15}/><span>{hiddenChats.length}</span></button>
          {overflowOpen && <div className="chat-overflow-menu" role="menu" aria-label="Chats não visíveis" data-chatgpt-overlay-blocker="true">
            {hiddenChats.map((chat) => <div key={chat.id} data-chat-id={chat.id} draggable className={[chat.id === chatProps.activeChatId ? 'chat-overflow-row active' : 'chat-overflow-row', chat.id === draggedChatId ? 'dragging' : '', chat.id === dropTargetChatId ? 'drop-target' : ''].filter(Boolean).join(' ')} onDragStart={(event) => beginChatDrag(event, chat.id)} onDragEnter={() => { if (draggedChatId && draggedChatId !== chat.id) setDropTargetChatId(chat.id) }} onDragOver={(event) => { if (draggedChatId && draggedChatId !== chat.id) { event.preventDefault(); event.dataTransfer.dropEffect = 'move' } }} onDrop={(event) => dropChat(event, chat.id)} onDragEnd={(event) => { if (onDetachChat && workspaceDragEndedOutside(event)) onDetachChat(chat.id, { screenX: event.screenX, screenY: event.screenY }); setDraggedChatId(''); setDropTargetChatId('') }}>
              <button type="button" role="menuitem" className="chat-overflow-open" onClick={() => { setOverflowOpen(false); void chatProps.onSelectChat(chat.id); window.requestAnimationFrame(() => Array.from(chatTabsRef.current?.querySelectorAll<HTMLElement>('.chat-tab-group[data-chat-id]') || []).find((node) => node.dataset.chatId === chat.id)?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' })) }} title={chat.title} aria-label={`Abrir chat ${chat.title}`}><span>{chat.title}</span><i className={chat.chatgptUrl ? 'chat-link-dot linked' : 'chat-link-dot'} aria-hidden="true"/></button>
              <button type="button" className="chat-overflow-action" disabled={busy} onClick={() => void chatProps.onArchiveChat(chat.id)} title={`Fechar e arquivar ${chat.title}`} aria-label={`Fechar e arquivar chat ${chat.title}`}><Icon name="close" size={12}/></button>
            </div>)}
          </div>}
        </div>}
        {surfaceTabs}
      </div>
    </nav>
    {chatTabMenu && <div className="chat-tab-context-menu" role="menu" aria-label="Ações da tab de chat" data-chatgpt-overlay-blocker="true" style={{ left: chatTabMenu.x, top: chatTabMenu.y }} onPointerDown={(event) => event.stopPropagation()}>
      {chatProps.onSaveChat && <button type="button" role="menuitem" disabled={busy} onClick={() => { const chatId = chatTabMenu.chatId; setChatTabMenu(undefined); void chatProps.onSaveChat?.(chatId) }}><Icon name="save" size={12}/>Guardar em standby</button>}
      {onSplitChat && <><button type="button" role="menuitem" onClick={() => { const chatId = chatTabMenu.chatId; setChatTabMenu(undefined); onSplitChat(chatId, 'vertical') }}><Icon name="arrow-right" size={12}/>Dividir à direita</button><button type="button" role="menuitem" onClick={() => { const chatId = chatTabMenu.chatId; setChatTabMenu(undefined); onSplitChat(chatId, 'horizontal') }}><Icon name="arrow-down" size={12}/>Dividir abaixo</button></>}
    </div>}

    <div
      className={`agent-chat-stage${singlePane && singlePaneSurface !== 'chat' ? ' surface-hidden' : ''}`}
      onPointerDownCapture={() => setFocusedPane('chat')}
      onFocusCapture={() => setFocusedPane('chat')}
    ><ChatPanel ref={chatPanelRef} key={chatProps.activeChatId} {...chatProps} historyViewportStore={chatViewportStoreRef.current} embedded hideSwitcher onExportChat={onExportChat} /></div>
    {!singlePane && (
      <button type="button" className="agent-splitter" aria-label="Redimensionar chat e Engine" title="Arraste para redimensionar" onPointerDown={beginResize}/>
    )}
    <div
      className={`agent-inspector-stage${singlePane && singlePaneSurface === 'chat' ? ' surface-hidden' : ''}`}
      onPointerDownCapture={() => setFocusedPane('inspector')}
      onFocusCapture={() => setFocusedPane('inspector')}
    ><Inspector {...inspectorProps} embedded activeTab={inspectorTab} onTabChange={openInspector} onAdjustExecutionPlan={() => { if (session.plan) chatPanelRef.current?.prepareExecutionPlanAdjustment(session.plan) }} /></div>
  </section>
}
