import type { AppConfig, Session, WorkspaceMode } from '../types'
import { Icon } from './Icon'
import { StatusPill } from './StatusPill'

export function WorkspaceTopbar({ config, session, mode, onMode, onClose }: {
  config?: AppConfig
  session: Session
  mode: WorkspaceMode
  onMode: (mode: WorkspaceMode) => void
  onClose: () => void
}) {
  const projectName = session.project_path.split('/').filter(Boolean).at(-1) || session.project_path
  return <header className="workspace-topbar">
    <div className="workspace-identity">
      <div className="brand-mark">K</div>
      <div><strong>{projectName}</strong><span title={session.project_path}>{session.project_path}</span></div>
    </div>
    <div className="mode-switch" role="group" aria-label="Modo do workspace">
      <button className={mode === 'editor' ? 'active' : ''} onClick={() => onMode('editor')}><Icon name="code" size={15}/> Editor</button>
      <button className={mode === 'agent' ? 'active' : ''} onClick={() => onMode('agent')}><Icon name="agent" size={15}/> Agent</button>
    </div>
    <div className="workspace-status">
      <StatusPill tone={config?.planner === 'openai' && config.api_configured ? 'success' : 'neutral'}>{config?.planner === 'openai' ? 'AI automático' : 'AI manual'}</StatusPill>
      <button className="icon-button" title="Fechar workspace" onClick={onClose}><Icon name="close" size={16}/></button>
    </div>
  </header>
}
