import type { AppConfig, AutomationMode, ExecutionMode, Session, WorkspaceMode } from '../types'
import { Icon } from './Icon'
import { ThemeToggle } from './ThemeToggle'

export function WorkspaceTopbar({ config, session, mode, executionMode, automationMode, restartPending = false, restartBlocked = false, busy, onMode, onRestartPending, onSettings, onClose }: {
  config?: AppConfig
  session: Session
  mode: WorkspaceMode
  executionMode: ExecutionMode
  automationMode: AutomationMode
  restartPending?: boolean
  restartBlocked?: boolean
  busy: boolean
  onMode: (mode: WorkspaceMode) => void
  onRestartPending?: () => void
  onSettings: () => void
  onClose: () => void
}) {
  const projectName = session.project_path.split('/').filter(Boolean).at(-1) || session.project_path
  const automaticPlanner = config?.planner === 'openai' && config.api_configured
  return <header className="workspace-topbar">
    <div className="workspace-identity">
      <div className="brand-mark">K</div>
      <div><strong>{projectName}</strong><span title={session.project_path}>{session.project_path}</span></div>
    </div>
    <div className="workspace-switches">
      <div className="mode-switch" role="group" aria-label="Modo do workspace">
        <button className={mode === 'editor' ? 'active' : ''} onClick={() => onMode('editor')}><Icon name="code" size={15}/> Editor</button>
        <button className={mode === 'agent' ? 'active' : ''} onClick={() => onMode('agent')}><Icon name="agent" size={15}/> Agent</button>
      </div>
    </div>
    <div className="workspace-status">
      {session.self_evolution && <TopbarIndicator tone="warning" label="Auto-evolução ativa" icon="refresh" />}
      {restartPending && <button className="topbar-indicator warning actionable restart" type="button" disabled={busy || restartBlocked} title={restartBlocked ? 'Conclua a tarefa ativa antes de reiniciar o Wharness' : 'Alterações prontas · reinício pendente'} aria-label="Reinício pendente" onClick={onRestartPending}><Icon name="refresh" size={14}/><span className="indicator-dot"/></button>}
      {executionMode === 'unprotected' && <TopbarIndicator tone="danger" label="Host direto · Unprotected" icon="terminal" />}
      {automationMode === 'auto' && <TopbarIndicator tone="success" label="Automação automática" icon="play" />}
      <TopbarIndicator tone={automaticPlanner ? 'success' : 'neutral'} label={config?.planner === 'openai' ? 'AI automático' : 'AI manual'} icon={config?.planner === 'openai' ? 'chatgpt' : 'agent'} />
      <ThemeToggle compact />
      <button className="icon-button" aria-label="Configuração do projeto" title="Configuração do projeto" onClick={onSettings}><Icon name="settings" size={16}/></button>
      <button className="icon-button" aria-label="Fechar workspace" title="Fechar workspace" onClick={onClose}><Icon name="close" size={16}/></button>
    </div>
  </header>
}

function TopbarIndicator({ tone, label, icon }: { tone: 'neutral' | 'success' | 'warning' | 'danger'; label: string; icon: 'refresh' | 'terminal' | 'play' | 'chatgpt' | 'agent' }) {
  return <span className={`topbar-indicator ${tone}`} role="img" aria-label={label} title={label}><Icon name={icon} size={14}/></span>
}
