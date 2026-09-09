import { useEffect, useMemo, useRef, useState, type ComponentProps } from 'react'
import type { BundleQuota, HarnessEvent, Session } from '../types'
import { ChatPanel } from './ChatPanel'
import type { ChatViewportStore } from './useProgressiveChatHistory'
import { Inspector, type InspectorTab } from './Inspector'
import { Icon } from './Icon'
import { AgentProjectExplorer } from './AgentProjectExplorer'
import { ProjectActivityDrawer, type ProjectActivityKind } from './ProjectActivityDrawer'
import { EvolutionEvidenceDrawer } from './EvolutionEvidenceDrawer'
import { ProjectKnowledgeDrawer } from './ProjectKnowledgeDrawer'
import { FilePreviewModal } from './FilePreviewModal'
import { loadChat } from '../lib/workspaceMemory'
import { MarkdownContent } from './MarkdownContent'
import { promptDialog } from '../lib/appDialog'
import { desktopWindowScope } from '../lib/projectBindings'
import { ATTENTION_ACTION_LABEL, collectAttentionItems, sessionCanApplyHost, sessionHostResolutionBlocked, type AttentionItem, type AttentionTarget, type AttentionTone } from '../lib/attentionCenter'
import { AttentionPopover } from './AttentionPopover'
import { api } from '../lib/api'

type Drawer = 'attention' | 'archive' | 'project' | 'knowledge' | 'fifo' | 'evolution' | ProjectActivityKind | ''

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

export type ExecutionFIFOItem = { key: string; chatId: string; chatTitle: string; planId: string; status: 'submitting' | 'queued' | 'running'; position?: number; addedAt: number }

