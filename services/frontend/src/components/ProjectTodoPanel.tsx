import { useEffect, useMemo, useState, type ComponentProps } from 'react'
import type { ProjectTodo, Session } from '../types'
import { api } from '../lib/api'
import { desktopBridge } from '../lib/desktop'
import { encodeChatAttachments } from '../lib/chatAttachments'
import { errorMessage } from '../lib/errorMessage'
import { storedAttachmentFile, withProjectTodoPrePlan } from '../lib/projectTodoForwarding'
import { confirmDialog } from '../lib/appDialog'
import { ChatPanel } from './ChatPanel'
import { Icon } from './Icon'

type Props = {
  session: Session
  chatProps: ComponentProps<typeof ChatPanel>
  onClose: () => void
  onPromoteToChat?: (todo: ProjectTodo) => Promise<void>
  onPromoteToCurrentChat?: (todo: ProjectTodo) => Promise<void>
  onLocateChat?: (chatId: string) => void
  onGoToOrchestrator?: () => void
  onError: (message: string) => void
}

const KIND_LABEL: Record<string, string> = { feature: 'Funcionalidade', improvement: 'Melhoria', error: 'Erro' }
const URGENCY_LABEL: Record<string, string> = { very_urgent: 'Muito urgente', urgent: 'Urgente', normal: 'Normal', no_urgency: 'Sem urgência' }
const URGENCY_ORDER: Record<string, number> = { very_urgent: 0, urgent: 1, normal: 2, no_urgency: 3 }

type TodoFilter = 'open' | 'pending' | 'executed' | 'failed' | 'completed'

function todoFilter(todo: ProjectTodo): TodoFilter {
  if (todo.status === 'done' || todo.archived_at) return 'completed'
  if (todo.execution_status === 'done') return 'executed'
  if (todo.execution_status === 'failed') return 'failed'
  if (todo.execution_status === 'processing') return 'pending'
  return 'open'
}

