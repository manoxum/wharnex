import { type ClipboardEvent, type FormEvent, useEffect, useRef, useState } from 'react'
import type { ChatArtifactKind, ChatArtifactSelection, ChatItem, ChatRequestMode, Session } from '../types'
import type { WorkspaceChat } from '../lib/workspaceMemory'
import { Icon } from './Icon'
import { StatusPill } from './StatusPill'
import { stateLabel } from '../lib/risk'
import { addChatAttachments } from '../lib/chatAttachments'
import { MessageAttachmentCard, ComposerAttachmentChip } from './ChatAttachmentCard'
import { MarkdownContent } from './MarkdownContent'

export function ChatPanel({ session, items, chats, archivedChats, activeChatId, busy, attachmentsEnabled, preparedAttachmentCount, artifactSelection, artifactRequired, requestMode = 'direct', taskInFlight = false, onToggleArtifact, onRequestMode, onSend, onComment, onApprovePlan, onRejectPlan, onConfirmPrepared, onDismissPrepared, onNewChat, onSelectChat, onArchiveChat, onRestoreChat, onDeleteArchivedChat }: {
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
  requestMode?: ChatRequestMode
  taskInFlight?: boolean
  onToggleArtifact?: (kind: ChatArtifactKind) => void
  onRequestMode?: (mode: ChatRequestMode) => void
  onSend: (message: string, attachments: File[], artifacts: ChatArtifactSelection, requestMode: ChatRequestMode) => Promise<void>
  onComment?: (message: string) => Promise<void>
  onApprovePlan?: (item: ChatItem) => Promise<void>
  onRejectPlan?: (item: ChatItem) => void
  onConfirmPrepared?: () => Promise<void>
  onDismissPrepared?: () => void
  onNewChat: () => Promise<void>
  onSelectChat: (chatId: string) => Promise<void>
  onArchiveChat: (chatId: string) => Promise<void>
  onRestoreChat: (chatId: string) => Promise<void>
  onDeleteArchivedChat: (chatId: string) => Promise<void>
}) {
  const [message, setMessage] = useState('')
  const [attachments, setAttachments] = useState<File[]>([])
  const [attachmentError, setAttachmentError] = useState('')
  const [copiedMessageId, setCopiedMessageId] = useState('')
  const [archiveOpen, setArchiveOpen] = useState(false)
  const [commentBusy, setCommentBusy] = useState(false)
  const selectedArtifacts: ChatArtifactSelection = artifactSelection || { context: false, prompt: true, result: false, error: false }
  const endRef = useRef<HTMLDivElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [items, busy])

  async function submit(event: FormEvent) {
    event.preventDefault()
    const text = message.trim() || (attachments.length ? 'Analise os ficheiros anexados.' : '')
    if (!text || preparedAttachmentCount || commentBusy) return
    if (taskInFlight && onComment) {
      setCommentBusy(true)
      try {
        await onComment(text)
        setMessage('')
      } finally { setCommentBusy(false) }
      return
    }
    if (busy) return
    const selected = attachments
    try {
      await onSend(text, selected, selectedArtifacts, requestMode)
      setMessage('')
      setAttachments([]); setAttachmentError('')
      if (fileInputRef.current) fileInputRef.current.value = ''
    } catch { /* parent keeps the actionable error and the draft remains intact */ }
  }

  function addFiles(files: File[]) {
    const next = addChatAttachments(attachments, files)
    setAttachments(next.files); setAttachmentError(next.error || '')
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  function pasteFiles(event: ClipboardEvent<HTMLTextAreaElement>) {
    const clipboard = event.clipboardData
    const directFiles = Array.from(clipboard.files || [])
    const itemFiles = Array.from(clipboard.items || []).flatMap((item) => item.kind === 'file' ? [item.getAsFile()] : []).filter((file): file is File => file !== null)
    const files = directFiles.length ? directFiles : itemFiles
    if (!files.length) return
    event.preventDefault()
    if (!attachmentsEnabled || taskInFlight) {
      setAttachmentError(taskInFlight ? 'Comentários da tarefa ativa são enviados como texto, sem alterar os anexos do pedido original.' : 'Colar ficheiros requer o Wharness Desktop com o planner manual.')
      return
    }
    addFiles(files)
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
      {items.map((item) => <ChatItemView key={item.id} item={item} copied={copiedMessageId === item.id} onCopy={copyMessage} onApprovePlan={onApprovePlan} onRejectPlan={onRejectPlan} />)}
      {busy && !taskInFlight && <div className="chat-thought live"><span className="thought-mark"><Icon name="agent" size={13}/></span><div><strong>Wharness</strong><div className="thinking"><span/><span/><span/> A processar o pedido</div></div></div>}
      <div ref={endRef}/>
    </div>

    {preparedAttachmentCount ? <div className="prepared-draft" role="status"><div><strong>Preparação enviada ao ChatGPT</strong><span>{preparedAttachmentCount} anexo(s) preparados. O contexto ZIP é incluído automaticamente apenas quando necessário.</span></div><div><button type="button" className="text-button" onClick={onDismissPrepared}>Já enviei</button><button type="button" className="apply-button" disabled={busy} onClick={() => void onConfirmPrepared?.()}><Icon name="send" size={14}/> Confirmar e enviar</button></div></div> : null}

    <form className={`composer ${taskInFlight ? 'comment-mode' : ''}`} onSubmit={submit}>
      {attachments.length ? <div className="composer-attachments">{attachments.map((file) => <ComposerAttachmentChip key={`${file.name}-${file.size}-${file.lastModified}`} file={file} onRemove={() => setAttachments((current) => current.filter((item) => item !== file))}/>)}</div> : null}
      {attachmentError && <div className="composer-error" role="alert">{attachmentError}</div>}
      <textarea disabled={Boolean(preparedAttachmentCount)} value={message} onChange={(event) => setMessage(event.target.value)} onPaste={pasteFiles} onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); event.currentTarget.form?.requestSubmit() } }} placeholder={taskInFlight ? 'Comentar a tarefa em curso sem interromper o entregável…' : 'Pergunte, analise, diagnostique ou descreva uma alteração…'} rows={3}/>
      <div className="composer-footer">
        <div className="composer-action-row" aria-label="Opções da próxima iteração">
          {!taskInFlight && <>
            <ArtifactToggle kind="context" label="Contexto ZIP" selected={selectedArtifacts.context} required={artifactRequired?.context} onToggle={onToggleArtifact} />
            <ArtifactToggle kind="prompt" label="Prompt" selected={selectedArtifacts.prompt} required onToggle={onToggleArtifact} />
            <ArtifactToggle kind="result" label="Resultado" selected={selectedArtifacts.result} disabled={!session.last_execution && !session.last_bundle} onToggle={onToggleArtifact} />
            <ArtifactToggle kind="error" label="Erro" selected={selectedArtifacts.error} required={artifactRequired?.error} disabled={!session.last_repair_error && session.last_execution?.success !== false && !artifactRequired?.error} onToggle={onToggleArtifact} />
            <input ref={fileInputRef} type="file" multiple hidden onChange={(event) => addFiles(Array.from(event.target.files || []))}/>
            <button type="button" className={attachments.length ? 'composer-round-action selected' : 'composer-round-action'} disabled={!attachmentsEnabled || busy || Boolean(preparedAttachmentCount)} onClick={() => fileInputRef.current?.click()} title={attachmentsEnabled ? `Ficheiros do utilizador${attachments.length ? ` · ${attachments.length} selecionado(s)` : ''}` : 'Anexos diretos requerem o Desktop com planner manual'} aria-label="Anexar ficheiros"><Icon name="file" size={12}/>{attachments.length > 0 && <b>{attachments.length}</b>}</button>
            <span className="composer-action-divider" />
            <button type="button" className={`composer-round-action plan-first ${requestMode === 'plan_first' ? 'selected' : ''}`} aria-pressed={requestMode === 'plan_first'} aria-label="Planificar antes de alterar" title={requestMode === 'plan_first' ? 'Plan first ativo · o Wharness pedirá uma proposta e aguardará aprovação' : 'Planificar antes de alterar'} onClick={() => onRequestMode?.(requestMode === 'plan_first' ? 'direct' : 'plan_first')}><Icon name="plan" size={12}/></button>
          </>}
          {taskInFlight && <span className="composer-comment-state"><span className="comment-pulse"/><Icon name="chatgpt" size={12}/> Comentário para a tarefa ativa</span>}
        </div>
        <div className="composer-submit-row"><span>{taskInFlight ? 'O comentário mantém o bundle e o request atuais' : requestMode === 'plan_first' ? 'Plan first · aguarda aprovação antes de alterar' : 'Enter envia · Shift+Enter cria linha'}</span><button className="send-button" disabled={commentBusy || (!taskInFlight && busy) || (!message.trim() && !attachments.length) || Boolean(preparedAttachmentCount)} aria-label={taskInFlight ? 'Enviar comentário à tarefa ativa' : 'Enviar ao agente'}><Icon name={taskInFlight ? 'chatgpt' : 'send'} size={15}/></button></div>
      </div>
    </form>
  </section>
}

