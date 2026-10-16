import { WorkbenchTabs } from '../../presentation/tabs'
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
    <div className="mb-3 flex items-center justify-between px-2"><h2 className="text-whx-caption font-semibold uppercase tracking-[0.16em] text-whx-faint">{title}</h2><span className="rounded-md bg-whx-muted px-2 py-0.5 text-whx-caption text-whx-faint">{agents.length}</span></div>
    <div className="space-y-1.5">{agents.map((agent) => {
      const selected = selectedId === agent.id
      const task = activeTask(agent)
      return <button key={agent.id} type="button" aria-pressed={selected} onClick={() => onSelect(agent.id)}
        className={`group flex w-full items-center gap-3 rounded-xl border px-3 py-3 text-left text-whx-text transition duration-150 ${selected ? 'border-whx-accent bg-whx-hover! shadow-[inset_2px_0_0_var(--theme-accent)]' : 'border-transparent bg-transparent! hover:border-whx-border-soft hover:bg-whx-muted!'}`}>
        <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${stateDot(operationalState(agent).key)}`} aria-hidden="true" />
        <span className="min-w-0 flex-1"><strong className="block truncate text-whx-label font-semibold leading-5 text-whx-text">{agent.label}</strong><small className="block truncate text-whx-caption leading-relaxed text-whx-faint">{activityLabel(agent)}</small></span>
        {task ? <span className="max-w-[72px] truncate rounded-md bg-whx-muted px-2 py-1 text-whx-caption font-medium text-whx-soft" title={task.type}>{task.type.replace('ORCHESTRATOR_', '')}</span> : null}
        <svg className={`h-3.5 w-3.5 shrink-0 ${selected ? 'text-whx-accent' : 'text-whx-faint group-hover:text-whx-faint'}`} viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="m6 3 5 5-5 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
      </button>
    })}</div>
  </div>
}

export function BrowserMonitorList({ agents, selectedId, onSelect, selectedLinkKey, onSelectLink, onInstancesView, expanded, onToggle }: { agents: DesktopAgentRuntimeAgent[]; selectedId: string; onSelect: (id: string) => void; selectedLinkKey: string; onSelectLink: (chat: BrowserMonitorChat) => void; onInstancesView: () => void; expanded: boolean; onToggle: () => void }) {
  const [view, setView] = useState<'instances' | 'links'>('instances')
  const changeView = (next: 'instances' | 'links') => { setView(next); if (next === 'instances') onInstancesView() }
  return <aside className={`min-h-0 min-w-0 overflow-y-auto border-r border-whx-border-soft bg-whx-surface ${expanded ? 'px-4 py-6' : 'px-1.5 py-4'}`} aria-label="Instâncias">
    {expanded ? <>
    <div className="mb-4 px-2"><div className="flex items-center justify-between gap-2"><p className="text-whx-caption font-medium uppercase tracking-[0.16em] text-whx-faint">Navegadores</p><BrowserMonitorPanelToggle panel="lista de instâncias" expanded onToggle={onToggle} /></div><p className="mt-1 text-whx-label text-whx-soft">Selecione uma instância para acompanhar.</p></div>
    <WorkbenchTabs className="mb-6" label="Visões dos navegadores" value={view} onChange={changeView} items={[
      { id: 'instances', label: 'Instâncias', icon: 'monitor', badge: agents.length, domId: 'browser-monitor-tab-instances', controls: 'browser-monitor-view' },
      { id: 'links', label: 'Links GPT', icon: 'link', domId: 'browser-monitor-tab-links', controls: 'browser-monitor-view' },
    ]}/>
    <div id="browser-monitor-view" role="tabpanel" aria-labelledby={view === 'instances' ? 'browser-monitor-tab-instances' : 'browser-monitor-tab-links'}>
      {view === 'instances' ? <><AgentGroup title="Supervisors" agents={agents.filter((agent) => agent.role === 'supervisor')} selectedId={selectedId} onSelect={onSelect} />
        <AgentGroup title="Workers" agents={agents.filter((agent) => agent.role === 'worker')} selectedId={selectedId} onSelect={onSelect} />
        {!agents.length ? <p className="rounded-xl border border-dashed border-whx-border-soft p-4 text-whx-label text-whx-faint">A aguardar instâncias do Runtime ChatGPT.</p> : null}</> : <BrowserMonitorLinks agents={agents} selectedKey={selectedLinkKey} onSelect={onSelectLink} />}
    </div>
    <p className="mt-8 border-t border-whx-border-soft px-2 pt-4 text-whx-caption leading-5 text-whx-faint">{agents.filter((agent) => agent.occupied).length} em trabalho · {agents.length} no total</p>
    </> : <div className="flex flex-col items-center gap-5"><BrowserMonitorPanelToggle panel="lista de instâncias" expanded={false} onToggle={onToggle} /><span className="rotate-180 [writing-mode:vertical-rl] text-whx-caption font-semibold uppercase tracking-[.16em] text-whx-faint" aria-hidden="true">Instâncias</span></div>}
  </aside>
}
