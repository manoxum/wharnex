import { type ClipboardEvent, type FormEvent, useEffect, useMemo, useRef, useState } from 'react'
import type { ChatArtifactKind, ChatArtifactSelection, ChatChangeFile, ChatItem, ChatRequestMode, QueuedChatRequest, Session } from '../types'
import { clearComposerDraft, loadComposerDraft, saveComposerDraft, type WorkspaceChat } from '../lib/workspaceMemory'
import { Icon } from './Icon'
import { StatusPill } from './StatusPill'
import { stateLabel } from '../lib/risk'
import { addChatAttachments, uniquifyPastedChatFiles } from '../lib/chatAttachments'
import { MessageAttachmentCard, ComposerAttachmentChip } from './ChatAttachmentCard'
import { MarkdownContent } from './MarkdownContent'

export function ChatPanel({ session, items, chats, archivedChats, activeChatId, busy, attachmentsEnabled, preparedAttachmentCount, artifactSelection, artifactRequired, artifactContent, requestMode = 'direct', taskInFlight = false, queuedRequests = [], onToggleArtifact, onRequestMode, onSend, onComment, onQueueEdit, onQueueMove, onQueueRemove, onQueueMerge, onQueuePromote, onApprovePlan, onRejectPlan, onConfirmPrepared, onDismissPrepared, onOpenFile, onRevertChange, onNewChat, onSelectChat, onArchiveChat, onRestoreChat, onDeleteArchivedChat }: {
  session: Session
  items: ChatItem[]
  chats: WorkspaceChat[]
  archivedChats: WorkspaceChat[]
  activeChatId: string
  busy: boolean
  attachmentsEnabled?: boolean
  preparedAttachmentCount?: number
  artifactSelection?: ChatArtifactSelection
  artifactRequired?: Partial<Record<ChatArtifactKind, boolean>>
  artifactContent?: Partial<Record<ChatArtifactKind, string>>
  requestMode?: ChatRequestMode
  taskInFlight?: boolean
  queuedRequests?: QueuedChatRequest[]
  onToggleArtifact?: (kind: ChatArtifactKind) => void
  onRequestMode?: (mode: ChatRequestMode) => void
  onSend: (message: string, attachments: File[], artifacts: ChatArtifactSelection, requestMode: ChatRequestMode) => Promise<void>
  onComment?: (message: string, attachments: File[]) => Promise<void>
  onQueueEdit?: (id: string, message: string) => void
  onQueueMove?: (id: string, direction: -1 | 1) => void
  onQueueRemove?: (id: string) => void
  onQueueMerge?: (id: string) => void
  onQueuePromote?: (id: string) => Promise<void>
  onApprovePlan?: (item: ChatItem) => Promise<void>
  onRejectPlan?: (item: ChatItem) => void
  onConfirmPrepared?: () => Promise<void>
  onDismissPrepared?: () => void
  onOpenFile?: (path: string) => void
  onRevertChange?: (item: ChatItem) => Promise<void>
  onNewChat: () => Promise<void>
  onSelectChat: (chatId: string) => Promise<void>
  onArchiveChat: (chatId: string) => Promise<void>
  onRestoreChat: (chatId: string) => Promise<void>
  onDeleteArchivedChat: (chatId: string) => Promise<void>
}) {
  const initialDraft = loadComposerDraft(session.project_path, activeChatId)
  const [message, setMessage] = useState(initialDraft.message)
  const [composerHeight, setComposerHeight] = useState(initialDraft.height)
  const [attachments, setAttachments] = useState<File[]>([])
  const [attachmentError, setAttachmentError] = useState('')
  const [copiedMessageId, setCopiedMessageId] = useState('')
  const [archiveOpen, setArchiveOpen] = useState(false)
  const [commentBusy, setCommentBusy] = useState(false)
  const [queueOpen, setQueueOpen] = useState(false)
  const [editingQueueId, setEditingQueueId] = useState('')
  const [editingQueueText, setEditingQueueText] = useState('')
  const [todoOpen, setTodoOpen] = useState(false)
  const [inspectedArtifact, setInspectedArtifact] = useState<ChatArtifactKind | ''>('')
  const [inspectedChangeFile, setInspectedChangeFile] = useState<ChatChangeFile>()
  const selectedArtifacts: ChatArtifactSelection = artifactSelection || { context: false, prompt: true, result: false, error: false }
  const endRef = useRef<HTMLDivElement>(null)
  const composerRef = useRef<HTMLFormElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const todos = useMemo(() => latestTodoSnapshot(items), [items])
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [items, busy])
  useEffect(() => { if (queuedRequests.length) setQueueOpen(true) }, [queuedRequests.length])
  useEffect(() => {
    const draft = loadComposerDraft(session.project_path, activeChatId)
    setMessage(draft.message); setComposerHeight(draft.height)
  }, [session.project_path, activeChatId])
  useEffect(() => { saveComposerDraft(session.project_path, activeChatId, { message, height: composerHeight }) }, [session.project_path, activeChatId, message, composerHeight])
  useEffect(() => {
    const textarea = textareaRef.current
    if (!textarea) return
    textarea.style.height = 'auto'
    textarea.style.height = `${Math.max(76, textarea.scrollHeight)}px`
  }, [message])
  useEffect(() => {
    const composer = composerRef.current
    if (!composer || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(() => setComposerHeight(Math.round(composer.getBoundingClientRect().height)))
    observer.observe(composer)
    return () => observer.disconnect()
  }, [])

  function clearComposer() {
    setMessage('')
    setAttachments([])
    setAttachmentError('')
    clearComposerDraft(session.project_path, activeChatId)
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  async function submitMain(event?: FormEvent) {
    event?.preventDefault()
    const text = message.trim() || (attachments.length ? 'Analise os ficheiros anexados.' : '')
    if (!text || preparedAttachmentCount || commentBusy) return
    const selected = attachments
    clearComposer()
    try { await onSend(text, selected, selectedArtifacts, requestMode) } catch { /* parent reports the actionable error */ }
  }

  async function submitComment() {
    const text = message.trim() || (attachments.length ? 'Analise os ficheiros anexados como orientação adicional para esta tarefa.' : '')
    if (!text || !taskInFlight || !onComment || preparedAttachmentCount || commentBusy) return
    const selected = attachments
    clearComposer()
    setCommentBusy(true)
    try { await onComment(text, selected) } catch { /* parent surfaces the transport error */ } finally { setCommentBusy(false) }
  }

  function addFiles(files: File[]) {
    const next = addChatAttachments(attachments, files)
    setAttachments(next.files); setAttachmentError(next.error || '')
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  function pasteFiles(event: ClipboardEvent<HTMLTextAreaElement>) {
    const clipboard = event.clipboardData
    const directFiles = Array.from(clipboard.files || []) as File[]
    const clipboardItems = Array.from(clipboard.items || []) as DataTransferItem[]
    const itemFiles = clipboardItems.flatMap((item) => item.kind === 'file' ? [item.getAsFile()] : []).filter((file): file is File => file !== null)
    const files = directFiles.length ? directFiles : itemFiles
    if (!files.length) return
    event.preventDefault()
    if (!attachmentsEnabled) {
      setAttachmentError('Colar ficheiros requer o Wharness Desktop com o planner manual.')
      return
    }
    addFiles(uniquifyPastedChatFiles(attachments, files))
  }

  async function copyMessage(item: ChatItem) {
    try {
      await navigator.clipboard.writeText(item.text)
    } catch {
      const textarea = document.createElement('textarea')
      textarea.value = item.text; textarea.style.position = 'fixed'; textarea.style.opacity = '0'
      document.body.appendChild(textarea); textarea.select(); document.execCommand('copy'); textarea.remove()
    }
    setCopiedMessageId(item.id)
    window.setTimeout(() => setCopiedMessageId((current) => current === item.id ? '' : current), 1400)
  }

  return <section className="chat-panel">
    <header className="panel-header chat-header">
      <div><span className="panel-kicker">Harness chat</span><h2>{session.context.manifest.project_root.split('/').pop() || 'Projeto'}</h2></div>
      <StatusPill tone={session.state === 'failed' ? 'danger' : session.state === 'verified' || session.state === 'applied' ? 'success' : 'neutral'}>{stateLabel(session.state)}</StatusPill>
    </header>

    <div className="chat-switcher" aria-label="Conversas do Harness">
      <button className="chat-new-button" disabled={busy} onClick={() => void onNewChat()} title="Novo chat"><Icon name="plus" size={14}/> Novo</button>
      <div className="chat-tabs">
        {chats.map((chat) => <div key={chat.id} className={chat.id === activeChatId ? 'chat-tab-group active' : 'chat-tab-group'}>
          <button className={chat.id === activeChatId ? 'chat-tab active' : 'chat-tab'} disabled={busy} onClick={() => void onSelectChat(chat.id)} title={chat.chatgptUrl ? `${chat.title}\nChatGPT: ${chat.chatgptUrl}` : `${chat.title}\nChatGPT ainda não vinculado`}>
            <span>{chat.title}</span><i className={chat.chatgptUrl ? 'chat-link-dot linked' : 'chat-link-dot'} aria-hidden="true" />
          </button>
          <button className="chat-tab-remove" disabled={busy} onClick={() => void onArchiveChat(chat.id)} title={`Fechar e arquivar ${chat.title}`} aria-label={`Fechar e arquivar chat ${chat.title}`}><Icon name="close" size={11}/></button>
        </div>)}
      </div>
      <button className={archiveOpen ? 'chat-archive-toggle active' : 'chat-archive-toggle'} disabled={busy && !archiveOpen} onClick={() => setArchiveOpen((current) => !current)} title="Chats fechados"><Icon name="folder" size={13}/><span>Arquivados</span>{archivedChats.length > 0 && <b>{archivedChats.length}</b>}</button>
    </div>

    {archiveOpen && <div className="chat-archive-panel">
      <div className="chat-archive-heading"><div><strong>Chats arquivados</strong><span>Fechar um chat preserva o histórico, o vínculo ChatGPT e os anexos locais.</span></div><button className="icon-button light" onClick={() => setArchiveOpen(false)} title="Fechar área de arquivados"><Icon name="close" size={13}/></button></div>
      {archivedChats.length ? <div className="chat-archive-list">{archivedChats.map((chat) => <div className="chat-archive-row" key={chat.id}>
        <div className="chat-archive-copy"><strong>{chat.title}</strong><span>{chat.chatgptUrl ? 'ChatGPT vinculado' : 'Sem vínculo ChatGPT'} · fechado em {formatMessageTime(chat.updatedAt)}</span></div>
        <div className="chat-archive-actions"><button className="text-button" disabled={busy} onClick={() => void onRestoreChat(chat.id)}><Icon name="refresh" size={12}/> Reabrir</button><button className="archive-delete-button" disabled={busy} onClick={() => void onDeleteArchivedChat(chat.id)} title="Eliminar definitivamente"><Icon name="trash" size={13}/></button></div>
      </div>)}</div> : <div className="chat-archive-empty">Nenhum chat fechado.</div>}
    </div>}

    <div className="chat-stream">
      <div className="system-note"><Icon name="shield" size={17}/><div><strong>Contexto isolado</strong><span>{session.context.manifest.files.length} ficheiros · {session.context.manifest.sha256.slice(0, 12)}</span></div></div>
      {items.map((item) => <ChatItemView key={item.id} item={item} copied={copiedMessageId === item.id} onCopy={copyMessage} onApprovePlan={onApprovePlan} onRejectPlan={onRejectPlan} onInspectArtifact={setInspectedArtifact} onInspectChange={setInspectedChangeFile} onOpenFile={onOpenFile} onRevertChange={onRevertChange} artifactContent={artifactContent} />)}
      {busy && !taskInFlight && <div className="chat-thought live"><span className="thought-mark"><Icon name="agent" size={13}/></span><div><strong>Wharness</strong><div className="thinking"><span/><span/><span/> A processar o pedido</div></div></div>}
      <div ref={endRef}/>
    </div>

    {preparedAttachmentCount ? <div className="prepared-draft" role="status"><div><strong>Preparação enviada ao ChatGPT</strong><span>{preparedAttachmentCount} anexo(s) preparados. O contexto ZIP é incluído automaticamente apenas quando necessário.</span></div><div><button type="button" className="text-button" onClick={onDismissPrepared}>Já enviei</button><button type="button" className="apply-button" disabled={busy} onClick={() => void onConfirmPrepared?.()}><Icon name="send" size={14}/> Confirmar e enviar</button></div></div> : null}

    {queueOpen && queuedRequests.length > 0 && <QueuePanel requests={queuedRequests} editingId={editingQueueId} editingText={editingQueueText} onEditing={(id, text) => { setEditingQueueId(id); setEditingQueueText(text) }} onEditingText={setEditingQueueText} onSave={() => { if (editingQueueId && editingQueueText.trim()) onQueueEdit?.(editingQueueId, editingQueueText.trim()); setEditingQueueId('') }} onCancel={() => setEditingQueueId('')} onMove={onQueueMove} onRemove={onQueueRemove} onMerge={onQueueMerge} onPromote={onQueuePromote} onClose={() => setQueueOpen(false)} />}
    {todoOpen && todos.length > 0 && <TodoPanel todos={todos} onClose={() => setTodoOpen(false)} />}

    <form ref={composerRef} className={`composer ${taskInFlight ? 'comment-mode' : ''}`} style={{ height: composerHeight }} onSubmit={submitMain}>
      <div className="composer-scroll-area">
      {attachments.length ? <div className="composer-attachments">{attachments.map((file) => <ComposerAttachmentChip key={`${file.name}-${file.size}-${file.lastModified}`} file={file} onRemove={() => setAttachments((current) => current.filter((item) => item !== file))}/>)}</div> : null}
      {attachmentError && <div className="composer-error" role="alert">{attachmentError}</div>}
      <textarea ref={textareaRef} lang="pt-PT" spellCheck autoCorrect="on" autoCapitalize="sentences" disabled={Boolean(preparedAttachmentCount)} value={message} onChange={(event) => setMessage(event.target.value)} onPaste={pasteFiles} onKeyDown={(event) => {
        if (event.key !== 'Enter' || event.shiftKey) return
        event.preventDefault()
        if ((event.ctrlKey || event.metaKey) && taskInFlight) void submitComment()
        else event.currentTarget.form?.requestSubmit()
      }} placeholder="Pergunte, analise, diagnostique ou descreva uma alteração…" rows={3}/>
      <div className="composer-footer">
        <div className="composer-toolbar-row"><div className="composer-action-row" aria-label="Opções da próxima iteração">
          <ArtifactToggle kind="context" label="Contexto ZIP" selected={selectedArtifacts.context} required={artifactRequired?.context} onToggle={onToggleArtifact} onInspect={setInspectedArtifact} inspectable={Boolean(artifactContent?.context)} />
          <ArtifactToggle kind="prompt" label="Prompt" selected={selectedArtifacts.prompt} required onToggle={onToggleArtifact} onInspect={setInspectedArtifact} inspectable={Boolean(artifactContent?.prompt)} />
          <ArtifactToggle kind="result" label="Resultado" selected={selectedArtifacts.result} disabled={!session.last_execution && !session.last_bundle} onToggle={onToggleArtifact} onInspect={setInspectedArtifact} inspectable={Boolean(artifactContent?.result)} />
          <ArtifactToggle kind="error" label="Erro" selected={selectedArtifacts.error} required={artifactRequired?.error} disabled={!session.last_repair_error && session.last_execution?.success !== false && !artifactRequired?.error} onToggle={onToggleArtifact} onInspect={setInspectedArtifact} inspectable={Boolean(artifactContent?.error)} />
          <input ref={fileInputRef} type="file" multiple hidden onChange={(event) => addFiles(Array.from(event.target.files || []))}/>
          <button type="button" className={attachments.length ? 'composer-round-action selected' : 'composer-round-action'} disabled={!attachmentsEnabled || Boolean(preparedAttachmentCount)} onClick={() => fileInputRef.current?.click()} title={attachmentsEnabled ? `Ficheiros do utilizador${attachments.length ? ` · ${attachments.length} selecionado(s)` : ''}` : 'Anexos diretos requerem o Desktop com planner manual'} aria-label="Anexar ficheiros"><Icon name="file" size={12}/>{attachments.length > 0 && <b>{attachments.length}</b>}</button>
          <span className="composer-action-divider" />
          <button type="button" className={`composer-round-action plan-first ${requestMode === 'plan_first' ? 'selected' : ''}`} aria-pressed={requestMode === 'plan_first'} aria-label="Planificar antes de alterar" title={requestMode === 'plan_first' ? 'Plan first ativo · o Wharness pedirá uma proposta e aguardará aprovação' : 'Planificar antes de alterar'} onClick={() => onRequestMode?.(requestMode === 'plan_first' ? 'direct' : 'plan_first')}><Icon name="plan" size={12}/></button>
          <button type="button" className={`composer-round-action ${queueOpen ? 'selected' : ''}`} aria-label="Fila de espera" title="Fila de requests principais" onClick={() => setQueueOpen((current) => !current)}><Icon name="clipboard" size={12}/>{queuedRequests.length > 0 && <b>{queuedRequests.length}</b>}</button>
          <button type="button" className={`composer-round-action ${todoOpen ? 'selected' : ''}`} aria-label="Tarefas TODO" title="Tarefas da iteração" disabled={!todos.length} onClick={() => setTodoOpen((current) => !current)}><Icon name="check" size={12}/>{todos.length > 0 && <b>{todos.filter((todo) => !todo.done).length}</b>}</button>
          {taskInFlight && <span className="composer-comment-state"><span className="comment-pulse"/><Icon name="chatgpt" size={12}/> Request ativa · Ctrl+Enter comenta</span>}
        </div><button className="send-button" disabled={commentBusy || (!message.trim() && !attachments.length) || Boolean(preparedAttachmentCount)} aria-label={taskInFlight ? 'Adicionar request à fila' : 'Enviar ao agente'} title={taskInFlight ? 'Adicionar à fila' : 'Enviar'}><Icon name="send" size={15}/></button></div>
        <div className="composer-hint">{taskInFlight ? 'Enter adiciona à fila · Ctrl+Enter envia comentário · Shift+Enter cria linha' : requestMode === 'plan_first' ? 'Enter inicia a próxima request · Plan first aguarda aprovação' : 'Enter inicia a próxima request · Shift+Enter cria linha'}</div>
      </div>
      </div>
    </form>

    {inspectedArtifact && <ArtifactInspector kind={inspectedArtifact} content={artifactContent?.[inspectedArtifact] || 'Conteúdo ainda não disponível para esta iteração.'} onClose={() => setInspectedArtifact('')} />}
    {inspectedChangeFile && <DiffInspector file={inspectedChangeFile} onOpenFile={onOpenFile} onClose={() => setInspectedChangeFile(undefined)} />}
  </section>
}

function QueuePanel({ requests, editingId, editingText, onEditing, onEditingText, onSave, onCancel, onMove, onRemove, onMerge, onPromote, onClose }: {
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

function TodoPanel({ todos, onClose }: { todos: Array<{ text: string; done: boolean }>; onClose: () => void }) {
  const done = todos.filter((todo) => todo.done).length
  return <section className="todo-panel" aria-label="Tarefas TODO"><header><div><strong>Tarefas</strong><span>{done}/{todos.length} concluídas</span></div><button type="button" className="icon-button light" onClick={onClose} aria-label="Fechar tarefas"><Icon name="close" size={12}/></button></header><div className="todo-progress"><i style={{ width: `${todos.length ? (done / todos.length) * 100 : 0}%` }}/></div><div className="todo-list">{todos.map((todo, index) => <div className={todo.done ? 'todo-entry done' : 'todo-entry'} key={`${todo.text}-${index}`}><span><Icon name={todo.done ? 'check' : 'plan'} size={11}/></span><p>{todo.text}</p></div>)}</div></section>
}

function ArtifactInspector({ kind, content, onClose }: { kind: ChatArtifactKind; content: string; onClose: () => void }) {
  return <div className="artifact-inspector-backdrop" data-chatgpt-overlay-blocker="true" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}><section className="artifact-inspector" role="dialog" aria-modal="true" aria-label={`Ver ${artifactLabel(kind)}`}><header><div><span>{artifactIcon(kind)}</span><div><strong>{artifactLabel(kind)}</strong><small>Conteúdo efetivamente associado à iteração atual</small></div></div><button type="button" className="icon-button light" onClick={onClose} aria-label="Fechar conteúdo"><Icon name="close" size={13}/></button></header><div className="artifact-inspector-body"><MarkdownContent markdown={content}/></div></section></div>
}

function ChatItemView({ item, copied, onCopy, onApprovePlan, onRejectPlan, onInspectArtifact, onInspectChange, onOpenFile, onRevertChange, artifactContent }: { item: ChatItem; copied: boolean; onCopy: (item: ChatItem) => Promise<void>; onApprovePlan?: (item: ChatItem) => Promise<void>; onRejectPlan?: (item: ChatItem) => void; onInspectArtifact: (kind: ChatArtifactKind) => void; onInspectChange: (file: ChatChangeFile) => void; onOpenFile?: (path: string) => void; onRevertChange?: (item: ChatItem) => Promise<void>; artifactContent?: Partial<Record<ChatArtifactKind, string>> }) {
  const source = item.source || (item.role === 'user' ? 'user' : item.turnKind ? 'chatgpt' : 'wharness')
  const presentation = item.presentation || 'message'
  const visibleText = item.role === 'harness' ? stripTodoSection(item.text) : item.text
  if (presentation === 'change' && item.change) return <ChangeSummaryCard item={item} onInspect={onInspectChange} onOpenFile={onOpenFile} onRevert={onRevertChange} />
  if (presentation === 'notice') return <div className={`chat-notice notice-${source} notice-${item.turnKind || 'status'}`}><span className="notice-mark"><Icon name={noticeIcon(item)} size={12}/></span><div className="notice-content"><div className="notice-heading"><strong>{source === 'chatgpt' ? 'ChatGPT' : 'Wharness'}</strong>{item.meta && <span>{item.meta}</span>}</div><MarkdownContent markdown={visibleText || 'Atualização da execução.'}/>{item.iteration && <IterationReference item={item} onInspectArtifact={onInspectArtifact} artifactContent={artifactContent}/>}</div></div>
  if (presentation === 'thought') return <div className="chat-thought"><span className="thought-mark"><Icon name="agent" size={13}/></span><div><strong>Raciocínio visível do ChatGPT</strong><MarkdownContent markdown={visibleText}/>{item.meta && <span>{item.meta}</span>}</div></div>

  const label = source === 'user' ? 'Você' : source === 'chatgpt' ? 'ChatGPT' : 'Wharness'
  return <article className={`message message-${source} ${presentation === 'plan' ? 'message-plan' : ''}`}>
    <div className="message-heading"><div className="message-label">{label}</div><div className="message-tools"><time dateTime={item.createdAt || ''}>{formatMessageTime(item.createdAt)}</time><button type="button" onClick={() => void onCopy(item)} title="Copiar mensagem" aria-label="Copiar mensagem"><Icon name={copied ? 'check' : 'copy'} size={12}/></button></div></div>
    <div className="message-body">{item.role === 'harness' ? <MarkdownContent markdown={visibleText || 'Atualização de tarefas.'} /> : visibleText}</div>
    {item.attachments?.length ? <div className="message-attachments">{item.attachments.map((file, index) => <MessageAttachmentCard key={file.storageRef || `${file.name}-${file.size}-${index}`} attachment={file}/>)}</div> : null}
    {item.iteration && <IterationReference item={item} onInspectArtifact={onInspectArtifact} artifactContent={artifactContent} />}
    {item.meta && <div className="message-meta">{item.meta}</div>}
    {item.approval && <div className={`plan-approval plan-${item.approval.status}`}>
      {item.approval.status === 'pending' ? <><div><Icon name="plan" size={13}/><span>Plano proposto · nenhuma alteração foi executada.</span></div><div><button type="button" className="text-button" onClick={() => onRejectPlan?.(item)}>Rejeitar</button><button type="button" className="apply-button" onClick={() => void onApprovePlan?.(item)}><Icon name="check" size={13}/> Aprovar e implementar</button></div></> : <span>{item.approval.status === 'approved' ? 'Plano aprovado para implementação.' : 'Plano rejeitado. Nenhuma alteração foi iniciada.'}</span>}
    </div>}
  </article>
}

function ChangeSummaryCard({ item, onInspect, onOpenFile, onRevert }: { item: ChatItem; onInspect: (file: ChatChangeFile) => void; onOpenFile?: (path: string) => void; onRevert?: (item: ChatItem) => Promise<void> }) {
  const change = item.change!
  const additions = change.files.reduce((total, file) => total + file.additions, 0)
  const deletions = change.files.reduce((total, file) => total + file.deletions, 0)
  return <article className="change-summary-card">
    <header><div><span className="change-summary-icon"><Icon name="apply" size={14}/></span><div><strong>{change.reverted ? 'Alterações revertidas' : 'Alterações aplicadas'}</strong><span>{change.files.length} ficheiro(s) · {formatMessageTime(change.appliedAt)}</span></div></div><code>+{additions} −{deletions}</code></header>
    <div className="change-file-list">{change.files.map((file) => <div className="change-file-row" key={file.path}><button type="button" className="change-file-name" onClick={() => onOpenFile?.(file.path)} title="Abrir no Editor"><Icon name="file" size={12}/><span>{file.path}</span></button><button type="button" className="change-file-diff" onClick={() => onInspect(file)} title="Ver diff"><b>+{file.additions}</b><i>−{file.deletions}</i></button></div>)}</div>
    <footer><span>Plano {change.planId}</span>{change.canRevert && !change.reverted && <button type="button" className="text-button change-revert" onClick={() => void onRevert?.(item)}><Icon name="refresh" size={12}/> Reverter alteração</button>}</footer>
  </article>
}

function DiffInspector({ file, onOpenFile, onClose }: { file: ChatChangeFile; onOpenFile?: (path: string) => void; onClose: () => void }) {
  return <div className="diff-inspector-backdrop" data-chatgpt-overlay-blocker="true" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}><section className="diff-inspector" role="dialog" aria-modal="true" aria-label={`Diff de ${file.path}`}><header><div><strong>{file.path}</strong><span>+{file.additions} −{file.deletions}</span></div><div><button type="button" className="text-button" onClick={() => { onOpenFile?.(file.path); onClose() }}><Icon name="file" size={12}/> Abrir no Editor</button><button type="button" className="icon-button light" onClick={onClose}><Icon name="close" size={13}/></button></div></header><pre className="diff-view change-diff-view">{file.diff}</pre></section></div>
}

function ArtifactToggle({ kind, label, selected, required = false, disabled = false, inspectable = false, onToggle, onInspect }: { kind: ChatArtifactKind; label: string; selected: boolean; required?: boolean; disabled?: boolean; inspectable?: boolean; onToggle?: (kind: ChatArtifactKind) => void; onInspect?: (kind: ChatArtifactKind) => void }) {
  const title = `${required ? `${label} · selecionado automaticamente` : `${label} · ${selected ? 'será anexado' : 'não será anexado'}`}${inspectable ? ' · clique duplo para visualizar' : ''}`
  return <button type="button" className={`composer-round-action artifact-${kind} ${selected ? 'selected' : ''} ${required ? 'automatic' : ''}`} disabled={disabled} aria-pressed={selected} aria-label={label} title={title} onDoubleClick={() => { if (inspectable) onInspect?.(kind) }} onClick={() => { if (!required) onToggle?.(kind); else if (inspectable) onInspect?.(kind) }}>
    {artifactIcon(kind)} {selected && <span className="artifact-dot"/>}
  </button>
}

function IterationReference({ item, onInspectArtifact, artifactContent }: { item: ChatItem; onInspectArtifact: (kind: ChatArtifactKind) => void; artifactContent?: Partial<Record<ChatArtifactKind, string>> }) {
  const iteration = item.iteration!
  return <div className="message-iteration" title={iteration.chatgptUrl || iteration.requestId}>
    <Icon name="bridge" size={11}/><code>{iteration.requestId.replace(/^req_/, '').slice(0, 18)}</code><span>{iterationPhaseLabel(iteration.phase)}</span>
    <span className="iteration-artifacts">{iteration.artifacts.map((kind) => <button type="button" key={kind} title={`Ver ${artifactLabel(kind)}`} aria-label={`Ver ${artifactLabel(kind)}`} disabled={!artifactContent?.[kind]} onClick={() => onInspectArtifact(kind)}>{artifactIcon(kind)}</button>)}</span>
  </div>
}

function artifactIcon(kind: ChatArtifactKind) {
  return kind === 'context' ? <Icon name="workspace" size={11}/> : kind === 'prompt' ? <Icon name="plan" size={11}/> : kind === 'result' ? <Icon name="download" size={11}/> : <Icon name="shield" size={11}/>
}
function artifactLabel(kind: ChatArtifactKind) { return kind === 'context' ? 'contexto' : kind === 'prompt' ? 'prompt' : kind === 'result' ? 'resultado' : 'erro' }
function noticeIcon(item: ChatItem) { return item.turnKind === 'blocked' ? 'shield' : item.turnKind === 'workflow' ? 'terminal' : item.turnKind === 'change' ? 'apply' : item.iteration?.phase === 'failed' ? 'shield' : 'bridge' as const }

function latestTodoSnapshot(items: ChatItem[]) {
  for (let index = items.length - 1; index >= 0; index -= 1) {
    if (items[index].role !== 'harness') continue
    const todos = extractTodo(items[index].text)
    if (todos.length) return todos
  }
  return []
}

function extractTodo(markdown: string) {
  const match = /(?:^|\n)##\s+TODO\s*\n([\s\S]*?)(?=\n##\s+|$)/i.exec(markdown || '')
  if (!match) return []
  return match[1].split('\n').map((line) => /^\s*[-*]\s+\[([ xX])\]\s+(.+?)\s*$/.exec(line)).filter((value): value is RegExpExecArray => Boolean(value)).map((value) => ({ done: value[1].toLowerCase() === 'x', text: value[2] }))
}

function stripTodoSection(markdown: string) {
  return String(markdown || '').replace(/(?:^|\n)##\s+TODO\s*\n[\s\S]*?(?=\n##\s+|$)/i, '').trim()
}

function iterationPhaseLabel(value: NonNullable<ChatItem['iteration']>['phase']) {
  if (value === 'repair') return 'correção'
  if (value === 'workflow') return 'workflow'
  if (value === 'result') return 'resultado'
  if (value === 'failed') return 'falhou'
  if (value === 'prepared') return 'preparado'
  if (value === 'submitted') return 'enviado'
  return 'pedido'
}

function formatMessageTime(value?: string) {
  const date = value ? new Date(value) : new Date()
  if (Number.isNaN(date.getTime())) return '—'
  return new Intl.DateTimeFormat('pt-PT', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }).format(date)
}
