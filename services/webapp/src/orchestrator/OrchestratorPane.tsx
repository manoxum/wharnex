import { useCallback, useEffect, useState } from 'react'
import { api } from '../transport/api'
import type { AppConfig, OrchestratorOverview, Session, WorkspaceChat } from '../transport/contracts'

export function OrchestratorPane({ session, project, config, onChatCreated, onError }: {
  session: Session; project: string; config?: AppConfig; onChatCreated: (chat: WorkspaceChat) => void; onError: (message: string) => void
}) {
  const [overview, setOverview] = useState<OrchestratorOverview>()
  const [objective, setObjective] = useState('')
  const [busy, setBusy] = useState('')
  const load = useCallback(async () => setOverview(await api.orchestrator(session.id)), [session.id])
  useEffect(() => { void load().catch((error) => onError(String(error))) }, [load, onError])

  async function propose() {
    if (!objective.trim()) return
    if (config?.planner && config.planner !== 'manual') { onError('O modo Orquestrador remoto exige o planner manual para usar os Supervisors/Workers do Desktop.'); return }
    setBusy('plan')
    try { await api.proposeOrchestrator(session.id, objective.trim()); setObjective(''); await load() }
    catch (error) { onError(error instanceof Error ? error.message : String(error)) } finally { setBusy('') }
  }

  async function approve(planID: string) {
    setBusy(planID)
    try { setOverview(await api.approveOrchestrator(session.id, planID)) }
    catch (error) { onError(error instanceof Error ? error.message : String(error)) } finally { setBusy('') }
  }

  async function startTask(taskID: string) {
    if (config?.planner && config.planner !== 'manual') { onError('A execução remota requer o planner manual para ser entregue aos Supervisors/Workers do Desktop.'); return }
    setBusy(taskID)
    try {
      const result = await api.startOrchestratorTask(session.id, taskID)
      const runSessionID = result.run.session_id || ''
      const requestID = result.run.request_id || ''
      if (result.manual_prompt && runSessionID && requestID) {
        const chatID = crypto.randomUUID()
        await api.setChatID(runSessionID, chatID)
        const now = new Date().toISOString()
        const chat: WorkspaceChat = { id: chatID, project_path: project, session_id: runSessionID, title: `Orquestrador · ${result.task.title}`, created_at: now, updated_at: now }
        await api.saveWorkspaceChat(chat)
        const tunnelIDs = (config?.remote_input?.instances || []).filter((item) => item.available && (item.state || 'active') === 'active').map((item) => item.id)
        await api.remoteDispatch(runSessionID, { request_id: requestID, workspace_chat_id: chatID, bootstrap_text: result.task.description || result.task.title, chat_title: chat.title, attachments: [], project_files: [], tunnel_instance_ids: tunnelIDs, include_context: true })
        onChatCreated(chat)
      }
      await load()
    } catch (error) { onError(error instanceof Error ? error.message : String(error)) } finally { setBusy('') }
  }

  const plans = overview?.plans || []
  const tasks = overview?.tasks || []
  return <section className="min-h-0 flex-1 overflow-y-auto bg-elevated/45 p-4 sm:p-6">
    <div className="mx-auto max-w-5xl">
      <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-end"><div><p className="text-xs font-bold uppercase tracking-[0.18em] text-accent">Modo Orquestrador</p><h2 className="mt-1 text-2xl font-semibold tracking-tight">Objetivos, planos e tarefas</h2><p className="mt-2 text-sm text-faint">O plano coordena Agent Sessions; a execução de IA continua no Desktop.</p></div><div className="rounded-xl border border-line bg-surface px-3 py-2 text-xs text-soft">Slots {overview?.mutation_slots_used || 0}/{overview?.mutation_slots || 1}</div></div>
      <div className="mt-6 rounded-2xl border border-line bg-surface p-4"><textarea value={objective} onChange={(event) => setObjective(event.target.value)} rows={3} placeholder="Defina um objetivo para o Orquestrador…" className="w-full resize-none bg-transparent text-sm leading-6 outline-none placeholder:text-faint"/><div className="mt-3 flex justify-end"><button disabled={!objective.trim() || Boolean(busy)} onClick={() => void propose()} className="rounded-xl bg-accent px-4 py-2 text-xs font-bold text-accent-ink disabled:opacity-40">{busy === 'plan' ? 'A planear…' : 'Propor plano'}</button></div></div>
      <div className="mt-6 grid gap-4 lg:grid-cols-[.8fr_1.2fr]">
        <div><h3 className="mb-3 text-xs font-bold uppercase tracking-[0.14em] text-faint">Planos</h3><div className="space-y-2">{plans.map((plan) => <article key={plan.id} className="rounded-xl border border-line bg-surface p-4"><div className="flex justify-between gap-3"><div><p className="font-semibold">{plan.title}</p><p className="mt-1 text-xs leading-5 text-faint">{plan.objective}</p></div><span className="text-[10px] font-bold uppercase text-faint">{plan.status}</span></div>{plan.status === 'DRAFT' && <button disabled={Boolean(busy)} onClick={() => void approve(plan.id)} className="mt-3 rounded-lg border border-accent/40 px-3 py-1.5 text-xs font-semibold text-accent">Aprovar plano</button>}</article>)}{!plans.length && <Empty text="Sem planos neste projeto."/>}</div></div>
        <div><h3 className="mb-3 text-xs font-bold uppercase tracking-[0.14em] text-faint">Tarefas</h3><div className="space-y-2">{tasks.map((task) => <article key={task.id} className="rounded-xl border border-line bg-surface p-4"><div className="flex items-start justify-between gap-3"><div><p className="font-semibold">{task.title}</p><p className="mt-1 text-xs leading-5 text-faint">{task.description || 'Sem descrição adicional.'}</p></div><span className="rounded-full bg-muted px-2 py-1 text-[10px] font-bold uppercase text-soft">{task.status}</span></div>{task.status === 'READY' && <button disabled={Boolean(busy)} onClick={() => void startTask(task.id)} className="mt-3 rounded-lg bg-accent px-3 py-1.5 text-xs font-bold text-accent-ink">{busy === task.id ? 'A iniciar…' : 'Iniciar Agent'}</button>}</article>)}{!tasks.length && <Empty text="O plano aprovado criará tarefas aqui."/>}</div></div>
      </div>
    </div>
  </section>
}

function Empty({ text }: { text: string }) { return <p className="rounded-xl border border-dashed border-line px-4 py-8 text-center text-xs text-faint">{text}</p> }
