import type { AutomationMode, ExecutionMode, WorkspaceMode } from '../../../types'
import { automationModeLabel, isAutomaticAutomationMode } from '../../../lib/agent/runtime/automationMode'
import { Icon } from '../../presentation/chrome/Icon'
import { BundleConsumption } from '../bundles'

export function WorkbenchStatusBar({ mode, executionMode, automationMode, terminalOpen, activeExecutions, bundleRefreshKey = '' }: {
  mode: WorkspaceMode
  executionMode: ExecutionMode
  automationMode: AutomationMode
  terminalOpen: boolean
  activeExecutions: number
  bundleRefreshKey?: string
}) {
  return <footer className="workbench-status-bar" aria-label="Estado do workspace">
    <span><Icon name="workspace" size={13}/>{mode === 'agent' ? 'Agent' : mode === 'editor' ? 'Editor' : 'Orchestrator'}</span>
    <span><Icon name={executionMode === 'protected' ? 'shield' : 'terminal'} size={13}/>{executionMode === 'protected' ? 'Protected' : 'Host direto'}</span>
    <span><Icon name={isAutomaticAutomationMode(automationMode) ? 'play' : 'agent'} size={13}/>{automationModeLabel(automationMode)}</span>
    <span className={terminalOpen ? 'active' : ''}><Icon name="terminal" size={13}/>{terminalOpen ? 'Terminal aberto' : 'Terminal recolhido'}</span>
    {activeExecutions > 0 && <span className="active"><Icon name="refresh" size={13}/>{activeExecutions} em execução</span>}
    <BundleConsumption refreshKey={bundleRefreshKey}/>
  </footer>
}
