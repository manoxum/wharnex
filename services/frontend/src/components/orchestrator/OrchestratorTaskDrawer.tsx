import { type ComponentProps, useEffect, useState } from 'react'
import { api } from '../../lib/api'
import { desktopBridge } from '../../lib/desktop'
import { encodeChatAttachments } from '../../lib/chatAttachments'
import { errorMessage } from '../../lib/errorMessage'
import type { ChatArtifactSelection, OrchestratorTask, OrchestratorTaskRun, OrchestratorTaskStatus, ReasoningEffort, Session } from '../../types'
import { ChatPanel } from '../ChatPanel'
import { Icon } from '../Icon'
import { Status } from './OrchestratorStatus'

type Props = {
  session: Session; task: OrchestratorTask; tasks: OrchestratorTask[]; chatProps?: ComponentProps<typeof ChatPanel>; busy: boolean
  onClose: () => void; onMove: (task: OrchestratorTask, target: OrchestratorTaskStatus) => Promise<void>
  onRun: <T>(action: () => Promise<T>, after?: (value: T) => void) => Promise<T | undefined>
  onSelectedTask: (task?: OrchestratorTask) => void
}

export function OrchestratorTaskDrawer({ session, task, tasks, chatProps, busy, onClose, onMove, onRun, onSelectedTask }: Props) {
  const [runs, setRuns] = useState<OrchestratorTaskRun[]>([])
  const [retryOpen, setRetryOpen] = useState(false)
  const [retryError, setRetryError] = useState('')
  useEffect(() => {
    let alive = true
    void api.orchestratorTaskRuns(session.id, task.id).then((value) => { if (alive) setRuns(value.runs) }).catch(() => undefined)
    return () => { alive = false }
  }, [session.id, task.id, task.updated_at])

  const unmet = (task.depends_on || []).some((id) => !['REVIEW', 'COMPLETE'].includes(tasks.find((item) => item.id === id)?.status || ''))

  async function setEffort(value: ReasoningEffort) {
    await onRun(() => api.setOrchestratorTaskEffort(session.id, task.id, value), onSelectedTask)
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

  return <div className="orchestrator-drawer-backdrop" data-chatgpt-overlay-blocker="true" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}><aside className="orchestrator-drawer task-detail">
    <header><div><span>{task.id}</span><strong>{task.title}</strong></div><button onClick={onClose} aria-label="Fechar"><Icon name="close" size={16}/></button></header>
    <div className="orchestrator-task-detail-body">
      <div className="orchestrator-task-detail-badges"><Status status={task.status}/><span className={`priority priority-${task.priority}`}>{task.priority}</span>{task.condition !== 'none' && <span className="condition">{task.condition.replaceAll('_', ' ')}</span>}</div>
      <p>{task.description || 'Sem descrição adicional.'}</p>
      {task.acceptance_criteria?.length ? <section><strong>Critérios de conclusão</strong><ul>{task.acceptance_criteria.map((criterion) => <li key={criterion}>{criterion}</li>)}</ul></section> : null}
      <section><strong>Dependências</strong><p>{task.depends_on?.length ? task.depends_on.join(', ') : 'Nenhuma dependência.'}</p></section>
      <section><strong>Nível de raciocínio</strong><select aria-label="Nível de raciocínio da tarefa" className="mt-2 rounded-md border border-[var(--theme-border)] bg-[var(--theme-surface)] px-2 py-1 text-[var(--theme-text)]" value={task.reasoning_effort || session.reasoning_effort || 'high'} disabled={busy || !['PENDING', 'WAITING', 'READY', 'FAILED'].includes(task.status)} onChange={(event) => void setEffort(event.target.value as ReasoningEffort)}><option value="instant">Instantâneo</option><option value="medium">Médio</option><option value="high">Elevado</option></select></section>
      <section><strong>Execuções</strong>{runs.length ? runs.map((run) => <div className="orchestrator-run" key={run.id}><span>{run.attempt}</span><div><strong>{run.status}</strong><small>{formatDate(run.started_at)}{run.error ? ` · ${run.error}` : ''}</small></div></div>) : <p>Nenhuma execução registrada.</p>}</section>
      {task.status === 'FAILED' && retryOpen && chatProps && <section className="rounded-lg border border-[var(--theme-border)] p-2"><strong>Contexto para reenviar</strong><ChatPanel {...chatProps} session={session} activeChatId={`orchestrator-retry-${task.id}`} busy={busy} embedded hideSwitcher composerOnly taskInFlight={false} composerPlaceholder="Descreva o que pode ajudar nesta nova tentativa…" composerSendLabel="Reenviar tarefa" onSend={retry}/></section>}
      {retryError && <p role="alert" className="text-[var(--theme-danger)]">{retryError}</p>}
    </div>
    <footer className="orchestrator-task-actions">
      {task.status === 'READY' && <span role="status">A aguardar um Worker livre</span>}
      {task.status === 'REVIEW' && <button className="primary" disabled={busy} onClick={() => void onMove(task, 'COMPLETE')}><Icon name="check" size={14}/> Concluir</button>}
      {task.status === 'PENDING' && <button disabled={busy} onClick={() => void onMove(task, unmet ? 'WAITING' : 'READY')}>{unmet ? 'Ativar dependências e esperar' : 'Enviar para READY'}</button>}
      {task.status === 'FAILED' && <><button disabled={busy} onClick={() => void retry('', [], [], { context: false, prompt: false, result: false, error: false })}>Reenviar sem contexto</button><button disabled={busy || !chatProps} onClick={() => setRetryOpen((open) => !open)}>{retryOpen ? 'Fechar contexto' : 'Adicionar contexto'}</button></>}
      {task.status === 'READY' && <button disabled={busy} onClick={() => void onMove(task, 'PENDING')}>Voltar a pendente</button>}
      {(task.status === 'COMPLETE' || task.status === 'ARCHIVED') && <button disabled={busy} onClick={() => void onMove(task, 'PENDING')}>Reabrir</button>}
      {task.status !== 'DOING' && task.status !== 'ARCHIVED' && <button disabled={busy} onClick={() => void onMove(task, 'ARCHIVED')}>Arquivar</button>}
    </footer>
  </aside></div>
}

function formatDate(value: string) {
  try { return new Intl.DateTimeFormat('pt', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(value)) } catch { return value }
}
