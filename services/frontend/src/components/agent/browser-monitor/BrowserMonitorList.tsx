import { activityLabel, activeTask, operationalState, stateDot } from './browserMonitorModel'
import { BrowserMonitorPanelToggle } from './BrowserMonitorPanelToggle'
import { BrowserMonitorLinks } from './BrowserMonitorLinks'
import { useState } from 'react'
import type { BrowserMonitorChat } from '../../../lib/transport/http/browser-monitor/catalog'

function AgentGroup({ title, agents, selectedId, onSelect }: {
  title: string; agents: DesktopAgentRuntimeAgent[]; selectedId: string; onSelect: (id: string) => void
}) {
  if (!agents.length) return null
  return <div className="mb-7">
    <div className="mb-3 flex items-center justify-between px-2"><h2 className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">{title}</h2><span className="rounded-md bg-white/[.05] px-2 py-0.5 text-[11px] text-slate-400">{agents.length}</span></div>
    <div className="space-y-1.5">{agents.map((agent) => {
      const selected = selectedId === agent.id
      const task = activeTask(agent)
      return <button key={agent.id} type="button" aria-pressed={selected} onClick={() => onSelect(agent.id)}
        className={`group flex w-full items-center gap-3 rounded-xl border px-3 py-3 text-left text-slate-100 transition duration-150 ${selected ? 'border-cyan-400/45 bg-[#0c2835]! shadow-[inset_3px_0_0_0_#22d3ee]' : 'border-transparent bg-transparent! hover:border-white/10 hover:bg-white/[.045]!'}`}>
        <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${stateDot(operationalState(agent).key)}`} aria-hidden="true" />
        <span className="min-w-0 flex-1"><strong className="block truncate text-[13px] font-semibold leading-5 text-slate-100">{agent.label}</strong><small className="block truncate text-[11px] leading-4 text-slate-400">{activityLabel(agent)}</small></span>
        {task ? <span className="max-w-[72px] truncate rounded-md bg-white/[.07] px-2 py-1 text-[10px] font-medium text-slate-300" title={task.type}>{task.type.replace('ORCHESTRATOR_', '')}</span> : null}
        <svg className={`h-3.5 w-3.5 shrink-0 ${selected ? 'text-cyan-300' : 'text-slate-600 group-hover:text-slate-400'}`} viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="m6 3 5 5-5 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
      </button>
    })}</div>
  </div>
}

export function BrowserMonitorList({ agents, selectedId, onSelect, selectedLinkKey, onSelectLink, onInstancesView, expanded, onToggle }: { agents: DesktopAgentRuntimeAgent[]; selectedId: string; onSelect: (id: string) => void; selectedLinkKey: string; onSelectLink: (chat: BrowserMonitorChat) => void; onInstancesView: () => void; expanded: boolean; onToggle: () => void }) {
  const [view, setView] = useState<'instances' | 'links'>('instances')
  const changeView = (next: 'instances' | 'links') => { setView(next); if (next === 'instances') onInstancesView() }
  return <aside className={`min-h-0 overflow-y-auto border-r border-white/[.07] bg-[#0e1723] ${expanded ? 'px-4 py-6' : 'px-1.5 py-4'}`} aria-label="Instâncias">
    {expanded ? <>
    <div className="mb-4 px-2"><div className="flex items-center justify-between gap-2"><p className="text-[11px] font-medium uppercase tracking-[0.16em] text-slate-500">Navegadores</p><BrowserMonitorPanelToggle panel="lista de instâncias" expanded onToggle={onToggle} /></div><p className="mt-1 text-[13px] text-slate-300">Selecione uma instância para acompanhar.</p></div>
    <div className="mb-6 grid grid-cols-2 gap-1 rounded-xl border border-white/[.08] bg-black/20 p-1" role="tablist" aria-label="Visões dos navegadores" onKeyDown={(event) => {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
      event.preventDefault()
      const next = event.key === 'Home' ? 'instances' : event.key === 'End' ? 'links' : view === 'instances' ? 'links' : 'instances'
      changeView(next)
      event.currentTarget.querySelector<HTMLButtonElement>(`#browser-monitor-tab-${next}`)?.focus()
    }}>
      <button type="button" role="tab" id="browser-monitor-tab-instances" tabIndex={view === 'instances' ? 0 : -1} aria-selected={view === 'instances'} aria-controls="browser-monitor-view" onClick={() => changeView('instances')} className={`rounded-lg px-2 py-2 text-[11px] font-semibold transition ${view === 'instances' ? 'bg-cyan-300/[.13]! text-cyan-200' : 'bg-transparent! text-slate-400 hover:text-slate-200'}`}>Instâncias</button>
      <button type="button" role="tab" id="browser-monitor-tab-links" tabIndex={view === 'links' ? 0 : -1} aria-selected={view === 'links'} aria-controls="browser-monitor-view" onClick={() => changeView('links')} className={`rounded-lg px-2 py-2 text-[11px] font-semibold transition ${view === 'links' ? 'bg-cyan-300/[.13]! text-cyan-200' : 'bg-transparent! text-slate-400 hover:text-slate-200'}`}>Links GPT</button>
    </div>
    <div id="browser-monitor-view" role="tabpanel" aria-labelledby={view === 'instances' ? 'browser-monitor-tab-instances' : 'browser-monitor-tab-links'}>
      {view === 'instances' ? <><AgentGroup title="Supervisors" agents={agents.filter((agent) => agent.role === 'supervisor')} selectedId={selectedId} onSelect={onSelect} />
        <AgentGroup title="Workers" agents={agents.filter((agent) => agent.role === 'worker')} selectedId={selectedId} onSelect={onSelect} />
        {!agents.length ? <p className="rounded-xl border border-dashed border-white/10 p-4 text-[13px] text-slate-400">A aguardar instâncias do Runtime ChatGPT.</p> : null}</> : <BrowserMonitorLinks agents={agents} selectedKey={selectedLinkKey} onSelect={onSelectLink} />}
    </div>
    <p className="mt-8 border-t border-white/[.07] px-2 pt-4 text-[11px] leading-5 text-slate-500">{agents.filter((agent) => agent.occupied).length} em trabalho · {agents.length} no total</p>
    </> : <div className="flex flex-col items-center gap-5"><BrowserMonitorPanelToggle panel="lista de instâncias" expanded={false} onToggle={onToggle} /><span className="rotate-180 [writing-mode:vertical-rl] text-[10px] font-semibold uppercase tracking-[.16em] text-slate-500" aria-hidden="true">Instâncias</span></div>}
  </aside>
}
