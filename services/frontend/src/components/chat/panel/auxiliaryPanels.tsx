import type { ChatArtifactKind, QueuedChatRequest } from '../../../types'
import { Icon } from '../../presentation/chrome/Icon'
import { InternalWindow } from '../../workspace/window/InternalWindow'
import { MarkdownContent } from '../../presentation/content/MarkdownContent'
import { formatMessageTime } from './noticePresentation'
import { artifactIcon } from './presentation/artifactPresentation'
import { artifactLabel } from './presentation/artifactPresentation'

export function QueuePanel({ requests, editingId, editingText, onEditing, onEditingText, onSave, onCancel, onMove, onRemove, onMerge, onPromote, onClose }: {
  requests: QueuedChatRequest[]; editingId: string; editingText: string; onEditing: (id: string, text: string) => void; onEditingText: (text: string) => void; onSave: () => void; onCancel: () => void; onMove?: (id: string, direction: -1 | 1) => void; onRemove?: (id: string) => void; onMerge?: (id: string) => void; onPromote?: (id: string) => Promise<void>; onClose: () => void
}) {
  return <section className="request-queue-panel" aria-label="Fila de espera">
    <header><div><strong>Fila de requests</strong><span>{requests.length} à espera da conclusão da request atual e respetivos workflows.</span></div><button type="button" className="icon-button light" onClick={onClose} aria-label="Fechar fila"><Icon name="close" size={12}/></button></header>
    <div className="request-queue-list">{requests.map((request, index) => <article className="request-queue-item" key={request.id}>
      <div className="queue-position">{index + 1}</div>
      <div className="queue-copy">{editingId === request.id ? <textarea autoFocus value={editingText} onChange={(event) => onEditingText(event.target.value)} /> : <><strong>{request.message}</strong><span>{request.attachments.length ? `${request.attachments.length} anexo(s) · ` : ''}{formatMessageTime(request.createdAt)}</span></>}</div>
      <div className="queue-actions">{editingId === request.id ? <><button type="button" title="Cancelar" onClick={onCancel}><Icon name="close" size={12}/></button><button type="button" title="Guardar" onClick={onSave}><Icon name="check" size={12}/></button></> : <>
        <button type="button" title="Promover para comentário" aria-label="Promover para comentário" onClick={() => void onPromote?.(request.id)}><Icon name="chatgpt" size={12}/></button>
        <button type="button" title="Editar" aria-label="Editar request" onClick={() => onEditing(request.id, request.message)}><Icon name="rename" size={12}/></button>
        <button type="button" title="Subir" aria-label="Subir request" disabled={index === 0} onClick={() => onMove?.(request.id, -1)}><Icon name="arrow-up" size={12}/></button>
        <button type="button" title="Descer" aria-label="Descer request" disabled={index === requests.length - 1} onClick={() => onMove?.(request.id, 1)}><Icon name="arrow-down" size={12}/></button>
        <button type="button" title="Mesclar com a próxima" aria-label="Mesclar com a próxima" disabled={index === requests.length - 1} onClick={() => onMerge?.(request.id)}><Icon name="plus" size={12}/></button>
        <button type="button" title="Remover" aria-label="Remover request" onClick={() => onRemove?.(request.id)}><Icon name="trash" size={12}/></button>
      </>}</div>
    </article>)}</div>
  </section>
}

export function TodoPanel({ todos, onClose }: { todos: Array<{ text: string; done: boolean }>; onClose: () => void }) {
  const done = todos.filter((todo) => todo.done).length
  return <section className="todo-panel" aria-label="Tarefas TODO"><header><div><strong>Tarefas</strong><span>{done}/{todos.length} concluídas</span></div><button type="button" className="icon-button light" onClick={onClose} aria-label="Fechar tarefas"><Icon name="close" size={12}/></button></header><div className="todo-progress"><i style={{ width: `${todos.length ? (done / todos.length) * 100 : 0}%` }}/></div><div className="todo-list">{todos.map((todo, index) => <div className={todo.done ? 'todo-entry done' : 'todo-entry'} key={`${todo.text}-${index}`}><span><Icon name={todo.done ? 'check' : 'plan'} size={11}/></span><p>{todo.text}</p></div>)}</div></section>
}

export function ArtifactInspector({ kind, content, onClose }: { kind: ChatArtifactKind; content: string; onClose: () => void }) {
  return <InternalWindow title={`Ver ${artifactLabel(kind)}`} onClose={onClose} layerClassName="artifact-inspector-backdrop"><section className="artifact-inspector" role="dialog" aria-modal="false" aria-label={`Ver ${artifactLabel(kind)}`}><header><div><span>{artifactIcon(kind)}</span><div><strong>{artifactLabel(kind)}</strong><small>Conteúdo efetivamente associado à iteração atual</small></div></div><button type="button" className="icon-button light" onClick={onClose} aria-label="Fechar conteúdo"><Icon name="close" size={13}/></button></header><div className="artifact-inspector-body"><MarkdownContent markdown={content}/></div></section></InternalWindow>
}
