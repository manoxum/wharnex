import { useEffect, useMemo, useRef, useState, type ComponentProps } from 'react'
import type { Session } from '../types'
import { ChatPanel } from './ChatPanel'
import { Inspector, type InspectorTab } from './Inspector'
import { Icon } from './Icon'
import { AgentProjectExplorer } from './AgentProjectExplorer'
import { ProjectActivityDrawer, type ProjectActivityKind } from './ProjectActivityDrawer'
import { EvolutionEvidenceDrawer } from './EvolutionEvidenceDrawer'
import { FilePreviewModal } from './FilePreviewModal'
import { loadChat } from '../lib/workspaceMemory'
import { MarkdownContent } from './MarkdownContent'
import { promptDialog } from '../lib/appDialog'
import { desktopWindowScope } from '../lib/projectBindings'

type Drawer = 'archive' | 'project' | 'fifo' | 'evolution' | ProjectActivityKind | ''

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

export function AgentWorkspace({ session, busy, executionFIFO = [], chatgptHumanAction, chatgptAttentionNonce = 0, onChatGPTHumanAction, chatProps, inspectorProps, onOpenFile, onError, onAnalyzeEvolution, onExportChat }: {
  session: Session
  busy: boolean
  executionFIFO?: ExecutionFIFOItem[]
  chatgptHumanAction?: DesktopChatGPTHumanAction
  chatgptAttentionNonce?: number
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
  const [previewPath, setPreviewPath] = useState<string>()
  const workspaceRef = useRef<HTMLElement>(null)
  const [chatWidth, setChatWidth] = useState(loadAgentChatWidth)
  const archived = chatProps.archivedChats || []
  const activityChats = useMemo(() => [...chatProps.chats, ...(chatProps.archivedChats || [])], [chatProps.chats, chatProps.archivedChats])
  useEffect(() => {
    if (!chatgptAttentionNonce) return
    setDrawer('')
    setInspectorTab('chatgpt')
  }, [chatgptAttentionNonce])
  const canExecute = Boolean(session.plan && session.policy?.allowed && ['planned', 'failed'].includes(session.state) && session.last_turn?.kind !== 'workflow')
  const needsApproval = Boolean(session.policy?.requires_approval)
  const direct = session.execution_mode === 'unprotected'
  const pendingCount = session.pending_host_changes?.length || 0
  const pendingBlocked = Boolean(session.pending_manual_request_ids?.length || ['awaiting_plan', 'workflow_pending', 'workflow_planned', 'workflow_observed', 'repair_pending', 'planned', 'conflict_resolution_pending'].includes(session.state))
  const canApply = Boolean(!direct && pendingCount && !pendingBlocked && session.last_turn?.kind !== 'workflow')
  const canReject = canApply || Boolean(!direct && pendingCount && session.integration_conflict)
  // Keyed on the backend's own closed-set classification, never on error
  // prose: a planner-reported infrastructure failure carries different text
  // ("Planner reported failed: offline_host_go_module_cache: ...") than a
  // sandbox-raised one, but both set the same failure_kind.
  const dependencyNetworkBlocked = session.failure_kind === 'offline_go_module_cache'
  // No Wharness-grantable action fixes this one: the host's own Node.js is
  // older than what a pinned dependency's postinstall (observed: Electron)
  // requires, so there is nothing to "approve and retry" here. Show an
  // informative notice instead of a retry affordance.
  const hostToolchainBlocked = session.failure_kind === 'host_build_toolchain_mismatch'

  function openInspector(tab: InspectorTab) {
    setInspectorTab(tab)
  }

  function toggleDrawer(next: Exclude<Drawer, ''>) { setDrawer((current) => current === next ? '' : next) }

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
      {session.self_evolution && <span className="self-evolution-badge"><Icon name="refresh" size={13}/> WHX · AUTO-EVOLUÇÃO</span>}
      <nav className="agent-surface-tabs" aria-label="Áreas do Agent">
        <button className={inspectorTab === 'plan' ? 'active' : ''} onClick={() => openInspector('plan')} title="Plano" aria-label="Plano"><Icon name="plan" size={15}/></button>
        <button className={inspectorTab === 'terminal' ? 'active' : ''} onClick={() => openInspector('terminal')} title="Execução" aria-label="Execução"><Icon name="terminal" size={15}/></button>
        <button className={inspectorTab === 'chatgpt' ? 'active' : ''} onClick={() => openInspector('chatgpt')} title={session.integration_conflict ? 'Conflito Engine' : 'Engine'} aria-label={session.integration_conflict ? 'Conflito Engine' : 'Engine'}><Icon name="agent" size={15}/></button>
      </nav>
      <div className="agent-command-actions">
        {chatgptHumanAction?.active && <button type="button" className="agent-human-action-button" onClick={onChatGPTHumanAction} disabled={!onChatGPTHumanAction || (busy && chatgptHumanAction.cacheKey !== chatProps.activeChatId)} title={chatgptHumanAction.message} aria-label="Ação humana necessária no ChatGPT"><Icon name="shield" size={13}/><span>Ação no ChatGPT</span></button>}
        {session.policy && <span className={`agent-policy-icon ${session.policy.allowed ? '' : 'blocked'}`} title={session.policy.allowed ? `Policy autorizada · risco ${session.policy.risk}` : 'Policy bloqueada'} aria-label={session.policy.allowed ? `Policy autorizada, risco ${session.policy.risk}` : 'Policy bloqueada'}><Icon name="shield" size={14}/></span>}
        {hostToolchainBlocked ? <span className="agent-approval-callout dependency host-toolchain" role="status" title="O Node.js instalado no host é mais antigo do que o exigido pela dependência fixada (Electron). Não há correção via patch: atualize o Node do host ou baixe a versão do Electron em services/desktop/package.json." aria-label="Build do host bloqueado por incompatibilidade de toolchain"><Icon name="network" size={15}/><span><b>Build do host bloqueado</b><small>Node do host incompatível — sem correção via ChatGPT</small></span></span> : dependencyNetworkBlocked && inspectorProps.onRetryDependencyNetwork ? <button type="button" className="agent-approval-callout dependency" disabled={busy} onClick={() => void inspectorProps.onRetryDependencyNetwork?.()} aria-label="Permitir rede restrita e repetir"><Icon name="network" size={15}/><span><b>Dependências bloqueadas</b><small>Permitir rede e repetir</small></span><Icon name="play" size={13}/></button> : canExecute && needsApproval ? <button type="button" className="agent-approval-callout" disabled={busy} onClick={() => void inspectorProps.onExecute(true)} aria-label={executeLabel}><Icon name="shield" size={15}/><span><b>Aprovação necessária</b><small>Risco {session.policy?.risk || 'alto'}</small></span><Icon name="play" size={13}/></button> : canExecute && <button type="button" className={`agent-command-icon ${direct ? 'danger' : ''}`} disabled={busy} onClick={() => void inspectorProps.onExecute(direct)} aria-label={executeLabel} title={executeLabel}><Icon name="play" size={15}/></button>}
        {canReject && <button type="button" className="agent-command-icon reject" disabled={busy} onClick={() => void inspectorProps.onRejectPendingChanges?.()} aria-label={session.integration_conflict ? 'Cancelar resolução e rejeitar alterações' : 'Rejeitar alterações verificadas'} title={session.integration_conflict ? 'Cancelar conflito e rejeitar a candidata' : 'Rejeitar alterações verificadas'}><Icon name="trash" size={14}/></button>}
        {canApply && <button type="button" className="agent-command-icon apply" disabled={busy} onClick={() => void inspectorProps.onApply()} aria-label={`Aplicar alterações verificadas no host${pendingCount > 1 ? ` (${pendingCount})` : ''}`} title="Aplicar alterações verificadas no host"><Icon name="apply" size={15}/>{pendingCount > 1 && <b>{pendingCount}</b>}</button>}
      </div>
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
      <button type="button" className={drawer === 'plans' ? 'active' : ''} onClick={() => toggleDrawer('plans')} aria-label="Planos do projeto" title="Planos do projeto"><Icon name="plan" size={18}/></button>
      <button type="button" className={drawer === 'executions' ? 'active' : ''} onClick={() => toggleDrawer('executions')} aria-label="Execuções do projeto" title="Execuções do projeto"><Icon name="terminal" size={18}/></button>
      <button type="button" className={drawer === 'fifo' ? 'active' : ''} onClick={() => toggleDrawer('fifo')} aria-label="Fila FIFO de execução" title="Fila FIFO de execução"><Icon name="play" size={18}/>{executionFIFO.length > 0 && <b>{executionFIFO.length}</b>}</button>
      {session.self_evolution && <button type="button" className={drawer === 'evolution' ? 'active' : ''} onClick={() => toggleDrawer('evolution')} aria-label="Logs de auto-evolução" title="Logs e análise de auto-evolução"><Icon name="refresh" size={18}/></button>}
    </aside>

    {drawer && <aside className={`agent-drawer ${drawer === 'plans' || drawer === 'executions' ? 'activity-wide' : drawer === 'evolution' ? 'evidence-wide' : ''}`}>
      {drawer === 'archive' ? <ArchiveDrawer projectPath={session.project_path} chats={archived} busy={busy} onRestore={chatProps.onRestoreChat} onDelete={chatProps.onDeleteArchivedChat} onRename={chatProps.onRenameChat} onGenerate={chatProps.onGenerateChatTitle} onClose={() => setDrawer('')}/> : null}
      {drawer === 'project' ? <AgentProjectExplorer session={session} onOpen={setPreviewPath} onError={onError}/> : null}
      {drawer === 'plans' || drawer === 'executions' ? <ProjectActivityDrawer kind={drawer} chats={activityChats} currentSession={session} activeChatId={chatProps.activeChatId} onClose={() => setDrawer('')}/> : null}
      {drawer === 'fifo' ? <ExecutionQueueDrawer items={executionFIFO} onClose={() => setDrawer('')}/> : null}
      {drawer === 'evolution' && session.self_evolution ? <EvolutionEvidenceDrawer session={session} busy={busy} onAnalyze={onAnalyzeEvolution || (async () => undefined)} onClose={() => setDrawer('')}/> : null}
    </aside>}

    {previewPath && <FilePreviewModal sessionId={session.id} path={previewPath} onOpenInEditor={onOpenFile} onClose={() => setPreviewPath(undefined)}/>}

    <div className="agent-chat-stage"><ChatPanel key={chatProps.activeChatId} {...chatProps} embedded hideSwitcher onExportChat={onExportChat} /></div>
    <button type="button" className="agent-splitter" aria-label="Redimensionar chat e Engine" title="Arraste para redimensionar" onPointerDown={beginResize}/>
    <div className="agent-inspector-stage"><Inspector {...inspectorProps} embedded activeTab={inspectorTab} onTabChange={openInspector} /></div>
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
