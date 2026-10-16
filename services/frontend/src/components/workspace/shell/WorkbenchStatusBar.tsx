import type { AutomationMode, ExecutionMode, WorkspaceMode } from '../../../types'
import { automationModeLabel, isAutomaticAutomationMode } from '../../../lib/agent/runtime/automationMode'
import { Icon } from '../../presentation/chrome/Icon'
import { BundleConsumption } from '../bundles'
import { LayoutControls, type LayoutControlsProps } from './layout'

export function WorkbenchStatusBar({ mode, executionMode, automationMode, terminalOpen, activeExecutions, bundleRefreshKey = '', layout }: {
  mode: WorkspaceMode
  executionMode: ExecutionMode
  automationMode: AutomationMode
  terminalOpen: boolean
  activeExecutions: number
  bundleRefreshKey?: string
  layout?: LayoutControlsProps
}) {
  return <footer className="workbench-status-bar flex min-h-7 shrink-0 items-center gap-4 border-t border-whx-border-soft bg-whx-surface px-3 text-whx-caption text-whx-faint" aria-label="Estado do workspace">
    <span className="inline-flex shrink-0 items-center gap-1.5"><Icon name="workspace" size={13}/>{mode === 'agent' ? 'Agent' : mode === 'editor' ? 'Editor' : 'Orchestrator'}</span>
    <span className={`inline-flex shrink-0 items-center gap-1.5 ${executionMode !== 'protected' ? 'text-whx-warning' : ''}`}><Icon name={executionMode === 'protected' ? 'shield' : 'terminal'} size={13}/>{executionMode === 'protected' ? 'Protected' : executionMode === 'full' ? 'Host direto · Full' : 'Host direto · Unprotected'}</span>
    <span className="hidden items-center gap-1.5 min-[900px]:inline-flex"><Icon name={isAutomaticAutomationMode(automationMode) ? 'play' : 'agent'} size={13}/>{automationModeLabel(automationMode)}</span>
    <span className="sr-only">{terminalOpen ? 'Terminal aberto' : 'Terminal recolhido'}</span>
    {activeExecutions > 0 && <span className="inline-flex items-center gap-1.5 text-whx-text"><Icon name="refresh" size={13}/>{activeExecutions} em execução</span>}
    <div className="hidden min-[1100px]:block"><BundleConsumption refreshKey={bundleRefreshKey}/></div>
    {layout && <LayoutControls {...layout}/>}
  </footer>
}
