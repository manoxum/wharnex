import { useEffect, useState } from 'react'
import { desktopBridge } from '../../lib/desktop'
import type { HarnessEvent, OrchestratorTask, OrchestratorTaskRun, Session } from '../../types'
import { ChatArtifactLibrary } from '../BundleExplorer'
import { ExecutionHistorySurface } from '../ExecutionHistorySurface'
import { Icon } from '../Icon'
import { PlanView } from '../Inspector'
import { MarkdownContent } from '../MarkdownContent'
import { PlanHistorySurface } from '../PlanHistorySurface'
import { WorkerFollowViewer } from '../WorkerFollowViewer'

export type TaskDetailTab = 'overview' | 'bundle' | 'plan' | 'execution' | 'engine'

export const TASK_DETAIL_TABS: Array<{ id: TaskDetailTab; label: string; icon: 'info' | 'package' | 'plan' | 'terminal' | 'monitor' }> = [
  { id: 'overview', label: 'Overview', icon: 'info' },
  { id: 'bundle', label: 'Bundles', icon: 'package' },
  { id: 'plan', label: 'Plano', icon: 'plan' },
  { id: 'execution', label: 'Execution', icon: 'terminal' },
  { id: 'engine', label: 'Engine', icon: 'monitor' },
]

export function TaskDetailTabBar({ tab, onTab }: { tab: TaskDetailTab; onTab: (tab: TaskDetailTab) => void }) {
  return <nav className="orchestrator-task-tabs" role="tablist" aria-label="Detalhe da task">
    {TASK_DETAIL_TABS.map((item) => <button key={item.id} type="button" role="tab" aria-selected={tab === item.id} className={`text-sm ${tab === item.id ? 'active' : ''}`} onClick={() => onTab(item.id)}>
      <Icon name={item.icon} size={14}/><span>{item.label}</span>
    </button>)}
  </nav>
}

// Each run of a task is one agentic Main Request with its own Agent Session.
export function TaskRunSelector({ runs, run, onSelect }: { runs: OrchestratorTaskRun[]; run?: OrchestratorTaskRun; onSelect: (id: string) => void }) {
  if (!runs.length) return <p className="orchestrator-task-empty text-sm">Esta task ainda não tem execuções.</p>
  return <label className="orchestrator-run-selector text-sm">
    <span>Execução</span>
    <select className="text-sm" value={run?.id || ''} onChange={(event) => onSelect(event.target.value)}>
      {runs.map((item) => <option key={item.id} value={item.id}>#{item.attempt} · {item.status} · {formatDate(item.started_at)}</option>)}
    </select>
    {run?.error ? <small title={run.error}>{run.error}</small> : null}
  </label>
}

// What the model said about this task: the cumulative Main Request summary
// and its latest turn, rendered as in the agentic chat.
export function TaskThinking({ agent, loading }: { agent?: Session; loading: boolean }) {
  if (loading && !agent) return <p className="orchestrator-task-empty text-sm" role="status">A carregar o pensamento da IA…</p>
  const summary = agent?.last_main_request_summary?.trim()
  const message = agent?.last_turn?.message?.trim()
  if (!summary && !message) return <p className="orchestrator-task-empty text-sm">O GPT ainda não respondeu nesta execução.</p>
  return <div className="orchestrator-task-thinking">
    {summary ? <article><header className="text-sm"><Icon name="sparkles" size={13}/> Resumo cumulativo</header><MarkdownContent markdown={summary} compact/></article> : null}
    {message && message !== summary ? <article><header className="text-sm"><Icon name="chatgpt" size={13}/> Última resposta{agent?.last_turn?.kind ? ` · ${agent.last_turn.kind}` : ''}</header><MarkdownContent markdown={message} compact/></article> : null}
  </div>
}

export function TaskBundleTab({ agent, loading }: { agent?: Session; loading: boolean }) {
  if (!agent) return <p className="orchestrator-task-empty text-sm" role={loading ? 'status' : undefined}>{loading ? 'A carregar bundles…' : 'Sem bundles nesta execução.'}</p>
  return <ChatArtifactLibrary sessionId={agent.id} artifacts={agent.artifacts} requestLineages={agent.request_lineages}/>
}

export function TaskPlanTab({ agent, events, loading, error }: { agent?: Session; events: HarnessEvent[]; loading: boolean; error: string }) {
  if (!agent) return <p className="orchestrator-task-empty text-sm" role={loading ? 'status' : undefined}>{loading ? 'A carregar o plano…' : 'Sem plano nesta execução.'}</p>
  return <PlanHistorySurface session={agent} events={events} loading={loading} error={error}
    renderHistoricalPlan={(historySession) => <PlanView session={historySession} readOnly/>}
    currentPlan={<PlanView session={agent} readOnly/>}/>
}

export function TaskExecutionTab({ agent, events, loading, error }: { agent?: Session; events: HarnessEvent[]; loading: boolean; error: string }) {
  if (!agent) return <p className="orchestrator-task-empty text-sm" role={loading ? 'status' : undefined}>{loading ? 'A carregar a execução…' : 'Sem execução registada.'}</p>
  return <ExecutionHistorySurface session={agent} events={events} loading={loading} error={error}/>
}

// The Worker pinned to this task plays its Supervisor (adr/ADR-0081); its
// browser opens in the same full-size follow window the agentic Engine uses
// for a hidden Worker.
export function TaskEngineTab({ task }: { task: OrchestratorTask }) {
  const bridge = desktopBridge()?.agents
  const [agentId, setAgentId] = useState<string>()
  const [label, setLabel] = useState('')
  const [following, setFollowing] = useState(false)

  useEffect(() => {
    if (!bridge) return
    let alive = true
    const pick = (state: DesktopAgentRuntimeState) => {
      const holder = state.agents.find((agent) => agent.role === 'worker' && (agent.pinned_task_id === task.id || agent.task?.chat_id === task.id))
      if (!alive) return
      setAgentId(holder?.id)
      setLabel(holder ? holder.label : '')
    }
    void bridge.state().then(pick).catch(() => undefined)
    const off = bridge.onState(pick)
    return () => { alive = false; off() }
  }, [bridge, task.id])

  useEffect(() => { if (!agentId) setFollowing(false) }, [agentId])

  if (!bridge) return <p className="orchestrator-task-empty text-sm">A instância do navegador só está disponível no Wharnex Desktop.</p>
  return <div className="orchestrator-task-engine">
    <section>
      <div>
        <strong>{agentId ? `${label} está nesta task` : 'Nenhum Worker nesta task agora'}</strong>
        <small>{agentId ? 'Fica preso à task até ela terminar e mantém a sua conversa do ChatGPT.' : task.status === 'DOING' ? 'A aguardar que um Worker retome a próxima ronda.' : 'Só uma task em execução tem um Worker associado.'}</small>
        {task.conversation_url ? <code className="text-sm" title="Conversa permanente da task">{task.conversation_url}</code> : null}
      </div>
      {agentId ? <button type="button" className="primary" aria-pressed={following} onClick={() => setFollowing((value) => !value)}><Icon name="monitor" size={14}/> {following ? 'Parar de acompanhar' : 'Acompanhar instância'}</button> : null}
    </section>
    {agentId && following ? <WorkerFollowViewer agentId={agentId} onStop={() => setFollowing(false)}/> : null}
  </div>
}

function formatDate(value: string) {
  try { return new Intl.DateTimeFormat('pt', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(value)) } catch { return value }
}
