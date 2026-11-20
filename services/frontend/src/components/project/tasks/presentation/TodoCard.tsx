import { useTranslation, interfaceLocale } from '../../../../lib/workspace/localization'
import type { ProjectTodo } from '../../../../types'
import { desktopBridge } from '../../../../lib/desktop/bridge/desktop'
import { Icon } from '../../../presentation/chrome/Icon'
const KIND_LABEL: Record<string, string> = { feature: 'Funcionalidade', improvement: 'Melhoria', error: 'Erro' }
const URGENCY_LABEL: Record<string, string> = { very_urgent: 'Muito urgente', urgent: 'Urgente', normal: 'Normal', no_urgency: 'Sem urgência' }

export function TodoCard({ todo, busy, onStatus, onRetry, onChat, onCurrentChat, onLocate, onOrchestrator, onDelete }: { todo: ProjectTodo; busy: boolean; onStatus: () => void; onRetry: () => void; onChat: () => void; onCurrentChat: () => void; onLocate: () => void; onOrchestrator: () => void; onDelete: () => void }) {
  const uiText = useTranslation()
  const classified = todo.classification_status === 'classified'
  const classification = classified
    ? <><span className={`todo-badge kind-${todo.kind || 'unknown'}`}>{KIND_LABEL[todo.kind || ''] ? uiText(KIND_LABEL[todo.kind || '']) : todo.kind}</span><span className={`todo-badge urgency-${todo.urgency || 'normal'}`}>{URGENCY_LABEL[todo.urgency || ''] ? uiText(URGENCY_LABEL[todo.urgency || '']) : todo.urgency}</span></>
    : todo.classification_status === 'failed'
      ? <><span className="todo-badge classification-failed">{uiText("Análise pendente")}</span><button type="button" className="todo-inline-action" disabled={busy} onClick={onRetry}><Icon name="refresh" size={11}/> {' '}{uiText("Tentar novamente")}</button></>
      : <span className="todo-badge classification-queued"><Icon name="agent" size={11}/> {' '}{uiText("Worker na fila")}</span>
  const execution = todo.execution_status === 'processing' ? <span className="todo-badge classification-queued">{uiText("Em execução")}</span>
    : todo.execution_status === 'done' ? <span className="todo-badge kind-improvement">{uiText("Feito")}</span>
      : todo.execution_status === 'failed' ? <span className="todo-badge classification-failed">{uiText("Falha")}</span> : null

  return <article className={`project-todo-card ${todo.status}`}>
    <div className="project-todo-meta"><div className="project-todo-badges">{classification}{execution}</div><time dateTime={todo.created_at}>{new Date(todo.created_at).toLocaleString(interfaceLocale(), { dateStyle: 'short', timeStyle: 'short' })}</time></div>
    <p className="project-todo-body">{todo.body}</p>
    {classified && (todo.description || todo.pre_plan?.length) ? <section className="project-todo-worker-detail">
      <header><span><Icon name="agent" size={12}/></span><div><small>{uiText("Análise do Worker")}</small><strong>{uiText("Contexto preparado para execução")}</strong></div></header>
      {todo.description ? <p>{todo.description}</p> : null}
      {todo.pre_plan?.length ? <div className="project-todo-preplan"><small>{uiText("Pré-plano")}</small><ol>{todo.pre_plan.map((step, index) => <li key={`${todo.id}-step-${index}`}>{step}</li>)}</ol></div> : null}
    </section> : null}
    {(todo.project_files?.length || todo.attachments?.length) ? <div className="project-todo-links">
      {(todo.project_files || []).map((path) => <span key={path}><Icon name="file" size={11}/>{path}</span>)}
      {(todo.attachments || []).map((file) => <button type="button" key={file.storage_ref} onClick={() => void desktopBridge()?.attachments.open({ storageRef: file.storage_ref })}><Icon name="file" size={11}/>{file.name}</button>)}
    </div> : null}
    <div className="project-todo-actions">
      <button type="button" className="primary" disabled={busy} onClick={onChat}><Icon name="chatgpt" size={12}/> {' '}{uiText("Novo chat")}</button>
      <button type="button" disabled={busy} onClick={onCurrentChat}><Icon name="chatgpt" size={12}/> {' '}{uiText("Chat atual")}</button>
      <button type="button" disabled={busy} onClick={onOrchestrator}><Icon name="plan" size={12}/> Orchestrator</button>
      {todo.execution_chat_id ? <button type="button" disabled={busy} onClick={onLocate}><Icon name="link" size={12}/> {' '}{uiText("Localizar chat")}</button> : null}
      <button type="button" disabled={busy} onClick={onStatus}><Icon name="check" size={12}/>{todo.status === 'done' ? uiText("Reabrir") : uiText("Concluir")}</button>
      <button type="button" className="danger" disabled={busy} onClick={onDelete} aria-label={uiText("Eliminar TODO")} title={uiText("Eliminar definitivamente")}><Icon name="trash" size={12}/> {' '}{uiText("Eliminar")}</button>
    </div>
  </article>
}
