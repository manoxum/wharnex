import { useEffect, useLayoutEffect, useState } from 'react'
import { desktopBridge } from '../../../lib/desktop/bridge/desktop'
import type { BrowserMonitorChat } from '../../../lib/transport/http/browser-monitor/catalog'
import { applyUIPreferences, loadUIPreferences, subscribeUIPreferences } from '../../../lib/workspace/preferences/uiPreferences'
import { BrowserMonitorDetails } from './BrowserMonitorDetails'
import { BrowserMonitorLegend } from './BrowserMonitorLegend'
import { BrowserMonitorList } from './BrowserMonitorList'
import { BrowserViewport } from './BrowserViewport'
import { BrowserLinkViewport } from './BrowserLinkViewport'
import { agentForChat, browserHasPage } from './browserMonitorModel'
import { BrowserMonitorPolicies } from './BrowserMonitorPolicies'
import { MonitorHeader, MonitorLocation, monitorGridColumns, useMonitorLayout } from './presentation'
import { EmptyState } from '../../presentation/workbench'

const requestedAgent = () => { try { return new URLSearchParams(window.location.search).get('agent') || '' } catch { return '' } }

export function BrowserMonitor() {
  const bridge = desktopBridge()?.agents
  const [runtime, setRuntime] = useState<DesktopAgentRuntimeState>()
  const [selectedId, setSelectedId] = useState(requestedAgent)
  const [policiesOpen, setPoliciesOpen] = useState(false)
  const [error, setError] = useState('')
  const policyPanelOpen = policiesOpen && Boolean(runtime)
  const { listOpen, detailsOpen, focused, toggleList, toggleDetails, toggleFocus } = useMonitorLayout(policyPanelOpen)
  const [explorerOpen, setExplorerOpen] = useState(false)
  const [selectedLink, setSelectedLink] = useState<BrowserMonitorChat>()

  useLayoutEffect(() => {
    applyUIPreferences(loadUIPreferences())
    return subscribeUIPreferences(() => undefined)
  }, [])

  useEffect(() => {
    if (!bridge) return
    let alive = true
    const refresh = async () => {
      try { const state = await bridge.state(); if (alive) { setRuntime(state); setError('') } }
      catch (cause) { if (alive) setError(cause instanceof Error ? cause.message : 'Runtime indisponível') }
    }
    void refresh()
    const off = bridge.onState((state) => { if (alive) setRuntime(state) })
    // The tray or a project's "open window" action names the instance to show.
    const offSelect = bridge.onMonitorSelect?.(({ agentId }) => { if (alive && agentId) { setSelectedLink(undefined); setSelectedId(agentId) } }) || (() => undefined)
    const timer = window.setInterval(() => { void refresh() }, 5_000)
    return () => { alive = false; off(); offSelect(); window.clearInterval(timer) }
  }, [bridge])

  const linkedAgent = selectedLink ? agentForChat(runtime?.agents || [], selectedLink) : undefined
  const selected = selectedLink ? linkedAgent : runtime?.agents.find((agent) => agent.id === selectedId)
    || runtime?.agents.find((agent) => agent.occupied && browserHasPage(agent))
    || runtime?.agents.find(browserHasPage)
    || runtime?.agents.find((agent) => agent.browser.available) || runtime?.agents[0]
  const detailsAgent: DesktopAgentRuntimeAgent | undefined = selectedLink && !linkedAgent ? {
    id: `link:${selectedLink.key}`, label: selectedLink.title, role: 'worker', status: 'idle', draining: false,
    chat_id: selectedLink.chat_id, project_id: selectedLink.project_path, error: '',
    browser: { available: true, web_contents_id: 0, url: selectedLink.url, title: selectedLink.title, loading: false },
  } : selected
  const total = runtime?.agents.length || 0
  const working = runtime?.agents.filter((agent) => agent.occupied).length || 0
  const attention = Boolean(runtime?.provider?.paused || runtime?.worker_pause?.paused)
  // The policies column shares the row with the real browser, which shrinks
  // instead of being covered: nothing can be drawn over the native view.
  const columns = monitorGridColumns(window.innerWidth, { list: listOpen, details: detailsOpen }, policyPanelOpen)

  return <main className="flex h-screen min-h-0 flex-col overflow-hidden bg-whx-bg font-sans text-whx-text">
    <MonitorHeader working={working} total={total} attention={attention} available={Boolean(runtime)} policiesOpen={policiesOpen} onPolicies={() => setPoliciesOpen((open) => !open)} focused={focused} onFocus={() => { toggleFocus(); setPoliciesOpen(false) }}/>
    <BrowserMonitorLegend />
    {error ? <p className="border-b border-whx-danger bg-[color-mix(in_srgb,var(--theme-danger)_10%,transparent)] px-7 py-2 text-whx-label text-whx-danger" role="alert">{error}</p> : null}
    <div className="grid min-h-0 min-w-0 flex-1" style={{ gridTemplateColumns: columns }}>
      <BrowserMonitorList agents={runtime?.agents || []} selectedId={selected?.id || ''} onSelect={(id) => { setSelectedLink(undefined); setSelectedId(id) }} selectedLinkKey={selectedLink?.key || ''} onSelectLink={setSelectedLink} onInstancesView={() => setSelectedLink(undefined)} expanded={listOpen} onToggle={toggleList} />
      <BrowserMonitorDetails agent={detailsAgent} link={selectedLink} expanded={detailsOpen} onToggle={toggleDetails} onExplorerOpenChange={setExplorerOpen} />
      <section className="flex min-h-0 min-w-0 flex-col bg-whx-bg" aria-label="Navegador da instância">
        <MonitorLocation url={selectedLink?.url || selected?.browser.url} loading={selected?.browser.loading} label={selectedLink ? 'Conversa' : selected?.label}/>
        {selectedLink && !linkedAgent ? <BrowserLinkViewport key={selectedLink.key} chat={selectedLink} suspended={explorerOpen} /> : selected ? <BrowserViewport key={selected.id} agent={selected} suspended={explorerOpen} /> : <EmptyState icon="monitor" title="Selecione uma instância" description="Escolha um Supervisor, Worker ou conversa na lista para acompanhar o navegador."/>}
      </section>
      {policyPanelOpen && runtime ? <div id="browser-monitor-policies" className="contents"><BrowserMonitorPolicies runtime={runtime} onRuntime={setRuntime} onError={setError} onClose={() => setPoliciesOpen(false)} /></div> : null}
    </div>
  </main>
}
