import { type ComponentProps, useEffect, useState } from 'react'
import { api } from '../../lib/api'
import { desktopBridge } from '../../lib/desktop'
import { encodeChatAttachments } from '../../lib/chatAttachments'
import { errorMessage } from '../../lib/errorMessage'
import { TASK_EFFORT_LEVELS, taskEffortLevel } from '../../lib/orchestratorEffort'
import type { ChatArtifactSelection, EffortLevel, OrchestratorTask, OrchestratorTaskStatus, ReasoningEffort, Session } from '../../types'
import { ChatPanel } from '../ChatPanel'
import { Icon } from '../Icon'
import { Status } from './OrchestratorStatus'
import { TaskBundleTab, TaskDetailTabBar, TaskEngineTab, TaskExecutionTab, TaskPlanTab, TaskRunSelector, TaskThinking, type TaskDetailTab } from './OrchestratorTaskDetailTabs'
import { useOrchestratorTaskRun } from './useOrchestratorTaskRun'

type Props = {
  session: Session; task: OrchestratorTask; tasks: OrchestratorTask[]; chatProps?: ComponentProps<typeof ChatPanel>; busy: boolean
  onClose: () => void; onMove: (task: OrchestratorTask, target: OrchestratorTaskStatus) => Promise<void>
  onRun: <T>(action: () => Promise<T>, after?: (value: T) => void) => Promise<T | undefined>
  onSelectedTask: (task?: OrchestratorTask) => void
}

