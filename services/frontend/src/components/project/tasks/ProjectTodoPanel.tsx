import { translate as uiText, formatMessage } from '../../../lib/workspace/localization'
import { ProjectTodoTabs, type ProjectTodoFilter } from './ProjectTodoTabs'
import { ProjectTodoEmptyState, TodoCard } from './presentation'
import { useEffect, useMemo, useState, type ComponentProps } from 'react'
import type { ProjectTodo, Session } from '../../../types'
import { api } from '../../../lib/transport/http/api'
import { desktopBridge } from '../../../lib/desktop/bridge/desktop'
import { encodeChatAttachments } from '../../../lib/chat/attachments/chatAttachments'
import { errorMessage } from '../../../lib/workspace/dialogs/errorMessage'
import { storedAttachmentFile, withProjectTodoPrePlan } from '../../../lib/project/context/projectTodoForwarding'
import { confirmDialog } from '../../../lib/desktop/bridge/appDialog'
import { ChatPanel } from '../../chat/panel/ChatPanel'
import { Icon } from '../../presentation/chrome/Icon'

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

const URGENCY_ORDER: Record<string, number> = { very_urgent: 0, urgent: 1, normal: 2, no_urgency: 3 }

function todoFilter(todo: ProjectTodo): ProjectTodoFilter {
  if (todo.status === 'done' || todo.archived_at) return 'completed'
  if (todo.execution_status === 'done') return 'executed'
  if (todo.execution_status === 'failed') return 'failed'
  if (todo.execution_status === 'processing') return 'pending'
  return 'open'
}

export function ProjectTodoPanel({ session, chatProps, onClose, onPromoteToChat, onPromoteToCurrentChat, onLocateChat, onGoToOrchestrator, onError }: Props) {
  const [items, setItems] = useState<ProjectTodo[]>([])
  const [filter, setFilter] = useState<ProjectTodoFilter>('open')
  const [busy, setBusy] = useState(false)
  const [initialLoad, setInitialLoad] = useState(true)
  const [composerOpen, setComposerOpen] = useState(false)

  async function refresh() {
    try { setItems((await api.projectTodos(session.id)).todos || []) }
    catch (reason) { onError(errorMessage(reason, uiText('Não foi possível carregar os TODOs.'))) }
    finally { setInitialLoad(false) }
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
    if (attachments.length && !bridge) throw new Error(uiText('Anexos do TODO requerem o Wharnex Desktop.'))
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
    } catch (reason) { onError(errorMessage(reason, uiText('Não foi possível atualizar o TODO.'))) }
    finally { setBusy(false) }
  }

  async function retryClassification(todo: ProjectTodo) {
    setBusy(true)
    try {
      const updated = await api.classifyProjectTodo(session.id, todo.id)
      setItems((current) => current.map((item) => item.id === updated.id ? updated : item))
    } catch (reason) { onError(errorMessage(reason, uiText('Não foi possível reenviar a classificação.'))) }
    finally { setBusy(false) }
  }


  async function deleteTodo(todo: ProjectTodo) {
    const confirmed = await confirmDialog({
      title: uiText("Eliminar TODO"),
      message: formatMessage('Eliminar definitivamente "{title}"? Esta ação não pode ser desfeita.', { title: todo.body.slice(0, 80) }),
      confirmLabel: uiText('Eliminar'), tone: 'danger',
    })
    if (!confirmed) return
    setBusy(true)
    try {
      await api.deleteProjectTodo(session.id, todo.id)
      setItems((current) => current.filter((item) => item.id !== todo.id))
    } catch (reason) { onError(errorMessage(reason, uiText('Não foi possível eliminar o TODO.'))) }
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
        if (!bridge) throw new Error(uiText('Encaminhar anexos do TODO requer o Wharnex Desktop.'))
        const stored = await bridge.attachments.read({ storageRef: attachment.storage_ref })
        sourceFiles.push(storedAttachmentFile(stored, attachment.mime || 'application/octet-stream'))
      }
      const files = withProjectTodoPrePlan(todo, sourceFiles)
      if (files.length && !bridge) throw new Error(uiText('Encaminhar a pré-análise do TODO requer o Wharnex Desktop.'))

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
      onError(errorMessage(reason, uiText('Não foi possível enviar o TODO para o Orchestrator.')))
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
  const showContextualAdd = !initialLoad && filter === 'open' && visible.length === 0 && !composerOpen

  return <section className={`project-todo-panel ${composerOpen ? 'composer-open' : ''}`} aria-label={uiText("TODO do projeto")}>
    <header className="agent-drawer-heading project-todo-heading">
      <div><span className="panel-kicker">{uiText("Inbox do projeto")}</span><strong>TODO</strong><small>{formatMessage('{open} abertos · {running} em execução · {done} feitos', { open: counts.open, running: counts.pending, done: counts.executed })}</small></div>
      <button type="button" className="agent-drawer-icon" onClick={onClose} aria-label={uiText("Fechar TODO")}><Icon name="close" size={13}/></button>
    </header>
    <ProjectTodoTabs value={filter} onChange={setFilter} counts={counts}/>
    <div className={`grid min-h-0 min-w-0 gap-2.5 overflow-auto [scrollbar-gutter:stable] px-2.5 pt-3 ${visible.length || initialLoad ? 'content-start' : 'content-center'} ${composerOpen || showContextualAdd ? 'pb-3' : 'pb-[86px]'}`}>
      {initialLoad ? <p role="status" className="m-0 px-4 py-6 text-center text-whx-label text-whx-faint">{uiText("A carregar TODOs…")}</p> : visible.length ? visible.map((todo) => <TodoCard key={todo.id} todo={todo} busy={busy} onStatus={() => void updateStatus(todo)} onRetry={() => void retryClassification(todo)} onChat={() => void onPromoteToChat?.(todo)} onCurrentChat={() => void onPromoteToCurrentChat?.(todo)} onLocate={() => todo.execution_chat_id && onLocateChat?.(todo.execution_chat_id)} onOrchestrator={() => void promoteToOrchestrator(todo)} onDelete={() => void deleteTodo(todo)}/>) : <ProjectTodoEmptyState filter={filter} onAdd={() => setComposerOpen(true)}/>}
    </div>
    {composerOpen ? <div className="project-todo-composer" aria-label={uiText("Nova ideia")}>
      <header><div><span>{uiText("Nova ideia")}</span><strong>{uiText("Registar TODO")}</strong></div><button type="button" onClick={() => setComposerOpen(false)} aria-label={uiText("Fechar nova ideia")}><Icon name="close" size={13}/></button></header>
      <ChatPanel {...chatProps} session={session} items={[]} chats={[]} archivedChats={[]} activeChatId={`project-todo-${session.id}`} busy={busy} composerOnly compactComposer attachmentsEnabled={Boolean(desktopBridge())}
        composerPlaceholder={uiText("Descreva a ideia, necessidade, erro ou melhoria…")} composerSendLabel={uiText("Adicionar TODO")} composerHint={uiText("Pode usar @file, @ref, @attach e anexar ficheiros. O Worker classifica, detalha e prepara um pré-plano depois.")}
        onSend={async (message, attachments, projectFiles) => { try { await createTodo(message, attachments, projectFiles) } catch (reason) { onError(errorMessage(reason, uiText('Não foi possível criar o TODO.'))); throw reason } }}/>
    </div> : !showContextualAdd ? <button type="button" className="project-todo-fab" onClick={() => setComposerOpen(true)} aria-label={uiText("Adicionar nova ideia")} aria-expanded="false"><Icon name="plus" size={17}/><span>{uiText("Nova ideia")}</span></button> : null}
  </section>
}
