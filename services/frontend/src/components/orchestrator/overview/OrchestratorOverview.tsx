import { type ComponentProps, useMemo, useState } from 'react'
import { api } from '../../../lib/transport/http/api'
import type { ChatAgentTask, ChatArtifactSelection, OrchestratorOverview as OverviewData, OrchestratorProposal, OrchestratorProposalResult, OrchestratorTask, Session } from '../../../types'
import { Icon } from '../../presentation/chrome/Icon'
import type { ChatAgentTaskChatRef } from '../../../lib/chat/transport/chatAgentTaskNav'
import { OrchestratorPlanningQueue } from '../planning/OrchestratorPlanningQueue'
import { ChatPanel } from '../../chat/panel/ChatPanel'
import { encodeChatAttachments } from '../../../lib/chat/attachments/chatAttachments'
import { desktopBridge } from '../../../lib/desktop/bridge/desktop'
import { errorMessage } from '../../../lib/workspace/dialogs/errorMessage'
import { promptDialog } from '../../../lib/desktop/bridge/appDialog'
import { OrchestratorTaskAttention } from '../tasks/OrchestratorTaskAttention'
import { OrchestratorActivity } from './OrchestratorActivity'

export function OrchestratorOverview({ session, overview, planningTasks = [], chats = [], chatProps, onGoToChat, onError, proposal, busy, onProposal, onRun, onOpenTasks, onOpenPlanTasks, onSelectTask, onSelectPlanningRequest }: {
  session: Session
  overview: OverviewData
  chatProps: ComponentProps<typeof ChatPanel>
  // The durable ORCHESTRATOR_PLAN task backing each planning request, carrying
  // the lease owner/chat/session identifiers the planning request itself does
  // not — see OrchestratorWorkspace's combined refresh.
  planningTasks?: ChatAgentTask[]
  chats?: ChatAgentTaskChatRef[]
  onGoToChat?: (chatId?: string, sessionId?: string) => void
  onError?: (message?: string) => void
  proposal?: OrchestratorProposalResult
  busy: boolean
  onProposal: (value?: OrchestratorProposalResult) => void
  onRun: <T>(action: () => Promise<T>, after?: (value: T) => void) => Promise<T | undefined>
  onOpenTasks: () => void
  onOpenPlanTasks?: (planID: string) => void
  onSelectTask: (task: OrchestratorTask) => void
  onSelectPlanningRequest?: (request: OverviewData['planning_requests'][number]) => void
}) {
  const [manualJSON, setManualJSON] = useState('')
  const draftPlan = proposal?.plan || overview.plans.find((plan) => plan.status === 'DRAFT')
  const draftTasks = draftPlan ? overview.tasks.filter((task) => task.plan_id === draftPlan.id) : []
  const planningRequests = useMemo(() => [...overview.planning_requests].sort((a, b) => b.updated_at.localeCompare(a.updated_at)), [overview.planning_requests])

  async function propose(message: string, attachments: File[], projectFiles: string[], artifacts: ChatArtifactSelection) {
    const value = message.trim()
    if (!value || busy) return

    const bridge = desktopBridge()
    if (attachments.length && !bridge) {
      onError?.('Anexos do Orchestrator requerem o Wharnex Desktop.')
      return
    }

    const evidenceFiles: File[] = []
    if (bridge && artifacts.result && chatProps.artifactContent?.result) {
      evidenceFiles.push(new File([chatProps.artifactContent.result], 'wharnex-execution-result.md', { type: 'text/markdown' }))
    }
    if (bridge && artifacts.error && chatProps.artifactContent?.error) {
      evidenceFiles.push(new File([chatProps.artifactContent.error], 'wharnex-execution-error.md', { type: 'text/markdown' }))
    }
    const files = [...attachments, ...evidenceFiles]
    const attachmentCacheKey = files.length ? `orch_${crypto.randomUUID().replaceAll('-', '_')}` : ''
    let persisted: Array<{ name: string; size: number; mime: string; storage_ref: string }> = []

    try {
      if (files.length) {
        if (!bridge) throw new Error('Desktop bridge indisponível')
        const encoded = await encodeChatAttachments(files)
        const stored = await bridge.attachments.persist({ cacheKey: attachmentCacheKey, messageId: crypto.randomUUID(), attachments: encoded })
        persisted = stored.attachments.map((file) => ({ name: file.name, size: file.size, mime: file.mime, storage_ref: file.storageRef }))
      }

      const result = await onRun(() => api.proposeOrchestratorPlan(session.id, value, {
        include_context: Boolean(artifacts.context),
        project_files: projectFiles,
        attachment_cache_key: attachmentCacheKey || undefined,
        attachments: persisted.length ? persisted : undefined,
      }))
      if (result) onProposal(result)
      if (result && !result.worker_task_id && attachmentCacheKey && bridge) {
        await bridge.attachments.removeChat({ cacheKey: attachmentCacheKey }).catch(() => undefined)
      }
    } catch (reason) {
      if (attachmentCacheKey && bridge) await bridge.attachments.removeChat({ cacheKey: attachmentCacheKey }).catch(() => undefined)
      onError?.(errorMessage(reason, 'Não foi possível preparar o pedido do Orchestrator.'))
    }
  }

  async function rejectDraftPlan() {
    if (!draftPlan || busy) return
    const result = await onRun(() => api.rejectOrchestratorPlan(session.id, draftPlan.id))
    if (result) onProposal(undefined)
  }

  async function reviseDraftPlan() {
    if (!draftPlan || busy) return
    const guidance = await promptDialog({
      title: 'Pedir alteração do plano',
      message: 'Descreva o que deve mudar. O Wharnex enviará o plano proposto atual como anexo para o Planner gerar uma nova versão.',
      inputLabel: 'Alteração pretendida',
      placeholder: 'Ex.: dividir a tarefa de migração e acrescentar uma etapa de rollback',
      confirmLabel: 'Pedir alteração',
      validate: (value) => value.trim() ? undefined : 'Descreva a alteração pretendida.',
    })
    if (guidance === undefined) return
    const result = await onRun(() => api.reviseOrchestratorPlan(session.id, draftPlan.id, guidance.trim()))
    if (result) onProposal(result)
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
    <OrchestratorTaskAttention tasks={overview.tasks} onSelectTask={onSelectTask}/>
    <section className="orchestrator-goal-stage">
      <div className="orchestrator-goal-copy">
        <span className="mb-[9px] block text-sm font-extrabold uppercase tracking-[0.09em] text-[var(--theme-accent)]">Planeie o resultado, não os cliques</span>
        <h1 className="m-0 text-2xl font-bold leading-[1.08] tracking-[-0.035em] text-[var(--theme-text)]">O que pretende realizar neste projeto?</h1>
        <p className="mx-auto mt-[13px] w-full max-w-[620px] text-base leading-[1.65] text-[var(--theme-text-muted)]">Descreva o objetivo. O Planner transforma-o em tarefas, dependências e critérios de conclusão antes de qualquer execução.</p>
      </div>
      <div className="orchestrator-composer-shell">
        <ChatPanel
          {...chatProps}
          session={session}
          activeChatId={`orchestrator-${session.id}`}
          busy={busy}
          embedded
          hideSwitcher
          composerOnly
          taskInFlight={false}
          preparedAttachmentCount={undefined}
          failedPromptDelivery={undefined}
          composerPlaceholder="Ex.: migrar o módulo de autenticação para Go, preservar compatibilidade e validar o cutover…"
          composerSendLabel="Gerar plano"
          composerHint="Enter gera o plano · Shift+Enter cria linha"
          onSend={propose}
        />
      </div>
    </section>

    <OrchestratorPlanningQueue requests={planningRequests} tasks={planningTasks} chats={chats} plans={overview.plans} busy={busy} onGoToChat={onGoToChat} onSelect={onSelectPlanningRequest} onOpenTasks={onOpenPlanTasks} onRetry={(requestId) => { void onRun(() => api.retryOrchestratorPlanning(session.id, requestId)) }}/>

    {proposal?.manual_prompt && !proposal.worker_task_id && <section className="orchestrator-manual-plan">
      <header><div><strong className="text-base">Planner manual</strong><span className="text-sm text-[var(--theme-text-muted)]">Envie este prompt ao ChatGPT e cole abaixo apenas o JSON devolvido.</span></div><button type="button" onClick={() => void navigator.clipboard.writeText(proposal.manual_prompt || '')}><Icon name="copy" size={14}/> Copiar prompt</button></header>
      <details><summary className="text-sm">Ver prompt</summary><pre className="font-mono text-sm leading-[1.5]">{proposal.manual_prompt}</pre></details>
      <textarea className="font-mono text-base leading-[1.55]" value={manualJSON} onChange={(event) => setManualJSON(event.target.value)} placeholder='{"protocol":"harness.orchestrator-plan/v1", ...}' rows={7}/>
      <button className="primary text-base font-bold" type="button" disabled={busy || !manualJSON.trim()} onClick={() => void importManual()}>Importar plano estruturado</button>
    </section>}

    {draftPlan && <section className="orchestrator-proposal-card">
      <header>
        <div><span className="text-sm font-extrabold uppercase tracking-[0.06em] text-[var(--theme-accent)]">Plano proposto · {draftTasks.length} tarefas</span><h2 className="mb-[3px] mt-1 text-lg">{draftPlan.title}</h2><p className="m-0 text-base leading-[1.5] text-[var(--theme-text-muted)]">{draftPlan.objective}</p></div>
        <div className="orchestrator-proposal-actions">
          <button type="button" className="secondary danger text-base font-bold" disabled={busy} onClick={() => void rejectDraftPlan()}><Icon name="close" size={14}/> Recusar</button>
          <button type="button" className="secondary text-base font-bold" disabled={busy} onClick={() => void reviseDraftPlan()}><Icon name="refresh" size={14}/> Pedir alteração</button>
          <button type="button" className="text-base font-bold" disabled={busy} onClick={() => void onRun(() => api.approveOrchestratorPlan(session.id, draftPlan.id), () => onProposal(undefined))}><Icon name="check" size={15}/> Aprovar e enviar ao fluxo</button>
        </div>
      </header>
      <div className="orchestrator-proposal-flow">
        {draftTasks.map((task, index) => <button key={task.id} type="button" onClick={() => onSelectTask(task)}>
          <span className="step font-mono text-sm leading-none text-[var(--theme-text-soft)]">{String(index + 1).padStart(2, '0')}</span>
          <span><strong className="text-base">{task.title}</strong><small className="text-sm text-[var(--theme-text-muted)]">{task.depends_on?.length ? `${task.depends_on.length} dependência(s)` : 'Sem dependências'} · {task.priority}</small></span>
          <Icon name="chevron-right" size={14}/>
        </button>)}
      </div>
    </section>}

    <OrchestratorActivity overview={overview} onOpenTasks={onOpenTasks} onSelectTask={onSelectTask}/>
  </div>
}
