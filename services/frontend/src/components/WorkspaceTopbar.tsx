import type { AppConfig, AutomationMode, ExecutionMode, Session, WorkspaceMode } from '../types'
import { announceHeaderPopover } from '../lib/headerPopover'
import { Icon } from './Icon'
import { QuickSwitcher } from './QuickSwitcher'
import { ProjectGitBadge } from './ProjectGitBadge'
import { SignalCore } from './SignalCore'

export function WorkspaceTopbar({ config, session, mode, executionMode, automationMode, attention, restartPending = false, restartBlocked = false, busy, onMode, onAttention, onRestartPending, onSettings, onClose, onSession }: {
  config?: AppConfig
  session: Session
  mode: WorkspaceMode
  executionMode: ExecutionMode
  automationMode: AutomationMode
  attention?: { total: number; urgent: number; actionable: number }
  restartPending?: boolean
  restartBlocked?: boolean
  busy: boolean
  onMode: (mode: WorkspaceMode) => void
  onAttention?: () => void
  onRestartPending?: () => void
  onSettings: () => void
  onClose: () => void
  onSession?: (session: Session) => void
}) {
  const projectName = session.project_path.split('/').filter(Boolean).at(-1) || session.project_path
  const automaticPlanner = config?.planner === 'openai' && config.api_configured
  const notificationLabel = `Centro de notificações, ${attention?.total || 0} alerta(s), ${attention?.urgent || 0} urgente(s), ${attention?.actionable || 0} com ação`
  return <header className="workspace-topbar">
    <div className="workspace-identity">
      <SignalCore size="regular" decorative />
      <div><strong>{projectName}</strong><span title={session.project_path}>{session.project_path}</span></div>
    </div>
    <div className="workspace-switches">
      <ProjectGitBadge session={session} busy={busy} onSession={onSession} />
      <div className="mode-switch" role="group" aria-label="Modo do workspace">
        <button className={mode === 'editor' ? 'active' : ''} aria-label="Editor" title="Editor" onClick={() => { announceHeaderPopover('workspace-action'); onMode('editor') }}><Icon name="code" size={15}/></button>
        <button className={mode === 'agent' ? 'active' : ''} aria-label="Agent" title="Agent" onClick={() => { announceHeaderPopover('workspace-action'); onMode('agent') }}><Icon name="agent" size={15}/></button>
        <button className={mode === 'orchestrator' ? 'active' : ''} aria-label="Orchestrator" title="Orchestrator" onClick={() => { announceHeaderPopover('workspace-action'); onMode('orchestrator') }}><Icon name="plan" size={15}/></button>
      </div>
    </div>
    <div className="workspace-status">
      {session.self_evolution && <TopbarIndicator tone="warning" label="Auto-evolução ativa" visibleLabel="WHX · AUTO-EVOLUÇÃO" icon="refresh" />}
      {restartPending && <button className="topbar-indicator warning actionable restart" type="button" disabled={busy || restartBlocked} title={restartBlocked ? 'Conclua a tarefa ativa antes de reiniciar o Wharnex' : 'Alterações prontas · reinício pendente'} aria-label="Reinício pendente" onClick={() => { announceHeaderPopover('workspace-action'); onRestartPending?.() }}><Icon name="refresh" size={14}/><span className="indicator-dot"/></button>}
      {executionMode === 'unprotected' && <TopbarIndicator tone="danger" label="Host direto · Unprotected" icon="terminal" />}
      {executionMode === 'full' && <TopbarIndicator tone="danger" label="Host direto · Full" icon="terminal" />}
      {automationMode === 'auto' && <TopbarIndicator tone="success" label="Automação automática" icon="play" />}
      {automationMode === 'auto_approve' && <TopbarIndicator tone="warning" label="Automação automática com aprovação automática" visibleLabel="AUTO + APROVAR" icon="play" />}
      <TopbarIndicator tone={automaticPlanner ? 'success' : 'neutral'} label={config?.planner === 'openai' ? 'AI automático' : 'AI manual'} icon={config?.planner === 'openai' ? 'chatgpt' : 'agent'} />
      <QuickSwitcher compact />
      <button className={`icon-button workspace-attention-button${attention?.total ? ' has-alerts' : ''}${attention?.urgent ? ' urgent' : ''}`} data-attention-trigger="true" type="button" aria-label={notificationLabel} title="Notificações · ver alertas recentes" onClick={() => { announceHeaderPopover('attention'); onAttention?.() }}><Icon name="bell" size={17}/>{Boolean(attention?.total) && <b className="workspace-attention-count" aria-hidden="true">{attention!.total > 99 ? '99+' : attention!.total}</b>}</button>
      <button className="icon-button" aria-label="Configuração do projeto" title="Configuração do projeto" onClick={() => { announceHeaderPopover('settings'); onSettings() }}><Icon name="settings" size={16}/></button>
      <button className="icon-button" aria-label="Fechar workspace" title="Fechar workspace" onClick={() => { announceHeaderPopover('workspace-action'); onClose() }}><Icon name="close" size={16}/></button>
    </div>
  </header>
}

function TopbarIndicator({ tone, label, visibleLabel, icon, status = false }: { tone: 'neutral' | 'success' | 'warning' | 'danger'; label: string; visibleLabel?: string; icon: 'refresh' | 'terminal' | 'play' | 'chatgpt' | 'agent'; status?: boolean }) {
  return <span className={`topbar-indicator ${tone}${visibleLabel ? ' labelled' : ''}`} role={status ? 'status' : 'img'} aria-live={status ? 'polite' : undefined} aria-label={label} title={label}><Icon name={icon} size={14}/>{visibleLabel && <b>{visibleLabel}</b>}</span>
}
