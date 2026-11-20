import type { AppConfig, AutomationMode, ExecutionMode, Session, WorkspaceMode } from '../../../types'
import { announceHeaderPopover } from '../../../lib/desktop/bridge/headerPopover'
import { Icon } from '../../presentation/chrome/Icon'
import { QuickSwitcher } from './QuickSwitcher'
import { CommandLauncher } from './commands'
import { ProjectGitBadge } from '../../git/history/ProjectGitBadge'
import { SignalCore } from '../../presentation/chrome/SignalCore'

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
  return <header className="workspace-topbar !grid !h-11 !basis-auto !shrink-0 !items-center !border-b !border-whx-border !bg-whx-rail !py-0 !text-whx-text min-[900px]:[html[data-density=compact]_&]:!h-10 !min-w-0 !grid-cols-[minmax(64px,1fr)_auto_auto] !gap-3 !px-3 max-[900px]:!h-auto max-[900px]:!min-h-[58px] max-[900px]:!basis-auto max-[900px]:!grid-cols-[minmax(0,1fr)_auto] max-[900px]:!gap-x-2 max-[900px]:!gap-y-1 max-[900px]:!px-2 max-[900px]:!py-1">
    <div className="flex min-w-0 items-center gap-2.5 max-[900px]:!col-start-1 max-[900px]:!row-start-1">
      <SignalCore size="regular" decorative />
      <div className="min-w-0" title={session.project_path}><strong className="block truncate text-whx-title font-semibold text-whx-text">{projectName}</strong><span className="hidden max-w-[240px] truncate font-mono text-whx-caption text-whx-faint min-[1280px]:block">{session.project_path}</span></div>
    </div>
    <div className="workspace-switches !min-w-0 max-[900px]:!col-span-2 max-[900px]:!col-start-1 max-[900px]:!row-start-2 max-[900px]:!justify-self-center [&_.project-git-badge]:!max-w-[220px] [&_.project-git-badge]:max-[900px]:!max-w-[130px] [&_.project-git-version]:max-[1100px]:!hidden">
      <ProjectGitBadge session={session} busy={busy} onSession={onSession} />
      <div className="mode-switch" role="group" aria-label="Modo do workspace">
        <button className={mode === 'editor' ? 'active' : ''} aria-label="Editor" title="Editor" onClick={() => { announceHeaderPopover('workspace-action'); onMode('editor') }}><Icon name="code" size={15}/></button>
        <button className={mode === 'agent' ? 'active' : ''} aria-label="Agent" title="Agent" onClick={() => { announceHeaderPopover('workspace-action'); onMode('agent') }}><Icon name="agent" size={15}/></button>
        <button className={mode === 'orchestrator' ? 'active' : ''} aria-label="Orchestrator" title="Orchestrator" onClick={() => { announceHeaderPopover('workspace-action'); onMode('orchestrator') }}><Icon name="plan" size={15}/></button>
      </div>
    </div>
    <div className="workspace-status max-[900px]:!col-start-2 max-[900px]:!row-start-1 max-[900px]:!min-w-0 max-[640px]:!flex-wrap">
      <CommandLauncher/>
      {session.self_evolution && <TopbarIndicator tone="warning" label="Auto-evolução ativa" visibleLabel="WHX · AUTO-EVOLUÇÃO" icon="refresh" />}
      {restartPending && <button className="topbar-indicator warning actionable restart" type="button" disabled={busy || restartBlocked} title={restartBlocked ? 'Conclua a tarefa ativa antes de reiniciar o Wharnex' : 'Alterações prontas · reinício pendente'} aria-label="Reinício pendente" onClick={() => { announceHeaderPopover('workspace-action'); onRestartPending?.() }}><Icon name="refresh" size={14}/><span className="indicator-dot"/></button>}
      {executionMode === 'unprotected' && <TopbarIndicator tone="danger" label="Host direto · Unprotected" icon="terminal" />}
      {executionMode === 'full' && <TopbarIndicator tone="danger" label="Host direto · Full" icon="terminal" />}
      {automationMode === 'auto_approve' && <TopbarIndicator tone="warning" label="Automação automática com aprovação automática" visibleLabel="AUTO + APROVAR" icon="play" />}
      <span className="sr-only">{automationMode === 'auto' && <TopbarIndicator tone="success" label="Automação automática" icon="play" />}
      <TopbarIndicator tone={automaticPlanner ? 'success' : 'neutral'} label={config?.planner === 'openai' ? 'AI automático' : 'AI manual'} icon={config?.planner === 'openai' ? 'chatgpt' : 'agent'} /></span>
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