export function ProjectTodoPanel({ session, chatProps, onClose, onPromoteToChat, onPromoteToCurrentChat, onLocateChat, onGoToOrchestrator, onError }: Props) {
  const [items, setItems] = useState<ProjectTodo[]>([])
  const [filter, setFilter] = useState<TodoFilter>('open')
  const [busy, setBusy] = useState(false)
  const [composerOpen, setComposerOpen] = useState(false)

  async function refresh() {
    try { setItems((await api.projectTodos(session.id)).todos || []) }
    catch (reason) { onError(errorMessage(reason, 'Não foi possível carregar os TODOs.')) }
  }

  useEffect(() => {
    void refresh()
    const timer = window.setInterval(() => void refresh(), 15_000)
    return () => window.clearInterval(timer)
  }, [session.id])

  async function createTodo(message: string, attachments: File[], projectFiles: string[]) {
    const body = message.trim()
    if (!body) return
    const bridge = desktopBridge()
    if (attachments.length && !bridge) throw new Error('Anexos do TODO requerem o Wharnex Desktop.')
    const cacheKey = attachments.length ? `todo_${crypto.randomUUID().replaceAll('-', '_')}` : ''
    setBusy(true)
    try {
      let stored: ProjectTodo['attachments'] = []
      if (attachments.length && bridge) {
        const encoded = await encodeChatAttachments(attachments)
        const result = await bridge.attachments.persist({ cacheKey, messageId: 'source', attachments: encoded })
        stored = result.attachments.map((file) => ({ name: file.name, size: file.size, mime: file.mime, storage_ref: file.storageRef, preview_kind: file.previewKind }))
      }
      const created = await api.createProjectTodo(session.id, { body, attachment_cache_key: cacheKey || undefined, attachments: stored, project_files: projectFiles })
      setItems((current) => [created, ...current.filter((item) => item.id !== created.id)])
      setComposerOpen(false)
    } catch (reason) {
      if (cacheKey && bridge) await bridge.attachments.removeChat({ cacheKey }).catch(() => undefined)
      throw reason
    } finally { setBusy(false) }
  }

  async function updateStatus(todo: ProjectTodo) {
    setBusy(true)
    try {
      const updated = await api.updateProjectTodo(session.id, todo.id, todo.status === 'done' ? 'open' : 'done')
      setItems((current) => current.map((item) => item.id === updated.id ? updated : item))
    } catch (reason) { onError(errorMessage(reason, 'Não foi possível atualizar o TODO.')) }
    finally { setBusy(false) }
  }

  async function retryClassification(todo: ProjectTodo) {
    setBusy(true)
    try {
      const updated = await api.classifyProjectTodo(session.id, todo.id)
      setItems((current) => current.map((item) => item.id === updated.id ? updated : item))
    } catch (reason) { onError(errorMessage(reason, 'Não foi possível reenviar a classificação.')) }
    finally { setBusy(false) }
  }


  async function deleteTodo(todo: ProjectTodo) {
    const confirmed = await confirmDialog({
      title: 'Eliminar TODO',
      message: `Eliminar definitivamente "${todo.body.slice(0, 80)}"? Esta ação não pode ser desfeita.`,
      confirmLabel: 'Eliminar', tone: 'danger',
    })
    if (!confirmed) return
    setBusy(true)
    try {
      await api.deleteProjectTodo(session.id, todo.id)
      setItems((current) => current.filter((item) => item.id !== todo.id))
    } catch (reason) { onError(errorMessage(reason, 'Não foi possível eliminar o TODO.')) }
    finally { setBusy(false) }
  }

  async function promoteToOrchestrator(todo: ProjectTodo) {
    setBusy(true)
    const bridge = desktopBridge()
    const sourceFiles: File[] = []
    const cacheKey = `orch_todo_${crypto.randomUUID().replaceAll('-', '_')}`
    let ownsCache = false
    try {
      for (const attachment of todo.attachments || []) {
        if (!bridge) throw new Error('Encaminhar anexos do TODO requer o Wharnex Desktop.')
        const stored = await bridge.attachments.read({ storageRef: attachment.storage_ref })
        sourceFiles.push(storedAttachmentFile(stored, attachment.mime || 'application/octet-stream'))
      }
      const files = withProjectTodoPrePlan(todo, sourceFiles)
      if (files.length && !bridge) throw new Error('Encaminhar a pré-análise do TODO requer o Wharnex Desktop.')

      let attachments: Array<{ name: string; size: number; mime: string; storage_ref: string }> | undefined
      if (files.length && bridge) {
        const encoded = await encodeChatAttachments(files)
        const stored = await bridge.attachments.persist({ cacheKey, messageId: crypto.randomUUID(), attachments: encoded })
        ownsCache = true
        attachments = stored.attachments.map((file) => ({ name: file.name, size: file.size, mime: file.mime, storage_ref: file.storageRef }))
      }

      const result = await api.proposeOrchestratorPlan(session.id, todo.body, {
        include_context: false, project_files: todo.project_files || [], attachment_cache_key: attachments?.length ? cacheKey : undefined, attachments, todo_ids: [todo.id],
      })
      if (!result.worker_task_id && ownsCache && bridge) {
        await bridge.attachments.removeChat({ cacheKey }).catch(() => undefined)
        ownsCache = false
      }
      await refresh()
      onGoToOrchestrator?.()
    } catch (reason) {
      if (ownsCache && bridge) await bridge.attachments.removeChat({ cacheKey }).catch(() => undefined)
      onError(errorMessage(reason, 'Não foi possível enviar o TODO para o Orchestrator.'))
    } finally { setBusy(false) }
  }

  const visible = useMemo(() => items
    .filter((item) => todoFilter(item) === filter)
    .sort((left, right) => (URGENCY_ORDER[left.urgency || ''] ?? 4) - (URGENCY_ORDER[right.urgency || ''] ?? 4)), [items, filter])
  const counts = useMemo(() => ({
    open: items.filter((item) => todoFilter(item) === 'open').length,
    pending: items.filter((item) => todoFilter(item) === 'pending').length,
    executed: items.filter((item) => todoFilter(item) === 'executed').length,
    failed: items.filter((item) => todoFilter(item) === 'failed').length,
    completed: items.filter((item) => todoFilter(item) === 'completed').length,
  }), [items])
  const emptyCopy: Record<TodoFilter, { title: string; detail: string }> = {
    open: { title: 'Tudo organizado por aqui', detail: 'TODOs ainda não enviados para chat ou Orchestrator aparecem aqui.' },
    pending: { title: 'Nada em execução', detail: 'TODOs enviados ficam aqui enquanto o pedido ou plano está a ser processado.' },
    executed: { title: 'Ainda não há TODOs feitos', detail: 'Execuções terminadas com sucesso aparecem aqui.' },
    failed: { title: 'Sem falhas', detail: 'TODOs cuja execução falhou aparecem aqui com a ligação ao chat de origem.' },
    completed: { title: 'Ainda não há TODOs concluídos', detail: 'Itens concluídos manualmente ficam guardados aqui.' },
  }

  return <section className={`project-todo-panel ${composerOpen ? 'composer-open' : ''}`} aria-label="TODO do projeto">
    <header className="agent-drawer-heading project-todo-heading">
      <div><span className="panel-kicker">Inbox do projeto</span><strong>TODO</strong><small>{counts.open} abertos · {counts.pending} em execução · {counts.executed} feitos</small></div>
      <button type="button" className="agent-drawer-icon" onClick={onClose} aria-label="Fechar TODO"><Icon name="close" size={13}/></button>
    </header>
    <nav className="project-todo-tabs" aria-label="Estado dos TODOs">
      <button type="button" title="Abertos" aria-pressed={filter === 'open'} onClick={() => setFilter('open')}><Icon name="list" size={13}/><span className="semantic-tab-label">Abertos</span><b>{counts.open}</b></button>
      <button type="button" title="Fazendo" aria-pressed={filter === 'pending'} onClick={() => setFilter('pending')}><Icon name="play" size={13}/><span className="semantic-tab-label">Fazendo</span><b>{counts.pending}</b></button>
      <button type="button" title="Feito" aria-pressed={filter === 'executed'} onClick={() => setFilter('executed')}><Icon name="check" size={13}/><span className="semantic-tab-label">Feito</span><b>{counts.executed}</b></button>
      <button type="button" title="Falha" aria-pressed={filter === 'failed'} onClick={() => setFilter('failed')}><Icon name="alert" size={13}/><span className="semantic-tab-label">Falha</span><b>{counts.failed}</b></button>
      <button type="button" title="Concluídos" aria-pressed={filter === 'completed'} onClick={() => setFilter('completed')}><Icon name="archive" size={13}/><span className="semantic-tab-label">Concluídos</span><b>{counts.completed}</b></button>
    </nav>
    <div className="project-todo-list">
      {visible.length ? visible.map((todo) => <TodoCard key={todo.id} todo={todo} busy={busy} onStatus={() => void updateStatus(todo)} onRetry={() => void retryClassification(todo)} onChat={() => void onPromoteToChat?.(todo)} onCurrentChat={() => void onPromoteToCurrentChat?.(todo)} onLocate={() => todo.execution_chat_id && onLocateChat?.(todo.execution_chat_id)} onOrchestrator={() => void promoteToOrchestrator(todo)} onDelete={() => void deleteTodo(todo)}/>) : <div className="agent-drawer-empty project-todo-empty"><Icon name="check" size={18}/><strong>{emptyCopy[filter].title}</strong><span>{emptyCopy[filter].detail}</span></div>}
    </div>
    {composerOpen ? <div className="project-todo-composer" aria-label="Nova ideia">
      <header><div><span>Nova ideia</span><strong>Registar TODO</strong></div><button type="button" onClick={() => setComposerOpen(false)} aria-label="Fechar nova ideia"><Icon name="close" size={13}/></button></header>
      <ChatPanel {...chatProps} session={session} items={[]} chats={[]} archivedChats={[]} activeChatId={`project-todo-${session.id}`} busy={busy} composerOnly compactComposer attachmentsEnabled={Boolean(desktopBridge())}
        composerPlaceholder="Descreva a ideia, necessidade, erro ou melhoria…" composerSendLabel="Adicionar TODO" composerHint="Pode usar @file, @ref, @attach e anexar ficheiros. O Worker classifica, detalha e prepara um pré-plano depois."
        onSend={async (message, attachments, projectFiles) => { try { await createTodo(message, attachments, projectFiles) } catch (reason) { onError(errorMessage(reason, 'Não foi possível criar o TODO.')); throw reason } }}/>
    </div> : <button type="button" className="project-todo-fab" onClick={() => setComposerOpen(true)} aria-label="Adicionar nova ideia" aria-expanded="false"><Icon name="plus" size={17}/><span>Nova ideia</span></button>}
  </section>
}

