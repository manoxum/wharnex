import { useState, type ComponentProps } from 'react'
import type { Session } from '../types'
import { ChatPanel } from './ChatPanel'
import { Inspector, type InspectorTab } from './Inspector'
import { Icon } from './Icon'
import { AgentProjectExplorer } from './AgentProjectExplorer'

type Drawer = 'archive' | 'project' | ''

export function AgentWorkspace({ session, busy, chatProps, inspectorProps, onOpenFile, onError }: {
  session: Session
  busy: boolean
  chatProps: ComponentProps<typeof ChatPanel>
  inspectorProps: ComponentProps<typeof Inspector>
  onOpenFile: (path: string) => void
  onError: (message: string) => void
}) {
  const [inspectorTab, setInspectorTab] = useState<InspectorTab>(inspectorProps.config?.planner === 'manual' ? 'chatgpt' : 'plan')
  const [drawer, setDrawer] = useState<Drawer>('')
  const archived = chatProps.archivedChats || []
  const canExecute = Boolean(session.plan && session.policy?.allowed && ['planned', 'failed'].includes(session.state) && session.last_turn?.kind !== 'workflow')
  const needsApproval = Boolean(session.policy?.requires_approval)
  const direct = session.execution_mode === 'unprotected'
  const pendingCount = session.pending_host_changes?.length || (session.last_execution?.success && session.state === 'verified' ? 1 : 0)
  const pendingBlocked = Boolean(session.pending_manual_request_ids?.length || ['awaiting_plan', 'workflow_pending', 'workflow_planned', 'workflow_observed', 'repair_pending', 'planned'].includes(session.state))
  const canApply = Boolean(!direct && pendingCount && !pendingBlocked && session.last_turn?.kind !== 'workflow')

  function openInspector(tab: InspectorTab) {
    setInspectorTab(tab)
  }

  function toggleDrawer(next: Exclude<Drawer, ''>) { setDrawer((current) => current === next ? '' : next) }

  const executeLabel = direct ? 'Executar plano diretamente no host' : needsApproval ? 'Aprovar e executar plano' : 'Executar plano na sandbox'

  return <section className={`agent-workspace ${drawer ? 'drawer-open' : ''}`}>
    <header className="agent-commandbar">
      <nav className="agent-surface-tabs" aria-label="Áreas do Agent">
        <button className={inspectorTab === 'plan' ? 'active' : ''} onClick={() => openInspector('plan')}><Icon name="plan" size={15}/><span>Plano</span></button>
        <button className={inspectorTab === 'terminal' ? 'active' : ''} onClick={() => openInspector('terminal')}><Icon name="terminal" size={15}/><span>Execução</span></button>
        <button className={inspectorTab === 'chatgpt' ? 'active' : ''} onClick={() => openInspector('chatgpt')}><Icon name="chatgpt" size={15}/><span>ChatGPT</span></button>
      </nav>
      <div className="agent-command-actions">
        {session.policy && <span className={`agent-policy-icon ${session.policy.allowed ? '' : 'blocked'}`} title={session.policy.allowed ? `Policy autorizada · risco ${session.policy.risk}` : 'Policy bloqueada'} aria-label={session.policy.allowed ? `Policy autorizada, risco ${session.policy.risk}` : 'Policy bloqueada'}><Icon name="shield" size={14}/></span>}
        {canExecute && <button type="button" className={`agent-command-icon ${direct ? 'danger' : ''}`} disabled={busy} onClick={() => void inspectorProps.onExecute(needsApproval || direct)} aria-label={executeLabel} title={executeLabel}><Icon name="play" size={15}/></button>}
        {canApply && <button type="button" className="agent-command-icon reject" disabled={busy} onClick={() => void inspectorProps.onRejectPendingChanges?.()} aria-label="Rejeitar alterações verificadas" title="Rejeitar alterações verificadas"><Icon name="trash" size={14}/></button>}
        {canApply && <button type="button" className="agent-command-icon apply" disabled={busy} onClick={() => void inspectorProps.onApply()} aria-label={`Aplicar alterações verificadas no host${pendingCount > 1 ? ` (${pendingCount})` : ''}`} title="Aplicar alterações verificadas no host"><Icon name="apply" size={15}/>{pendingCount > 1 && <b>{pendingCount}</b>}</button>}
      </div>
    </header>

    <nav className="agent-chat-switcher" aria-label="Conversas do Harness">
      <button className="chat-new-button" disabled={busy} onClick={() => void chatProps.onNewChat()} title="Novo chat"><Icon name="plus" size={14}/> Novo</button>
      <div className="chat-tabs">
        {chatProps.chats.map((chat) => <div key={chat.id} className={chat.id === chatProps.activeChatId ? 'chat-tab-group active' : 'chat-tab-group'}>
          <button className={chat.id === chatProps.activeChatId ? 'chat-tab active' : 'chat-tab'} disabled={busy} onClick={() => void chatProps.onSelectChat(chat.id)} title={chat.chatgptUrl ? `${chat.title}\nChatGPT: ${chat.chatgptUrl}` : `${chat.title}\nChatGPT ainda não vinculado`}><span>{chat.title}</span><i className={chat.chatgptUrl ? 'chat-link-dot linked' : 'chat-link-dot'} aria-hidden="true" /></button>
          <button className="chat-tab-remove" disabled={busy} onClick={() => void chatProps.onArchiveChat(chat.id)} title={`Fechar e arquivar ${chat.title}`} aria-label={`Fechar e arquivar chat ${chat.title}`}><Icon name="close" size={11}/></button>
        </div>)}
      </div>
    </nav>

    <aside className="agent-activity-bar" aria-label="Ferramentas do Agent">
      <button type="button" className={drawer === 'archive' ? 'active' : ''} onClick={() => toggleDrawer('archive')} aria-label="Chats arquivados" title="Chats arquivados"><Icon name="folder" size={18}/>{archived.length > 0 && <b>{archived.length}</b>}</button>
      <button type="button" className={drawer === 'project' ? 'active' : ''} onClick={() => toggleDrawer('project')} aria-label="Explorador do projeto" title="Explorador do projeto"><Icon name="workspace" size={18}/></button>
    </aside>

    {drawer && <aside className="agent-drawer" data-chatgpt-overlay-blocker="true">
      {drawer === 'archive' ? <ArchiveDrawer chats={archived} busy={busy} onRestore={chatProps.onRestoreChat} onDelete={chatProps.onDeleteArchivedChat} onClose={() => setDrawer('')}/> : <AgentProjectExplorer session={session} onOpen={onOpenFile} onError={onError}/>}
    </aside>}

    <div className="agent-chat-stage"><ChatPanel key={chatProps.activeChatId} {...chatProps} embedded hideSwitcher /></div>
    <div className="agent-inspector-stage"><Inspector {...inspectorProps} embedded activeTab={inspectorTab} onTabChange={openInspector} chatgptSuspended={Boolean(inspectorProps.chatgptSuspended || inspectorTab !== 'chatgpt' || drawer)} /></div>
  </section>
}