function ChatItemView({ item, copied, onCopy, onApprovePlan, onRejectPlan }: { item: ChatItem; copied: boolean; onCopy: (item: ChatItem) => Promise<void>; onApprovePlan?: (item: ChatItem) => Promise<void>; onRejectPlan?: (item: ChatItem) => void }) {
  const source = item.source || (item.role === 'user' ? 'user' : item.turnKind ? 'chatgpt' : 'wharness')
  const presentation = item.presentation || 'message'
  if (presentation === 'notice') return <div className="chat-notice"><span className="notice-mark"><Icon name="bridge" size={12}/></span><div><strong>{source === 'chatgpt' ? 'ChatGPT' : 'Wharness'}</strong><MarkdownContent markdown={item.text}/>{item.meta && <span>{item.meta}</span>}</div>{item.iteration && <IterationReference item={item}/>}</div>
  if (presentation === 'thought') return <div className="chat-thought"><span className="thought-mark"><Icon name="agent" size={13}/></span><div><strong>Raciocínio visível do ChatGPT</strong><MarkdownContent markdown={item.text}/>{item.meta && <span>{item.meta}</span>}</div></div>

  const label = source === 'user' ? 'Você' : source === 'chatgpt' ? 'ChatGPT' : 'Wharness'
  return <article className={`message message-${source} ${presentation === 'plan' ? 'message-plan' : ''}`}>
    <div className="message-heading"><div className="message-label">{label}</div><div className="message-tools"><time dateTime={item.createdAt || ''}>{formatMessageTime(item.createdAt)}</time><button type="button" onClick={() => void onCopy(item)} title="Copiar mensagem" aria-label="Copiar mensagem"><Icon name={copied ? 'check' : 'copy'} size={12}/></button></div></div>
    <div className="message-body">{item.role === 'harness' ? <MarkdownContent markdown={item.text} /> : item.text}</div>
    {item.attachments?.length ? <div className="message-attachments">{item.attachments.map((file, index) => <MessageAttachmentCard key={file.storageRef || `${file.name}-${file.size}-${index}`} attachment={file}/>)}</div> : null}
    {item.iteration && <IterationReference item={item} />}
    {item.meta && <div className="message-meta">{item.meta}</div>}
    {item.approval && <div className={`plan-approval plan-${item.approval.status}`}>
      {item.approval.status === 'pending' ? <><div><Icon name="plan" size={13}/><span>Plano proposto · nenhuma alteração foi executada.</span></div><div><button type="button" className="text-button" onClick={() => onRejectPlan?.(item)}>Rejeitar</button><button type="button" className="apply-button" onClick={() => void onApprovePlan?.(item)}><Icon name="check" size={13}/> Aprovar e implementar</button></div></> : <span>{item.approval.status === 'approved' ? 'Plano aprovado para implementação.' : 'Plano rejeitado. Nenhuma alteração foi iniciada.'}</span>}
    </div>}
  </article>
}

