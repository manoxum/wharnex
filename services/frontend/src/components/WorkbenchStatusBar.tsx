import { useEffect, useState } from 'react'
import type { AutomationMode, BundleQuota, ExecutionMode, WorkspaceMode } from '../types'
import { api } from '../lib/api'
import { automationModeLabel, isAutomaticAutomationMode } from '../lib/automationMode'
import { Icon } from './Icon'

export function WorkbenchStatusBar({ mode, executionMode, automationMode, terminalOpen, activeExecutions, bundleRefreshKey = '' }: {
  mode: WorkspaceMode
  executionMode: ExecutionMode
  automationMode: AutomationMode
  terminalOpen: boolean
  activeExecutions: number
  bundleRefreshKey?: string
}) {
  const [bundleQuota, setBundleQuota] = useState<BundleQuota>()
  useEffect(() => {
    let alive = true
    const refresh = () => { void api.bundleQuota().then((value) => { if (alive) setBundleQuota(value) }).catch(() => {}) }
    refresh()
    const timer = window.setInterval(refresh, 60_000)
    return () => { alive = false; window.clearInterval(timer) }
  }, [bundleRefreshKey])

  return <footer className="workbench-status-bar" aria-label="Estado do workspace">
    <span><Icon name="workspace" size={11}/>{mode === 'agent' ? 'Agent' : mode === 'editor' ? 'Editor' : 'Orchestrator'}</span>
    <span><Icon name={executionMode === 'protected' ? 'shield' : 'terminal'} size={11}/>{executionMode === 'protected' ? 'Protected' : 'Host direto'}</span>
    <span><Icon name={isAutomaticAutomationMode(automationMode) ? 'play' : 'agent'} size={11}/>{automationModeLabel(automationMode)}</span>
    <span className={terminalOpen ? 'active' : ''}><Icon name="terminal" size={11}/>{terminalOpen ? 'Terminal aberto' : 'Terminal recolhido'}</span>
    {activeExecutions > 0 && <span className="active"><Icon name="refresh" size={11}/>{activeExecutions} em execução</span>}
    {bundleQuota && <BundleConsumption quota={bundleQuota}/>}
  </footer>
}

function BundleConsumption({ quota }: { quota: BundleQuota }) {
  const usedRatio = quota.limit > 0 ? Math.min(1, Math.max(0, quota.sent / quota.limit)) : 0
  const remaining = Math.max(0, Math.round((1 - usedRatio) * 100))
  const detail = `Bundles nas últimas ${quota.window_hours} horas: ${remaining}% restante; ${quota.sent} de ${quota.limit} enviados; ${quota.received} recebidos${quota.warning ? '; limite local atingido, novos pedidos continuam permitidos' : ''}.`
  return <div className={`workbench-bundle-meter${quota.warning ? ' warning' : ''}`} role="group" aria-label={detail} title={detail}>
    <span className="workbench-bundle-meter-label"><Icon name="send" size={12}/><b>{quota.window_hours}h</b><small>↑{quota.sent}/{quota.limit} ↓{quota.received}</small></span>
    <span className="workbench-bundle-meter-track" aria-hidden="true"><i style={{ width: `${remaining}%` }}/></span>
    <strong>{remaining}%</strong>
  </div>
}
