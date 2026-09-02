import type { AppConfig, ExecutionMode, Session, WorkspaceMode } from '../types'
import { Icon } from './Icon'
import { StatusPill } from './StatusPill'

export function WorkspaceTopbar({ config, session, mode, executionMode, busy, onMode, onExecutionMode, onClose }: {
  config?: AppConfig
  session: Session
  mode: WorkspaceMode
  executionMode: ExecutionMode
  busy: boolean
  onMode: (mode: WorkspaceMode) => void
  onExecutionMode: (mode: ExecutionMode) => void
  onClose: () => void
}) {
  const projectName = session.project_path.split('/').filter(Boolean).at(-1) || session.project_path
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
      <div className={`protection-switch ${executionMode}`} role="group" aria-label="Proteção de execução do projeto">
        <button disabled={busy} className={executionMode === 'protected' ? 'active' : ''} onClick={() => void onExecutionMode('protected')} title="Executa o plano primeiro na sandbox Docker"><Icon name="shield" size={13}/> Protected</button>
        <button disabled={busy} className={executionMode === 'unprotected' ? 'active' : ''} onClick={() => void onExecutionMode('unprotected')} title="Executa o plano diretamente no projeto real">Unprotected</button>
      </div>
    </div>
    <div className="workspace-status">
      {executionMode === 'unprotected' && <StatusPill tone="warning">HOST DIRETO</StatusPill>}
      <StatusPill tone={config?.planner === 'openai' && config.api_configured ? 'success' : 'neutral'}>{config?.planner === 'openai' ? 'AI automático' : 'AI manual'}</StatusPill>
      <button className="icon-button" title="Fechar workspace" onClick={onClose}><Icon name="close" size={16}/></button>
    </div>
  </header>
}