function ArtifactToggle({ kind, label, selected, required = false, disabled = false, onToggle }: { kind: ChatArtifactKind; label: string; selected: boolean; required?: boolean; disabled?: boolean; onToggle?: (kind: ChatArtifactKind) => void }) {
  const title = required ? `${label} · selecionado automaticamente pelo Wharness` : `${label} · ${selected ? 'será anexado' : 'não será anexado'} na próxima iteração`
  return <button type="button" className={`composer-round-action artifact-${kind} ${selected ? 'selected' : ''} ${required ? 'automatic' : ''}`} disabled={disabled} aria-pressed={selected} aria-label={label} title={title} onClick={() => { if (!required) onToggle?.(kind) }}>
    {kind === 'context' ? <Icon name="workspace" size={12}/> : kind === 'prompt' ? <Icon name="plan" size={12}/> : kind === 'result' ? <Icon name="download" size={12}/> : <Icon name="shield" size={12}/>} {selected && <span className="artifact-dot"/>}
  </button>
}

function IterationReference({ item }: { item: ChatItem }) {
  const iteration = item.iteration!
  return <div className="message-iteration" title={iteration.chatgptUrl || iteration.requestId}>
    <Icon name="bridge" size={11}/><code>{iteration.requestId.replace(/^req_/, '').slice(0, 18)}</code><span>{iterationPhaseLabel(iteration.phase)}</span>
    <span className="iteration-artifacts">{iteration.artifacts.map((kind) => <i key={kind} title={kind}>{kind === 'context' ? <Icon name="workspace" size={9}/> : kind === 'prompt' ? <Icon name="plan" size={9}/> : kind === 'result' ? <Icon name="download" size={9}/> : <Icon name="shield" size={9}/>}</i>)}</span>
  </div>
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