export function OrchestratorTaskDrawer({ session, task, tasks, chatProps, busy, onClose, onMove, onRun, onSelectedTask }: Props) {
  const [retryOpen, setRetryOpen] = useState(false)
  const [retryError, setRetryError] = useState('')
  const [tab, setTab] = useState<TaskDetailTab>('overview')
  const detail = useOrchestratorTaskRun(session.id, task)
  useEffect(() => { setTab('overview') }, [task.id])

  const unmet = (task.depends_on || []).some((id) => !['REVIEW', 'COMPLETE'].includes(tasks.find((item) => item.id === id)?.status || ''))

  async function setEffort(value: ReasoningEffort) {
    await onRun(() => api.setOrchestratorTaskEffort(session.id, task.id, value), onSelectedTask)
  }

  async function setEffortLevel(value: EffortLevel) {
    await onRun(() => api.setOrchestratorTaskEffortLevel(session.id, task.id, value), onSelectedTask)
  }

  async function retry(guidance: string, attachments: File[], projectFiles: string[], artifacts: ChatArtifactSelection) {
    const bridge = desktopBridge()
    const files = [...attachments]
    if (artifacts.result && chatProps?.artifactContent?.result) files.push(new File([chatProps.artifactContent.result], 'wharnex-execution-result.md', { type: 'text/markdown' }))
    if (artifacts.error && chatProps?.artifactContent?.error) files.push(new File([chatProps.artifactContent.error], 'wharnex-execution-error.md', { type: 'text/markdown' }))
    if (files.length && !bridge) { setRetryError('Anexos requerem o Wharnex Desktop.'); return }
    const cacheKey = files.length ? `orch_retry_${crypto.randomUUID().replaceAll('-', '_')}` : ''
    try {
      const stored = files.length && bridge ? await bridge.attachments.persist({ cacheKey, messageId: crypto.randomUUID(), attachments: await encodeChatAttachments(files) }) : undefined
      const input = {
        guidance: guidance.trim(), project_files: projectFiles,
        attachment_cache_key: cacheKey || undefined,
        attachments: stored?.attachments.map((file) => ({ name: file.name, size: file.size, mime: file.mime, storage_ref: file.storageRef })),
      }
      const result = await onRun(() => api.retryOrchestratorTask(session.id, task.id, input), onSelectedTask)
      if (result) { setRetryOpen(false); setRetryError('') }
      else if (cacheKey && bridge) await bridge.attachments.removeChat({ cacheKey })
    } catch (reason) {
      if (cacheKey && bridge) await bridge.attachments.removeChat({ cacheKey }).catch(() => undefined)
      setRetryError(errorMessage(reason, 'Não foi possível preparar o reenvio.'))
    }
  }

  const runSelector = <TaskRunSelector runs={detail.runs} run={detail.run} onSelect={detail.selectRun}/>
  return <div className="orchestrator-drawer-backdrop" data-chatgpt-overlay-blocker="true" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}><aside className="orchestrator-drawer task-detail">
    <header><div><span className="truncate font-mono text-sm leading-[1.3] text-[var(--theme-text-soft)]">{task.id}</span><strong className="truncate text-lg">{task.title}</strong></div><button onClick={onClose} aria-label="Fechar"><Icon name="close" size={16}/></button></header>
    <TaskDetailTabBar tab={tab} onTab={setTab}/>
    {tab === 'bundle' && <div className="orchestrator-task-detail-body wide">{runSelector}<TaskBundleTab agent={detail.agent} loading={detail.loading}/></div>}
    {tab === 'plan' && <div className="orchestrator-task-detail-body wide">{runSelector}<TaskPlanTab agent={detail.agent} events={detail.events} loading={detail.loading} error={detail.error}/></div>}
    {tab === 'execution' && <div className="orchestrator-task-detail-body wide">{runSelector}<TaskExecutionTab agent={detail.agent} events={detail.events} loading={detail.loading} error={detail.error}/></div>}
    {tab === 'engine' && <div className="orchestrator-task-detail-body wide"><TaskEngineTab task={task}/></div>}
    {tab === 'overview' && <div className="orchestrator-task-detail-body">
      <div className="orchestrator-task-detail-badges"><Status status={task.status}/><span className={`priority priority-${task.priority} font-mono text-sm leading-[1.4]`}>{task.priority}</span>{task.condition !== 'none' && <span className="condition text-sm">{task.condition.replaceAll('_', ' ')}</span>}</div>
      <p className="text-base">{task.description || 'Sem descrição adicional.'}</p>
      {task.acceptance_criteria?.length ? <section><strong className="text-base">Critérios de conclusão</strong><ul>{task.acceptance_criteria.map((criterion) => <li className="text-sm" key={criterion}>{criterion}</li>)}</ul></section> : null}
      <section><strong className="text-base">Dependências</strong><p className="text-sm">{task.depends_on?.length ? task.depends_on.join(', ') : 'Nenhuma dependência.'}</p></section>
      <section><strong className="text-base">Esforço</strong><select aria-label="Nível de esforço da tarefa" title="Tentativas automáticas antes de a task falhar" className="mt-2 rounded-md border border-[var(--theme-border)] bg-[var(--theme-surface)] px-2 py-1 text-base text-[var(--theme-text)]" value={taskEffortLevel(task, session)} disabled={busy} onChange={(event) => void setEffortLevel(event.target.value as EffortLevel)}>{TASK_EFFORT_LEVELS.map((level) => <option key={level.value} value={level.value}>{level.label}</option>)}</select>{task.status === 'DOING' && <small className="mt-1 block text-sm text-[var(--theme-muted)]">Aplica-se ao orçamento restante desta execução.</small>}</section>
      <section><strong className="text-base">Nível de raciocínio</strong><select aria-label="Nível de raciocínio da tarefa" className="mt-2 rounded-md border border-[var(--theme-border)] bg-[var(--theme-surface)] px-2 py-1 text-base text-[var(--theme-text)]" value={task.reasoning_effort || session.reasoning_effort || 'high'} disabled={busy} onChange={(event) => void setEffort(event.target.value as ReasoningEffort)}><option value="instant">Instantâneo</option><option value="medium">Médio</option><option value="high">Elevado</option></select>{task.status === 'DOING' && <small className="mt-1 block text-sm text-[var(--theme-muted)]">Aplica-se ao próximo pedido desta tarefa.</small>}</section>
      <section><strong className="text-base">Pensamento da IA</strong>{runSelector}<TaskThinking agent={detail.agent} loading={detail.loading}/></section>
      {task.status === 'FAILED' && retryOpen && chatProps && <section className="rounded-lg border border-[var(--theme-border)] p-2"><strong className="text-base">Contexto para reenviar</strong><ChatPanel {...chatProps} session={session} activeChatId={`orchestrator-retry-${task.id}`} busy={busy} embedded hideSwitcher composerOnly taskInFlight={false} composerPlaceholder="Descreva o que pode ajudar nesta nova tentativa…" composerSendLabel="Reenviar tarefa" onSend={retry}/></section>}
      {retryError && <p role="alert" className="text-base text-[var(--theme-danger)]">{retryError}</p>}
    </div>}
    <footer className="orchestrator-task-actions">
      {task.status === 'READY' && <span className="text-sm" role="status">A aguardar um Worker livre</span>}
      {task.status === 'REVIEW' && <button className="primary text-base font-bold" disabled={busy} onClick={() => void onMove(task, 'COMPLETE')}><Icon name="check" size={14}/> Concluir</button>}
      {task.status === 'PENDING' && <button className="text-base" disabled={busy} onClick={() => void onMove(task, unmet ? 'WAITING' : 'READY')}>{unmet ? 'Ativar dependências e esperar' : 'Enviar para READY'}</button>}
      {task.status === 'FAILED' && <><button className="text-base" disabled={busy} onClick={() => void retry('', [], [], { context: false, prompt: false, result: false, error: false })}>Reenviar sem contexto</button><button className="text-base" disabled={busy || !chatProps} onClick={() => setRetryOpen((open) => !open)}>{retryOpen ? 'Fechar contexto' : 'Adicionar contexto'}</button></>}
      {task.status === 'READY' && <button className="text-base" disabled={busy} onClick={() => void onMove(task, 'PENDING')}>Voltar a pendente</button>}
      {(task.status === 'COMPLETE' || task.status === 'ARCHIVED') && <button className="text-base" disabled={busy} onClick={() => void onMove(task, 'PENDING')}>Reabrir</button>}
      {task.status !== 'DOING' && task.status !== 'ARCHIVED' && <button className="text-base" disabled={busy} onClick={() => void onMove(task, 'ARCHIVED')}>Arquivar</button>}
    </footer>
  </aside></div>
}