export function AgentWorkspace({ session, busy, executionFIFO = [], attentionSessions = {}, chatgptHumanActions = {}, chatgptHumanAction, chatgptAttentionNonce = 0, inspectorAttention, onChatGPTHumanAction, chatProps, inspectorProps, onOpenFile, onError, onAnalyzeEvolution, onExportChat }: {
  session: Session
  busy: boolean
  executionFIFO?: ExecutionFIFOItem[]
  attentionSessions?: Record<string, Session | undefined>
  chatgptHumanActions?: Record<string, DesktopChatGPTHumanAction>
  chatgptHumanAction?: DesktopChatGPTHumanAction
  chatgptAttentionNonce?: number
  inspectorAttention?: { tab: InspectorTab; nonce: number }
  onChatGPTHumanAction?: () => void
  chatProps: ComponentProps<typeof ChatPanel>
  inspectorProps: ComponentProps<typeof Inspector>
  onOpenFile: (path: string) => void
  onError: (message: string) => void
  onAnalyzeEvolution?: (ids: string[]) => Promise<void>
  onExportChat?: () => Promise<void>
}) {
  const [inspectorTab, setInspectorTab] = useState<InspectorTab>(inspectorProps.config?.planner === 'manual' ? 'chatgpt' : 'plan')
  const [drawer, setDrawer] = useState<Drawer>('')
  const [attentionPopoverOpen, setAttentionPopoverOpen] = useState(false)
  const [previewPath, setPreviewPath] = useState<string>()
  const workspaceRef = useRef<HTMLElement>(null)
  const attentionClusterRef = useRef<HTMLDivElement>(null)
  const chatViewportStoreRef = useRef<ChatViewportStore>(new Map())
  const [chatWidth, setChatWidth] = useState(loadAgentChatWidth)
  const [bundleQuota, setBundleQuota] = useState<BundleQuota>()
  const archived = chatProps.archivedChats || []
  const activityChats = useMemo(() => [...chatProps.chats, ...(chatProps.archivedChats || [])], [chatProps.chats, chatProps.archivedChats])
  const attentionItems = useMemo(() => collectAttentionItems(chatProps.chats, attentionSessions, chatgptHumanActions), [attentionSessions, chatProps.chats, chatgptHumanActions])
  const urgentAttentionCount = attentionItems.filter((item) => item.tone === 'danger').length
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
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === 'Escape') setAttentionPopoverOpen(false) }
    document.addEventListener('pointerdown', closeOnOutsidePointer)
    document.addEventListener('keydown', closeOnEscape)
    return () => {
      document.removeEventListener('pointerdown', closeOnOutsidePointer)
      document.removeEventListener('keydown', closeOnEscape)
    }
  }, [attentionPopoverOpen])
  useEffect(() => {
    if (!chatgptAttentionNonce) return
    setDrawer('')
    setInspectorTab('chatgpt')
  }, [chatgptAttentionNonce])
  useEffect(() => {
    if (!inspectorAttention?.nonce) return
    setDrawer('')
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

  function toggleDrawer(next: Exclude<Drawer, ''>) { setDrawer((current) => current === next ? '' : next) }

  async function openAttention(item: AttentionItem) {
    setAttentionPopoverOpen(false)
    if (item.id.endsWith(':chatgpt-human-action') && item.chatId === chatProps.activeChatId && chatgptHumanAction?.active && onChatGPTHumanAction) {
      onChatGPTHumanAction()
      return
    }
    if (item.chatId !== chatProps.activeChatId) await chatProps.onSelectChat(item.chatId)
    if (item.target) setInspectorTab(item.target)
    setDrawer('')
  }

  async function runAttentionAction(item: AttentionItem) {
    if (!item.action) return
    if (item.chatId !== chatProps.activeChatId) {
      await openAttention(item)
      return
    }
    setAttentionPopoverOpen(false)
    switch (item.action) {
      case 'approve-execution': await inspectorProps.onExecute(true); return
      case 'retry-dependency-network': await inspectorProps.onRetryDependencyNetwork?.(); return
      case 'repair-host-dependency': await inspectorProps.onRetryHostDependencyRepair?.(); return
      case 'repair-with-gpt': {
        const detail = await promptDialog({ title: 'Corrigir erro com GPT', message: 'Pode acrescentar um detalhe para orientar a correção ou deixar em branco.', inputLabel: 'Detalhe opcional', placeholder: 'Ex.: verifique também o comportamento no Windows', confirmLabel: 'Enviar para correção', tone: 'warning' })
        if (detail !== undefined) await chatProps.onRepairWithGPT?.(detail)
        return
      }
      case 'retry-transport': await chatProps.onRetryTransportFailure?.(item.requestId || ''); return
      case 'retry-host-apply':
      case 'apply-host': await inspectorProps.onApply(); return
    }
  }

  function openAllAttention() {
    setAttentionPopoverOpen(false)
    setDrawer('attention')
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

  function beginResize(event: React.PointerEvent<HTMLButtonElement>) {
    const root = workspaceRef.current
    if (!root) return
    event.currentTarget.setPointerCapture(event.pointerId)
    const rect = root.getBoundingClientRect()
    const drawerWidth = drawer ? root.querySelector<HTMLElement>('.agent-drawer')?.offsetWidth || 0 : 0
    const fixed = 42 + drawerWidth
    const update = (clientX: number) => {
      const available = Math.max(720, rect.width - fixed - 6)
      const next = Math.round(Math.max(320, Math.min(available - 320, clientX - rect.left - fixed)))
      setChatWidth(next); saveAgentChatWidth(next)
    }
    const move = (moveEvent: PointerEvent) => update(moveEvent.clientX)
    const finish = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', finish) }
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', finish)
  }

  const executeLabel = direct ? 'Executar plano diretamente no host' : needsApproval ? 'Aprovar e executar plano' : 'Executar plano na sandbox'

  return <section ref={workspaceRef} className={`agent-workspace ${drawer ? 'drawer-open' : ''}`} style={chatWidth ? { '--agent-chat-width': `${chatWidth}px` } as React.CSSProperties : undefined}>
    <header className="agent-commandbar">
      <nav className="agent-direct-chatgpt-tab" aria-label="ChatGPT direto">
        <button className={inspectorTab === 'direct-chatgpt' ? 'active' : ''} onClick={() => openInspector('direct-chatgpt')} title="ChatGPT" aria-label="ChatGPT"><Icon name="chatgpt" size={15}/></button>
      </nav>
      {(session.self_evolution || session.wharnex_instance_id) && <div className="agent-commandbar-center">
        <span className="self-evolution-badge"><Icon name="refresh" size={13}/>{session.self_evolution ? ' WHX · AUTO-EVOLUÇÃO' : ` WHX · EVOLUÇÃO DA INSTÂNCIA ${session.wharnex_instance_id}`}</span>
      </div>}
      <div className="agent-command-actions">
        {bundleQuota && <AgentBundleCounters quota={bundleQuota}/>}
        {attentionItems.length > 0 && <div className="agent-attention-cluster" ref={attentionClusterRef}>
          <button type="button" className={`agent-attention-summary ${urgentAttentionCount ? 'urgent' : ''}`} onClick={() => setAttentionPopoverOpen((open) => !open)} aria-expanded={attentionPopoverOpen} aria-haspopup="dialog" aria-label={`Centro de notificações, ${attentionItems.length} alerta(s), ${urgentAttentionCount} urgente(s)`} title="Alertas de todos os chats deste projeto"><Icon name="bell" size={14}/><span><b>{attentionItems.length} {attentionItems.length === 1 ? 'alerta' : 'alertas'}</b><small>{urgentAttentionCount} {urgentAttentionCount === 1 ? 'urgente' : 'urgentes'}</small></span></button>
          {attentionPopoverOpen && <AttentionPopover items={attentionItems} activeChatId={chatProps.activeChatId} busy={busy} onOpen={openAttention} onAction={runAttentionAction} onOpenAll={openAllAttention}/>}
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
      <div className="chat-tabs">
        {chatProps.chats.map((chat) => <div key={chat.id} className={chat.id === chatProps.activeChatId ? 'chat-tab-group active' : 'chat-tab-group'}>
          <button className={chat.id === chatProps.activeChatId ? 'chat-tab active' : 'chat-tab'} onClick={() => void chatProps.onSelectChat(chat.id)} title={chat.chatgptUrl ? `${chat.title}\nChatGPT: ${chat.chatgptUrl}` : `${chat.title}\nChatGPT ainda não vinculado`}><span>{chat.title}</span><i className={chat.chatgptUrl ? 'chat-link-dot linked' : 'chat-link-dot'} aria-hidden="true" /></button>
          <button className="chat-tab-remove" disabled={busy} onClick={() => void chatProps.onArchiveChat(chat.id)} title={`Fechar e arquivar ${chat.title}`} aria-label={`Fechar e arquivar chat ${chat.title}`}><Icon name="close" size={11}/></button>
        </div>)}
      </div>
    </nav>

    <aside className="agent-activity-bar" aria-label="Ferramentas do Agent">
      <button type="button" className={drawer === 'archive' ? 'active' : ''} onClick={() => toggleDrawer('archive')} aria-label="Chats arquivados" title="Chats arquivados"><Icon name="folder" size={18}/>{archived.length > 0 && <b>{archived.length}</b>}</button>
      <button type="button" className={drawer === 'project' ? 'active' : ''} onClick={() => toggleDrawer('project')} aria-label="Explorador do projeto" title="Explorador do projeto"><Icon name="workspace" size={18}/></button>
      <button type="button" className={drawer === 'knowledge' ? 'active' : ''} onClick={() => toggleDrawer('knowledge')} aria-label="Conhecimento do projeto" title="Conhecimento adquirido"><Icon name="clipboard" size={18}/></button>
      <button type="button" className={drawer === 'plans' ? 'active' : ''} onClick={() => toggleDrawer('plans')} aria-label="Planos do projeto" title="Planos do projeto"><Icon name="plan" size={18}/></button>
      <button type="button" className={drawer === 'executions' ? 'active' : ''} onClick={() => toggleDrawer('executions')} aria-label="Execuções do projeto" title="Execuções do projeto"><Icon name="terminal" size={18}/></button>
      <button type="button" className={drawer === 'fifo' ? 'active' : ''} onClick={() => toggleDrawer('fifo')} aria-label="Fila FIFO de execução" title="Fila FIFO de execução"><Icon name="play" size={18}/>{executionFIFO.length > 0 && <b>{executionFIFO.length}</b>}</button>
      {session.self_evolution && <button type="button" className={drawer === 'evolution' ? 'active' : ''} onClick={() => toggleDrawer('evolution')} aria-label="Logs de auto-evolução" title="Logs e análise de auto-evolução"><Icon name="refresh" size={18}/></button>}
    </aside>

    {drawer && <aside className={`agent-drawer ${drawer === 'plans' || drawer === 'executions' ? 'activity-wide' : drawer === 'evolution' ? 'evidence-wide' : drawer === 'knowledge' ? 'knowledge-wide' : drawer === 'attention' ? 'attention-wide' : ''}`}>
      {drawer === 'attention' ? <AttentionCenterDrawer items={attentionItems} activeChatId={chatProps.activeChatId} busy={busy} onOpen={openAttention} onAction={runAttentionAction} onClose={() => setDrawer('')}/> : null}
      {drawer === 'archive' ? <ArchiveDrawer projectPath={session.project_path} chats={archived} busy={busy} onRestore={chatProps.onRestoreChat} onDelete={chatProps.onDeleteArchivedChat} onRename={chatProps.onRenameChat} onGenerate={chatProps.onGenerateChatTitle} onClose={() => setDrawer('')}/> : null}
      {drawer === 'project' ? <AgentProjectExplorer session={session} onOpen={setPreviewPath} onError={onError}/> : null}
      {drawer === 'knowledge' ? <ProjectKnowledgeDrawer session={session} onClose={() => setDrawer('')}/> : null}
      {drawer === 'plans' || drawer === 'executions' ? <ProjectActivityDrawer kind={drawer} chats={activityChats} currentSession={session} activeChatId={chatProps.activeChatId} onClose={() => setDrawer('')}/> : null}
      {drawer === 'fifo' ? <ExecutionQueueDrawer items={executionFIFO} onClose={() => setDrawer('')}/> : null}
      {drawer === 'evolution' && session.self_evolution ? <EvolutionEvidenceDrawer session={session} busy={busy} onAnalyze={onAnalyzeEvolution || (async () => undefined)} onClose={() => setDrawer('')}/> : null}
    </aside>}

    {previewPath && <FilePreviewModal sessionId={session.id} path={previewPath} onOpenInEditor={onOpenFile} onClose={() => setPreviewPath(undefined)}/>}

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

function AttentionCenterDrawer({ items, activeChatId, busy, onOpen, onAction, onClose }: { items: AttentionItem[]; activeChatId: string; busy: boolean; onOpen: (item: AttentionItem) => Promise<void>; onAction: (item: AttentionItem) => Promise<void>; onClose: () => void }) {
  const chatCount = new Set(items.map((item) => item.chatId)).size
  return <section className="attention-center-drawer" aria-label="Centro de notificações">
    <header className="agent-drawer-heading"><div><span className="panel-kicker">Atenção global</span><strong>Centro de notificações</strong></div><button type="button" className="agent-drawer-icon" onClick={onClose} aria-label="Fechar notificações"><Icon name="close" size={13}/></button></header>
    <div className="attention-center-summary"><span><b>{items.length}</b> {items.length === 1 ? 'alerta ativo' : 'alertas ativos'}</span><span><b>{chatCount}</b> {chatCount === 1 ? 'chat afetado' : 'chats afetados'}</span></div>
    <div className="attention-center-list">
      {items.length ? items.map((item) => <article className={`attention-center-item ${item.tone}`} key={item.id}><button type="button" className="attention-center-link" disabled={busy && item.chatId !== activeChatId} onClick={() => void onOpen(item)}>
        <span className="attention-center-marker"><Icon name={item.tone === 'danger' ? 'shield' : item.tone === 'success' ? 'apply' : 'bell'} size={15}/></span>
        <span className="attention-center-copy"><small>{item.chatTitle}{item.chatId === activeChatId ? ' · aberto agora' : ''}</small><strong>{item.title}</strong><span>{item.detail}</span></span>
        <Icon name="arrow-right" size={14}/>
      </button>{item.action && <button type="button" className="attention-center-action" disabled={busy} onClick={() => void onAction(item)}>{item.chatId === activeChatId ? ATTENTION_ACTION_LABEL[item.action] : `Abrir · ${ATTENTION_ACTION_LABEL[item.action]}`}</button>}</article>) : <div className="agent-drawer-empty attention-empty"><Icon name="check" size={18}/><strong>Nada requer atenção</strong><span>Alertas de todos os chats abertos deste projeto aparecerão aqui.</span></div>}
    </div>
  </section>
}

function ExecutionQueueDrawer({ items, onClose }: { items: ExecutionFIFOItem[]; onClose: () => void }) {
  return <section className="execution-queue-drawer" aria-label="Fila FIFO de execução">
    <header className="agent-drawer-heading"><div><span className="panel-kicker">Concorrência</span><strong>Fila FIFO de execução</strong></div><button type="button" className="agent-drawer-icon" onClick={onClose} aria-label="Fechar fila"><Icon name="close" size={13}/></button></header>
    <div className="execution-queue-summary"><b>{items.length}</b><span>{items.length === 1 ? 'execução coordenada' : 'execuções coordenadas'}</span></div>
    <div className="execution-queue-list">{items.length ? items.map((item, index) => <article key={item.key}><span className={`queue-position ${item.status}`}>{item.status === 'running' || (index === 0 && item.status === 'submitting') ? 'ATIVA' : String(item.position || index + 1).padStart(2, '0')}</span><div><strong>{item.chatTitle}</strong><code>{item.planId}</code><small>{item.status === 'queued' ? 'Em espera, ordem preservada' : 'Em execução exclusiva'}</small></div></article>) : <div className="agent-drawer-empty">A fila está livre. Novas execuções aparecerão aqui, em ordem de chegada.</div>}</div>
  </section>
}

function ArchiveDrawer({ projectPath, chats, busy, onRestore, onDelete, onRename, onGenerate, onClose }: {
  projectPath: string
  chats: ComponentProps<typeof ChatPanel>['archivedChats']
  busy: boolean
  onRestore: ComponentProps<typeof ChatPanel>['onRestoreChat']
  onDelete: ComponentProps<typeof ChatPanel>['onDeleteArchivedChat']
  onRename: ComponentProps<typeof ChatPanel>['onRenameChat']
  onGenerate: ComponentProps<typeof ChatPanel>['onGenerateChatTitle']
  onClose: () => void
}) {
  const [query, setQuery] = useState('')
  const [preview, setPreview] = useState<string>()
  const visible = chats.filter((chat) => chat.title.toLowerCase().includes(query.toLowerCase()))
  const previewChat = chats.find((chat) => chat.id === preview)
  const previewItems = previewChat ? loadChat(projectPath, previewChat.id) : []
  return <section className="agent-archive-drawer" aria-label="Chats arquivados">
    <header className="agent-drawer-heading"><div><span className="panel-kicker">Chats</span><strong>Arquivados</strong></div><button type="button" className="agent-drawer-icon" onClick={onClose} aria-label="Fechar drawer"><Icon name="close" size={13}/></button></header>
    <label className="archive-search"><Icon name="search" size={13}/><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Pesquisar chats arquivados"/></label>
    <div className="agent-archive-list">
      {visible.length ? visible.map((chat) => <article className="agent-archive-item" key={chat.id} onClick={() => setPreview(chat.id)}>
        <div><strong>{chat.title}</strong><span>Início {new Date(chat.createdAt).toLocaleString()}</span><span>Encerramento {new Date(chat.archivedAt || chat.updatedAt).toLocaleString()}</span></div>
        <div><button type="button" disabled={busy} onClick={(event) => { event.stopPropagation(); void promptDialog({ title: 'Renomear chat', inputLabel: 'Novo nome', initialValue: chat.title, confirmLabel: 'Renomear' }).then((title) => { if (title) return onRename?.(chat.id, title) }) }} aria-label={`Renomear ${chat.title}`} title="Renomear"><Icon name="rename" size={13}/></button><button type="button" disabled={busy || !chat.chatgptUrl} onClick={(event) => { event.stopPropagation(); void onGenerate?.(chat.id) }} aria-label={`Gerar nome para ${chat.title}`} title="Usar o título contextual gerado pelo ChatGPT"><Icon name="agent" size={13}/></button><button type="button" className="danger" disabled={busy} onClick={(event) => { event.stopPropagation(); void onDelete(chat.id) }} aria-label={`Eliminar definitivamente ${chat.title}`} title="Eliminar definitivamente"><Icon name="trash" size={13}/></button></div>
      </article>) : <div className="agent-drawer-empty">Nenhum chat arquivado corresponde à pesquisa.</div>}
    </div>
    {previewChat && <div className="archived-preview-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setPreview(undefined) }}><section className="archived-preview" role="dialog" aria-modal="true" aria-label={`Pré-visualização de ${previewChat.title}`}><header><div><span className="panel-kicker">Somente leitura</span><h2>{previewChat.title}</h2><p>{new Date(previewChat.createdAt).toLocaleString()} — {new Date(previewChat.archivedAt || previewChat.updatedAt).toLocaleString()}</p></div><button className="icon-button light" onClick={() => setPreview(undefined)} aria-label="Fechar pré-visualização"><Icon name="close" size={14}/></button></header><div className="archived-preview-stream">{previewItems.map((item) => <article key={item.id} className={`archived-preview-message ${item.source || item.role}`}><small>{item.source === 'chatgpt' ? 'ChatGPT' : item.source === 'wharness' ? 'WHX' : 'Você'} · {item.createdAt ? new Date(item.createdAt).toLocaleString() : ''}</small><MarkdownContent markdown={item.text}/></article>)}</div><footer><span>Envio e processamento permanecem bloqueados até restaurar.</span><button className="apply-button" disabled={busy} onClick={() => void onRestore(previewChat.id)}><Icon name="refresh" size={13}/> Restaurar chat</button></footer></section></div>}
  </section>
}
