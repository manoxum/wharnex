import { useMemo, useState } from 'react'
import { api } from '../../lib/api'
import type { OrchestratorOverview as OverviewData, OrchestratorProposal, OrchestratorProposalResult, OrchestratorTask, Session } from '../../types'
import { Icon } from '../Icon'

export function OrchestratorOverview({ session, overview, proposal, busy, onProposal, onRun, onOpenTasks, onSelectTask }: {
  session: Session
  overview: OverviewData
  proposal?: OrchestratorProposalResult
  busy: boolean
  onProposal: (value?: OrchestratorProposalResult) => void
  onRun: <T>(action: () => Promise<T>, after?: (value: T) => void) => Promise<T | undefined>
  onOpenTasks: () => void
  onSelectTask: (task: OrchestratorTask) => void
}) {
  const [objective, setObjective] = useState('')
  const [manualJSON, setManualJSON] = useState('')
  const active = overview.tasks.filter((task) => task.status === 'DOING')
  const ready = overview.tasks.filter((task) => task.status === 'READY')
  const review = overview.tasks.filter((task) => task.status === 'REVIEW')
  const completed = overview.tasks.filter((task) => task.status === 'COMPLETE')
  const draftPlan = proposal?.plan || overview.plans.find((plan) => plan.status === 'DRAFT')
  const draftTasks = draftPlan ? overview.tasks.filter((task) => task.plan_id === draftPlan.id) : []
  const planningRequests = useMemo(() => [...overview.planning_requests].sort((a, b) => b.updated_at.localeCompare(a.updated_at)), [overview.planning_requests])
  const activePlanningCount = planningRequests.filter((item) => ['PENDING', 'LEASED', 'RUNNING', 'WAITING'].includes(item.status)).length
  const recent = useMemo(() => [...overview.tasks].filter((task) => task.status !== 'ARCHIVED').sort((a, b) => b.updated_at.localeCompare(a.updated_at)).slice(0, 5), [overview.tasks])

  async function propose() {
    const value = objective.trim()
    if (!value || busy) return
    const result = await onRun(() => api.proposeOrchestratorPlan(session.id, value))
    if (result) { onProposal(result); setObjective('') }
  }

  async function importManual() {
    const raw = manualJSON.trim()
    if (!raw || !proposal?.request_id) return
    let parsed: OrchestratorProposal
    try { parsed = JSON.parse(raw) as OrchestratorProposal }
    catch { return }
    const result = await onRun(() => api.importOrchestratorPlan(session.id, proposal.request_id, parsed))
    if (result) { onProposal(result); setManualJSON('') }
  }

  return <div className="orchestrator-overview">
    <section className="orchestrator-goal-stage">
      <div className="orchestrator-goal-copy">
        <span>Planeie o resultado, não os cliques</span>
        <h1>O que pretende realizar neste projeto?</h1>
        <p>Descreva o objetivo. O Planner transforma-o em tarefas, dependências e critérios de conclusão antes de qualquer execução.</p>
      </div>
      <div className="orchestrator-composer">
        <textarea value={objective} onChange={(event) => setObjective(event.target.value)} placeholder="Ex.: migrar o módulo de autenticação para Go, preservar compatibilidade e validar o cutover…" rows={4} onKeyDown={(event) => {
          if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') void propose()
        }}/>
        <footer>
          <span><Icon name="shield" size={13}/> Primeiro propõe · depois aprova · só então executa</span>
          <button type="button" disabled={busy || !objective.trim()} onClick={() => void propose()}><Icon name="plan" size={15}/> Gerar plano</button>
        </footer>
      </div>
    </section>

    {planningRequests.length ? <section className="orchestrator-planning-queue" aria-live="polite">
      <header>
        <div><span>Fila durável</span><h2>Em planejamento</h2></div>
        <strong>{activePlanningCount} ativo{activePlanningCount === 1 ? '' : 's'} · {planningRequests.length} pedido{planningRequests.length === 1 ? '' : 's'}</strong>
      </header>
      <div className="orchestrator-planning-list">
        {planningRequests.map((planning) => <article key={planning.task_id} className={`orchestrator-planning-status status-${planning.status.toLowerCase()}`}>
          <span className="orchestrator-planning-pulse" aria-hidden="true"/>
          <div>
            <strong>{planning.objective || `Pedido ${planning.request_id}`}</strong>
            <span>Request <code translate="no">{planning.request_id}</code> · prioridade máxima · tentativa {planning.attempt}/{planning.max_attempts}</span>
            {planning.last_error ? <small>{planning.last_error}</small> : <small>{['DONE', 'CANCELLED'].includes(planning.status) ? 'Planejamento encerrado.' : 'Pode sair do Orchestrator: um Worker continuará esta entrega.'}</small>}
          </div>
          <div className="orchestrator-planning-actions">
            <span className="orchestrator-planning-badge">{planning.status}</span>
            {['FAILED', 'ATTENTION'].includes(planning.status) ? <button type="button" disabled={busy} onClick={() => void onRun(() => api.retryOrchestratorPlanning(session.id, planning.request_id))}>Retentar</button> : null}
          </div>
        </article>)}
      </div>
    </section> : null}

    {proposal?.manual_prompt && !proposal.worker_task_id && <section className="orchestrator-manual-plan">
      <header><div><strong>Planner manual</strong><span>Envie este prompt ao ChatGPT e cole abaixo apenas o JSON devolvido.</span></div><button type="button" onClick={() => void navigator.clipboard.writeText(proposal.manual_prompt || '')}><Icon name="copy" size={14}/> Copiar prompt</button></header>
      <details><summary>Ver prompt</summary><pre>{proposal.manual_prompt}</pre></details>
      <textarea value={manualJSON} onChange={(event) => setManualJSON(event.target.value)} placeholder='{"protocol":"harness.orchestrator-plan/v1", ...}' rows={7}/>
      <button className="primary" type="button" disabled={busy || !manualJSON.trim()} onClick={() => void importManual()}>Importar plano estruturado</button>
    </section>}

    {draftPlan && <section className="orchestrator-proposal-card">
      <header>
        <div><span>Plano proposto · {draftTasks.length} tarefas</span><h2>{draftPlan.title}</h2><p>{draftPlan.objective}</p></div>
        <button type="button" disabled={busy} onClick={() => void onRun(() => api.approveOrchestratorPlan(session.id, draftPlan.id), () => onProposal(undefined))}><Icon name="check" size={15}/> Aprovar e enviar ao fluxo</button>
      </header>
      <div className="orchestrator-proposal-flow">
        {draftTasks.map((task, index) => <button key={task.id} type="button" onClick={() => onSelectTask(task)}>
          <span className="step">{String(index + 1).padStart(2, '0')}</span>
          <span><strong>{task.title}</strong><small>{task.depends_on?.length ? `${task.depends_on.length} dependência(s)` : 'Sem dependências'} · {task.priority}</small></span>
          <Icon name="chevron-right" size={14}/>
        </button>)}
      </div>
    </section>}

    <section className="orchestrator-cockpit">
      <header><div><span>Visão operacional</span><strong>Fluxo do projeto</strong></div><button type="button" onClick={onOpenTasks}>Abrir todas as Tasks <Icon name="arrow-right" size={14}/></button></header>
      <div className="orchestrator-metrics">
        <Metric label="Em execução" value={active.length} note={`${overview.mutation_slots_used}/${overview.mutation_slots} slot de mutação`} />
        <Metric label="Prontas" value={ready.length} note="elegíveis para o próximo slot" />
        <Metric label="Em revisão" value={review.length} note="execução concluída" />
        <Metric label="Concluídas" value={completed.length} note="dependências liberadas" />
      </div>
      <div className="orchestrator-active-strip">
        <div className="orchestrator-slot"><span className={overview.mutation_slots_used ? 'busy' : 'free'}/><strong>Mutation slot</strong><small>{overview.mutation_slots_used ? active[0]?.title || 'Ocupado' : 'Livre para a próxima tarefa READY'}</small></div>
        <div className="orchestrator-recent">
          {recent.length ? recent.map((task) => <button key={task.id} onClick={() => onSelectTask(task)}><Status status={task.status}/><span><strong>{task.title}</strong><small>{task.condition !== 'none' ? task.condition.replaceAll('_', ' ') : task.plan_id ? 'Plano orquestrado' : 'Tarefa manual'}</small></span><Icon name="chevron-right" size={14}/></button>) : <div className="orchestrator-empty">Ainda não existem tarefas. Gere um plano ou crie uma Task manual.</div>}
        </div>
      </div>
    </section>
  </div>
}

function Metric({ label, value, note }: { label: string; value: number; note: string }) {
  return <div><span>{label}</span><strong>{value}</strong><small>{note}</small></div>
}

export function Status({ status }: { status: string }) {
  return <span className={`orchestrator-status status-${status.toLowerCase()}`}>{status}</span>
}