function TodoCard({ todo, busy, onStatus, onRetry, onChat, onCurrentChat, onLocate, onOrchestrator, onDelete }: { todo: ProjectTodo; busy: boolean; onStatus: () => void; onRetry: () => void; onChat: () => void; onCurrentChat: () => void; onLocate: () => void; onOrchestrator: () => void; onDelete: () => void }) {
  const classified = todo.classification_status === 'classified'
  const classification = classified
    ? <><span className={`todo-badge kind-${todo.kind || 'unknown'}`}>{KIND_LABEL[todo.kind || ''] || todo.kind}</span><span className={`todo-badge urgency-${todo.urgency || 'normal'}`}>{URGENCY_LABEL[todo.urgency || ''] || todo.urgency}</span></>
    : todo.classification_status === 'failed'
      ? <><span className="todo-badge classification-failed">Análise pendente</span><button type="button" className="todo-inline-action" disabled={busy} onClick={onRetry}><Icon name="refresh" size={11}/> Tentar novamente</button></>
      : <span className="todo-badge classification-queued"><Icon name="agent" size={11}/> Worker na fila</span>
  const execution = todo.execution_status === 'processing' ? <span className="todo-badge classification-queued">Em execução</span>
    : todo.execution_status === 'done' ? <span className="todo-badge kind-improvement">Feito</span>
      : todo.execution_status === 'failed' ? <span className="todo-badge classification-failed">Falha</span> : null

  return <article className={`project-todo-card ${todo.status}`}>
    <div className="project-todo-meta"><div className="project-todo-badges">{classification}{execution}</div><time dateTime={todo.created_at}>{new Date(todo.created_at).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' })}</time></div>
    <p className="project-todo-body">{todo.body}</p>
    {classified && (todo.description || todo.pre_plan?.length) ? <section className="project-todo-worker-detail">
      <header><span><Icon name="agent" size={12}/></span><div><small>Análise do Worker</small><strong>Contexto preparado para execução</strong></div></header>
      {todo.description ? <p>{todo.description}</p> : null}
      {todo.pre_plan?.length ? <div className="project-todo-preplan"><small>Pré-plano</small><ol>{todo.pre_plan.map((step, index) => <li key={`${todo.id}-step-${index}`}>{step}</li>)}</ol></div> : null}
    </section> : null}
    {(todo.project_files?.length || todo.attachments?.length) ? <div className="project-todo-links">
      {(todo.project_files || []).map((path) => <span key={path}><Icon name="file" size={11}/>{path}</span>)}
      {(todo.attachments || []).map((file) => <button type="button" key={file.storage_ref} onClick={() => void desktopBridge()?.attachments.open({ storageRef: file.storage_ref })}><Icon name="file" size={11}/>{file.name}</button>)}
    </div> : null}
    <div className="project-todo-actions">
      <button type="button" className="primary" disabled={busy} onClick={onChat}><Icon name="chatgpt" size={12}/> Novo chat</button>
      <button type="button" disabled={busy} onClick={onCurrentChat}><Icon name="chatgpt" size={12}/> Chat atual</button>
      <button type="button" disabled={busy} onClick={onOrchestrator}><Icon name="plan" size={12}/> Orchestrator</button>
      {todo.execution_chat_id ? <button type="button" disabled={busy} onClick={onLocate}><Icon name="link" size={12}/> Localizar chat</button> : null}
      <button type="button" disabled={busy} onClick={onStatus}><Icon name="check" size={12}/>{todo.status === 'done' ? 'Reabrir' : 'Concluir'}</button>
      <button type="button" className="danger" disabled={busy} onClick={onDelete} aria-label="Eliminar TODO" title="Eliminar definitivamente"><Icon name="trash" size={12}/> Eliminar</button>
    </div>
  </article>
}