function ArchiveDrawer({ chats, busy, onRestore, onDelete, onClose }: {
  chats: ComponentProps<typeof ChatPanel>['archivedChats']
  busy: boolean
  onRestore: ComponentProps<typeof ChatPanel>['onRestoreChat']
  onDelete: ComponentProps<typeof ChatPanel>['onDeleteArchivedChat']
  onClose: () => void
}) {
  return <section className="agent-archive-drawer" aria-label="Chats arquivados">
    <header className="agent-drawer-heading"><div><span className="panel-kicker">Chats</span><strong>Arquivados</strong></div><button type="button" className="agent-drawer-icon" onClick={onClose} aria-label="Fechar drawer"><Icon name="close" size={13}/></button></header>
    <div className="agent-archive-list">
      {chats.length ? chats.map((chat) => <article className="agent-archive-item" key={chat.id}>
        <div><strong>{chat.title}</strong><span>{chat.chatgptUrl ? 'ChatGPT vinculado' : 'Sem vínculo ChatGPT'}</span></div>
        <div><button type="button" disabled={busy} onClick={() => void onRestore(chat.id)} aria-label={`Reabrir ${chat.title}`} title="Reabrir"><Icon name="refresh" size={13}/></button><button type="button" className="danger" disabled={busy} onClick={() => void onDelete(chat.id)} aria-label={`Eliminar definitivamente ${chat.title}`} title="Eliminar definitivamente"><Icon name="trash" size={13}/></button></div>
      </article>) : <div className="agent-drawer-empty">Nenhum chat arquivado.</div>}
    </div>
  </section>
}
