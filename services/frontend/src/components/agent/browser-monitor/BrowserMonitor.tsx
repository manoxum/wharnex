import { useEffect, useMemo, useState } from 'react'
import { desktopBridge } from '../../../lib/desktop/bridge/desktop'
import { BrowserMonitorDetails } from './BrowserMonitorDetails'
import { BrowserMonitorLegend } from './BrowserMonitorLegend'
import { BrowserMonitorList } from './BrowserMonitorList'
import { BrowserViewport } from './BrowserViewport'
import { browserHasPage } from './browserMonitorModel'
import { BrowserMonitorPolicies } from './BrowserMonitorPolicies'

const requestedAgent = () => { try { return new URLSearchParams(window.location.search).get('agent') || '' } catch { return '' } }

export function BrowserMonitor() {
  const bridge = desktopBridge()?.agents
  const [runtime, setRuntime] = useState<DesktopAgentRuntimeState>()
  const [selectedId, setSelectedId] = useState(requestedAgent)
  const [policiesOpen, setPoliciesOpen] = useState(false)
  const [error, setError] = useState('')
  const [listOpen, setListOpen] = useState(true)
  const [detailsOpen, setDetailsOpen] = useState(true)

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
    const offSelect = bridge.onMonitorSelect?.(({ agentId }) => { if (alive && agentId) setSelectedId(agentId) }) || (() => undefined)
    const timer = window.setInterval(() => { void refresh() }, 5_000)
    return () => { alive = false; off(); offSelect(); window.clearInterval(timer) }
  }, [bridge])

  const selected = useMemo(() => runtime?.agents.find((agent) => agent.id === selectedId)
    || runtime?.agents.find((agent) => agent.occupied && browserHasPage(agent))
    || runtime?.agents.find(browserHasPage)
    || runtime?.agents.find((agent) => agent.browser.available) || runtime?.agents[0], [runtime, selectedId])
  const total = runtime?.agents.length || 0
  const working = runtime?.agents.filter((agent) => agent.occupied).length || 0
  const attention = Boolean(runtime?.provider?.paused || runtime?.worker_pause?.paused)
  // The policies column shares the row with the real browser, which shrinks
  // instead of being covered: nothing can be drawn over the native view.
  const columns = [listOpen ? 'minmax(220px,19vw)' : '44px', detailsOpen ? 'minmax(270px,24vw)' : '44px', 'minmax(0,1fr)', ...(policiesOpen && runtime ? ['minmax(300px,25vw)'] : [])].join(' ')

  return <main className="flex h-screen min-h-[520px] flex-col overflow-hidden bg-[#0a111b] font-sans text-slate-100">
    <header className="flex min-h-[88px] items-center justify-between gap-4 border-b border-white/[.07] bg-[#0d1622] px-7">
      <div className="flex items-center gap-4"><span className="grid h-10 w-10 place-items-center rounded-xl border border-cyan-300/20 bg-cyan-300/[.08] text-cyan-300"><svg width="21" height="21" viewBox="0 0 24 24" fill="none" aria-hidden="true"><rect x="2.5" y="4" width="19" height="15" rx="2.5" stroke="currentColor" strokeWidth="1.5"/><path d="M2.5 9h19M8 22h8M12 19v3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg></span><div><p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-cyan-300">Wharnex · Runtime ChatGPT</p><h1 className="mt-1 text-[20px] font-semibold tracking-tight text-white">Instâncias dos navegadores</h1></div></div>
      <div className="flex items-center gap-2">
        <span className="hidden items-center gap-2 rounded-full border border-emerald-400/20 bg-emerald-400/[.06] px-3 py-1.5 text-[11px] font-medium text-emerald-300 sm:flex"><span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />{working} em trabalho</span><span className="rounded-full border border-white/10 bg-white/[.04] px-3 py-1.5 text-[11px] font-medium text-slate-300">{total} instâncias</span>
        <span className="mx-1 h-5 w-px bg-white/[.08]" aria-hidden="true" />
        <button type="button" aria-expanded={policiesOpen} aria-controls="browser-monitor-policies" title={attention ? 'Políticas · há suspensões ativas' : 'Políticas do runtime'} disabled={!runtime} onClick={() => setPoliciesOpen((open) => !open)}
          className={`relative inline-flex h-8 items-center gap-2 rounded-lg border px-3 text-[12px]! font-medium! leading-none! transition ${policiesOpen ? 'border-cyan-400/45 bg-cyan-400/[.1]! text-cyan-200' : 'border-white/[.12] bg-transparent! text-slate-300 hover:border-cyan-400/40 hover:text-cyan-200'}`}>
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M2.5 4.5h6M11.5 4.5h2M2.5 11.5h2M7.5 11.5h6" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/><circle cx="10" cy="4.5" r="1.6" stroke="currentColor" strokeWidth="1.4"/><circle cx="6" cy="11.5" r="1.6" stroke="currentColor" strokeWidth="1.4"/></svg>
          Políticas
          {attention ? <span className="absolute -top-1 -right-1 h-2.5 w-2.5 rounded-full border-2 border-[#0d1622] bg-amber-400" aria-hidden="true" /> : null}
        </button>
      </div>
    </header>
    <BrowserMonitorLegend />
    {error ? <p className="border-b border-rose-400/20 bg-rose-400/[.06] px-7 py-2 text-[12px] text-rose-200" role="alert">{error}</p> : null}
    <div className="grid min-h-0 flex-1" style={{ gridTemplateColumns: columns }}>
      <BrowserMonitorList agents={runtime?.agents || []} selectedId={selected?.id || ''} onSelect={setSelectedId} expanded={listOpen} onToggle={() => setListOpen((open) => !open)} />
      <BrowserMonitorDetails agent={selected} expanded={detailsOpen} onToggle={() => setDetailsOpen((open) => !open)} />
      <section className="flex min-h-0 flex-col bg-[#0b1420]" aria-label="Navegador da instância">
        {selected ? <BrowserViewport key={selected.id} agent={selected} /> : <div className="grid flex-1 place-items-center text-[13px] text-slate-400">Selecione uma instância para acompanhar.</div>}
      </section>
      {policiesOpen && runtime ? <div id="browser-monitor-policies" className="contents"><BrowserMonitorPolicies runtime={runtime} onRuntime={setRuntime} onError={setError} onClose={() => setPoliciesOpen(false)} /></div> : null}
    </div>
  </main>
}
