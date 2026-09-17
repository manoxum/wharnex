import type { AutomationMode, ExecutionMode, WorkspaceMode } from '../types'
import { Icon } from './Icon'

export function WorkbenchStatusBar({ mode, executionMode, automationMode, terminalOpen, activeExecutions }: {
  mode: WorkspaceMode
  executionMode: ExecutionMode
  automationMode: AutomationMode
  terminalOpen: boolean
  activeExecutions: number
}) {
  return <footer className="workbench-status-bar" aria-label="Estado do workbench">
    <span><Icon name="workspace" size={11}/>{modeLabel(mode)}</span>
    <span><Icon name={executionMode === 'unprotected' ? 'terminal' : 'shield'} size={11}/>{executionMode === 'unprotected' ? 'Host direto' : 'Protected'}</span>
    <span><Icon name={automationMode === 'auto' ? 'play' : 'agent'} size={11}/>{automationMode === 'auto' ? 'Auto' : 'Manual'}</span>
    <span className={terminalOpen ? 'active' : ''}><Icon name="terminal" size={11}/>{terminalOpen ? 'Terminal aberto' : 'Terminal recolhido'}</span>
    {activeExecutions > 0 && <span className="active"><Icon name="refresh" size={11}/>{activeExecutions} em execução</span>}
  </footer>
}

function modeLabel(mode: WorkspaceMode) { return mode === 'editor' ? 'Editor' : mode === 'agent' ? 'Agent' : 'Orchestrator' }
