import { activeTask, labelPath, operationalState, stateDot } from './browserMonitorModel'
import { BrowserMonitorPanelToggle } from './BrowserMonitorPanelToggle'
import { BrowserMonitorBundles } from './BrowserMonitorBundles'
import type { BrowserMonitorChat } from '../../../lib/transport/http/browser-monitor/catalog'

function short(value: string | number | undefined | null, fallback = '—') { return value == null || value === '' ? fallback : String(value) }
function time(value?: string) { if (!value) return '—'; const date = new Date(value); return Number.isNaN(date.getTime()) ? value : date.toLocaleString('pt-PT', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }) }
function memory(agent: DesktopAgentRuntimeAgent) { return agent.memory?.available ? `${Math.round(agent.memory.rss_bytes / 1024 / 1024)} MiB${agent.memory.shared_process ? ' · partilhado' : ''}` : '—' }
function DetailRows({ rows }: { rows: [string, string][] }) {
  return <dl>{rows.map(([name, value]) => <div key={name} className="grid min-h-8 grid-cols-[80px_minmax(0,1fr)] items-center gap-2 border-b border-white/[.09] px-1 py-1.5 text-[11px] leading-4"><dt className="text-slate-400">{name}</dt><dd className="min-w-0 truncate font-mono text-[11px] text-slate-200" title={value}>{value}</dd></div>)}</dl>
}

export function BrowserMonitorDetails({ agent, link, expanded, onToggle, onExplorerOpenChange }: { agent?: DesktopAgentRuntimeAgent; link?: BrowserMonitorChat; expanded: boolean; onToggle: () => void; onExplorerOpenChange: (open: boolean) => void }) {
  if (!expanded) return <aside className="min-h-0 overflow-hidden border-r border-white/[.08] bg-[#1b1d22] px-1.5 py-4" aria-label="Detalhes da instância"><div className="flex flex-col items-center gap-5"><BrowserMonitorPanelToggle panel="painel de detalhes" expanded={false} onToggle={onToggle} /><span className="rotate-180 [writing-mode:vertical-rl] text-[10px] font-semibold uppercase tracking-[.16em] text-slate-500" aria-hidden="true">Detalhes</span></div></aside>
  if (!agent) return <aside className="min-h-0 border-r border-white/[.08] bg-[#1b1d22] p-4 text-[12px] text-slate-400" aria-label="Detalhes da instância"><div className="mb-6 flex justify-end"><BrowserMonitorPanelToggle panel="painel de detalhes" expanded onToggle={onToggle} /></div>Selecione uma instância.</aside>
  const task = activeTask(agent)
  const ephemeral = Boolean(link && agent.id.startsWith('link:'))
  const state = ephemeral ? { key: 'idle' as const, label: 'Visualização manual' } : operationalState(agent)
  const rows: [string, string][] = [
    ['Loop', ephemeral ? 'Não se aplica' : agent.loop_active === false ? 'Parado' : 'Ativo'],
    ['Chat', short(agent.browser.title || agent.chat_id, agent.chat_id ? agent.chat_id : 'Novo chat')],
    ...(link ? [['Link GPT', link.url] as [string, string]] : []),
    ['Projeto', agent.project_id ? labelPath(agent.project_id) : task?.project_id ? labelPath(task.project_id) : '—'],
    ['Vínculo', ephemeral ? 'Vista efêmera · sem tarefa' : agent.binding_hold ? `Retido · ${agent.binding_hold}` : agent.chat_id ? 'Livre para outro chat' : 'Sem chat'],
    ['Tarefa', task ? `${task.type.replaceAll('_', ' ')} · ${task.task_id}` : 'Sem tarefa registada'],
    ['Task state', short(task?.status)],
    ['Pedido', short(task?.request_id)],
    ['Lineage', short(task?.root_request_id)],
    ['Conversa', short(task?.conversation_id)],
    ['Tentativa', task ? `${short(task.attempt)}/${short(task.max_attempts)}` : '—'],
    ['Último claim', time(agent.last_claim_at)],
    ['Lease', time(task?.lease_expires_at)],
    ['not_before', time(task?.not_before)],
    ['Estado', `${state.label}${agent.error || task?.last_error ? ` · ${agent.error || task?.last_error}` : ''}`],
    ['RAM (RSS)', memory(agent)],
    ['Navegador', link && !agent.browser.web_contents_id ? 'Visualização efêmera' : agent.browser.available ? `WebContents #${agent.browser.web_contents_id} · PID ${short(agent.browser.os_process_id)}` : 'Ainda não criado'],
    ['Página', short(agent.browser.title || agent.browser.url, agent.browser.available ? 'Sem página carregada' : '—')],
  ]
  return <aside className="min-h-0 overflow-y-auto border-r border-white/[.08] bg-[#1b1d22] px-4 py-4" aria-label="Detalhes da instância">
    <div className="mb-2 flex min-w-0 items-center justify-between gap-2 border-b border-white/[.13] px-1 pb-3">
      <div className="flex min-w-0 items-center gap-2"><span className={`h-2.5 w-2.5 shrink-0 rounded-full ${stateDot(state.key)}`} aria-hidden="true" /><h2 className="truncate text-[15px] font-semibold text-slate-100">{agent.label}</h2></div>
      <div className="flex min-w-0 items-center gap-2"><span className="max-w-28 truncate rounded-full border border-white/[.12] px-2 py-1 text-[10px] text-slate-400" title={state.label}>{state.label}</span><BrowserMonitorPanelToggle panel="painel de detalhes" expanded onToggle={onToggle} /></div>
    </div>
    <DetailRows rows={rows} />
    <BrowserMonitorBundles key={link?.key || agent.id} agent={agent} link={link} onExplorerOpenChange={onExplorerOpenChange} />
  </aside>
}
