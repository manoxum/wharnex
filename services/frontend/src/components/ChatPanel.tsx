import { type ClipboardEvent, type FormEvent, useEffect, useRef, useState } from 'react'
import type { ChatArtifactKind, ChatArtifactSelection, ChatItem, Session } from '../types'
import type { WorkspaceChat } from '../lib/workspaceMemory'
import { Icon } from './Icon'
import { StatusPill } from './StatusPill'
import { stateLabel } from '../lib/risk'
import { addChatAttachments } from '../lib/chatAttachments'
import { MessageAttachmentCard, ComposerAttachmentChip } from './ChatAttachmentCard'
import { MarkdownContent } from './MarkdownContent'

export function ChatPanel({ session, items, chats, archivedChats, activeChatId, busy, attachmentsEnabled, preparedAttachmentCount, artifactSelection, artifactRequired, onToggleArtifact, onSend, onConfirmPrepared, onDismissPrepared, onNewChat, onSelectChat, onArchiveChat, onRestoreChat, onDeleteArchivedChat }: {
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
  onToggleArtifact?: (kind: ChatArtifactKind) => void
  onSend: (message: string, attachments: File[], artifacts: ChatArtifactSelection) => Promise<void>
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
  const selectedArtifacts: ChatArtifactSelection = artifactSelection || { context: false, prompt: true, result: false, error: false }
  const endRef = useRef<HTMLDivElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [items, busy])

  async function submit(event: FormEvent) {
    event.preventDefault()
    const text = message.trim() || (attachments.length ? 'Analise os ficheiros anexados.' : '')
    if (!text || busy || preparedAttachmentCount) return
    const selected = attachments
    try {
      await onSend(text, selected, selectedArtifacts)
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
    if (!attachmentsEnabled) {
      setAttachmentError('Colar ficheiros requer o Wharness Desktop com o planner manual.')
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
      {items.map((item) => <article key={item.id} className={`message message-${item.role}`}>
        <div className="message-heading"><div className="message-label">{item.role === 'user' ? 'Você' : 'Wharness'}</div><div className="message-tools"><time dateTime={item.createdAt || ''}>{formatMessageTime(item.createdAt)}</time><button type="button" onClick={() => void copyMessage(item)} title="Copiar mensagem" aria-label="Copiar mensagem"><Icon name={copiedMessageId === item.id ? 'check' : 'copy'} size={12}/></button></div></div>
        <div className="message-body">{item.role === 'harness' ? <MarkdownContent markdown={item.text} /> : item.text}</div>
        {item.attachments?.length ? <div className="message-attachments">{item.attachments.map((file, index) => <MessageAttachmentCard key={file.storageRef || `${file.name}-${file.size}-${index}`} attachment={file}/>)}</div> : null}
        {item.iteration && <IterationReference item={item} />}
        {item.meta && <div className="message-meta">{item.meta}</div>}
      </article>)}
      {busy && <article className="message message-harness"><div className="message-heading"><div className="message-label">Wharness</div><div className="message-tools"><time>{formatMessageTime(new Date().toISOString())}</time></div></div><div className="thinking"><span/><span/><span/> A processar o pedido</div></article>}
      <div ref={endRef}/>
    </div>

    {preparedAttachmentCount ? <div className="prepared-draft" role="status"><div><strong>Preparação enviada ao ChatGPT</strong><span>{preparedAttachmentCount} anexo(s) preparados. O contexto ZIP é incluído automaticamente apenas quando necessário.</span></div><div><button type="button" className="text-button" onClick={onDismissPrepared}>Já enviei</button><button type="button" className="apply-button" disabled={busy} onClick={() => void onConfirmPrepared?.()}><Icon name="send" size={14}/> Confirmar e enviar</button></div></div> : null}

    <form className="composer" onSubmit={submit}>
      {attachments.length ? <div className="composer-attachments">{attachments.map((file) => <ComposerAttachmentChip key={`${file.name}-${file.size}-${file.lastModified}`} file={file} onRemove={() => setAttachments((current) => current.filter((item) => item !== file))}/>)}</div> : null}
      {attachmentError && <div className="composer-error" role="alert">{attachmentError}</div>}
      <div className="composer-artifact-strip" aria-label="Artefactos da próxima iteração">
        <span className="composer-artifact-label">Próxima iteração</span>
        <ArtifactToggle kind="context" label="Contexto ZIP" selected={selectedArtifacts.context} required={artifactRequired?.context} onToggle={onToggleArtifact} />
        <ArtifactToggle kind="prompt" label="Prompt" selected={selectedArtifacts.prompt} required onToggle={onToggleArtifact} />
        <ArtifactToggle kind="result" label="Resultado" selected={selectedArtifacts.result} disabled={!session.last_execution && !session.last_bundle} onToggle={onToggleArtifact} />
        <ArtifactToggle kind="error" label="Erro" selected={selectedArtifacts.error} required={artifactRequired?.error} disabled={!session.last_repair_error && session.last_execution?.success !== false && !artifactRequired?.error} onToggle={onToggleArtifact} />
        <input ref={fileInputRef} type="file" multiple hidden onChange={(event) => addFiles(Array.from(event.target.files || []))}/>
        <button type="button" className={attachments.length ? 'composer-artifact-button selected' : 'composer-artifact-button'} disabled={!attachmentsEnabled || busy || Boolean(preparedAttachmentCount)} onClick={() => fileInputRef.current?.click()} title={attachmentsEnabled ? `Ficheiros do utilizador${attachments.length ? ` · ${attachments.length} selecionado(s)` : ''}` : 'Anexos diretos requerem o Desktop com planner manual'} aria-label="Anexar ficheiros"><Icon name="file" size={14}/>{attachments.length > 0 && <b>{attachments.length}</b>}</button>
      </div>
      <textarea disabled={Boolean(preparedAttachmentCount)} value={message} onChange={(event) => setMessage(event.target.value)} onPaste={pasteFiles} onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); event.currentTarget.form?.requestSubmit() } }} placeholder="Pergunte, analise, diagnostique ou descreva uma alteração…" rows={3}/>
      <div className="composer-footer"><div className="composer-tools"><span>Ctrl+V cola ficheiros · Enter envia</span></div><button className="send-button" disabled={busy || (!message.trim() && !attachments.length) || Boolean(preparedAttachmentCount)} aria-label="Enviar ao agente"><Icon name="send" /></button></div>
    </form>
  </section>
}

function ArtifactToggle({ kind, label, selected, required = false, disabled = false, onToggle }: { kind: ChatArtifactKind; label: string; selected: boolean; required?: boolean; disabled?: boolean; onToggle?: (kind: ChatArtifactKind) => void }) {
  const title = required ? `${label} · selecionado automaticamente pelo Wharness` : `${label} · ${selected ? 'será anexado' : 'não será anexado'} na próxima iteração`
  return <button type="button" className={`composer-artifact-button ${selected ? 'selected' : ''} ${required ? 'automatic' : ''}`} disabled={disabled} aria-pressed={selected} aria-label={label} title={title} onClick={() => { if (!required) onToggle?.(kind) }}>
    {kind === 'context' ? <Icon name="workspace" size={14}/> : kind === 'prompt' ? <Icon name="plan" size={14}/> : kind === 'result' ? <Icon name="download" size={14}/> : <Icon name="shield" size={14}/>}
    {selected && <span className="artifact-check"><Icon name="check" size={8}/></span>}
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
