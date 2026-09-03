import { type ClipboardEvent, type FormEvent, useEffect, useRef, useState } from 'react'
import type { ChatItem, Session } from '../types'
import type { WorkspaceChat } from '../lib/workspaceMemory'
import { Icon } from './Icon'
import { StatusPill } from './StatusPill'
import { stateLabel } from '../lib/risk'
import { addChatAttachments } from '../lib/chatAttachments'
import { MessageAttachmentCard, ComposerAttachmentChip } from './ChatAttachmentCard'

export function ChatPanel({ session, items, chats, activeChatId, busy, attachmentsEnabled, preparedAttachmentCount, onSend, onConfirmPrepared, onDismissPrepared, onNewChat, onSelectChat, onDeleteChat }: {
  session: Session
  items: ChatItem[]
  chats: WorkspaceChat[]
  activeChatId: string
  busy: boolean
  attachmentsEnabled?: boolean
  preparedAttachmentCount?: number
  onSend: (message: string, attachments: File[]) => Promise<void>
  onConfirmPrepared?: () => Promise<void>
  onDismissPrepared?: () => void
  onNewChat: () => Promise<void>
  onSelectChat: (chatId: string) => Promise<void>
  onDeleteChat?: (chatId: string) => Promise<void>
}) {
  const [message, setMessage] = useState('')
  const [attachments, setAttachments] = useState<File[]>([])
  const [attachmentError, setAttachmentError] = useState('')
  const endRef = useRef<HTMLDivElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [items, busy])

  async function submit(event: FormEvent) {
    event.preventDefault()
    const text = message.trim() || (attachments.length ? 'Analise os ficheiros anexados.' : '')
    if (!text || busy || preparedAttachmentCount) return
    const selected = attachments
    try {
      await onSend(text, selected)
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

  return <section className="chat-panel">
    <header className="panel-header chat-header">
      <div><span className="panel-kicker">Harness chat</span><h2>{session.context.manifest.project_root.split('/').pop() || 'Projeto'}</h2></div>
      <StatusPill tone={session.state === 'failed' ? 'danger' : session.state === 'verified' || session.state === 'applied' ? 'success' : 'neutral'}>{stateLabel(session.state)}</StatusPill>
    </header>

    <div className="chat-switcher" aria-label="Conversas do Harness">
      <button className="chat-new-button" disabled={busy} onClick={() => void onNewChat()} title="Novo chat"><Icon name="plus" size={14}/> Novo</button>
      <div className="chat-tabs">
        {chats.map((chat) => <div key={chat.id} className={chat.id === activeChatId ? 'chat-tab-group active' : 'chat-tab-group'}>
          <button
            className={chat.id === activeChatId ? 'chat-tab active' : 'chat-tab'}
            disabled={busy}
            onClick={() => void onSelectChat(chat.id)}
            title={chat.chatgptUrl ? `${chat.title}\nChatGPT: ${chat.chatgptUrl}` : `${chat.title}\nChatGPT ainda não vinculado`}
          >
            <span>{chat.title}</span>
            <i className={chat.chatgptUrl ? 'chat-link-dot linked' : 'chat-link-dot'} aria-hidden="true" />
          </button>
          {onDeleteChat && <button
            className="chat-tab-remove"
            disabled={busy}
            onClick={() => void onDeleteChat(chat.id)}
            title={`Remover ${chat.title}`}
            aria-label={`Remover chat ${chat.title}`}
          ><Icon name="close" size={11}/></button>}
        </div>)}
      </div>
    </div>

    <div className="chat-stream">
      <div className="system-note"><Icon name="shield" size={17}/><div><strong>Contexto isolado</strong><span>{session.context.manifest.files.length} ficheiros · {session.context.manifest.sha256.slice(0, 12)}</span></div></div>
      {items.map((item) => <article key={item.id} className={`message message-${item.role}`}><div className="message-label">{item.role === 'user' ? 'Você' : 'Wharness'}</div><div className="message-body">{item.text}</div>{item.attachments?.length ? <div className="message-attachments">{item.attachments.map((file, index) => <MessageAttachmentCard key={file.storageRef || `${file.name}-${file.size}-${index}`} attachment={file}/>)}</div> : null}{item.meta && <div className="message-meta">{item.meta}</div>}</article>)}
      {busy && <article className="message message-harness"><div className="message-label">Wharness</div><div className="thinking"><span/><span/><span/> A processar o pedido</div></article>}
      <div ref={endRef}/>
    </div>

    {preparedAttachmentCount ? <div className="prepared-draft" role="status"><div><strong>Preparação enviada ao ChatGPT</strong><span>Confirme visualmente que aparecem {preparedAttachmentCount} anexo(s), incluindo o contexto ZIP.</span></div><div><button type="button" className="text-button" onClick={onDismissPrepared}>Já enviei</button><button type="button" className="apply-button" disabled={busy} onClick={() => void onConfirmPrepared?.()}><Icon name="send" size={14}/> Confirmar e enviar</button></div></div> : null}

    <form className="composer" onSubmit={submit}>
      {attachments.length ? <div className="composer-attachments">{attachments.map((file) => <ComposerAttachmentChip key={`${file.name}-${file.size}-${file.lastModified}`} file={file} onRemove={() => setAttachments((current) => current.filter((item) => item !== file))}/>)}</div> : null}
      {attachmentError && <div className="composer-error" role="alert">{attachmentError}</div>}
      <textarea disabled={Boolean(preparedAttachmentCount)} value={message} onChange={(event) => setMessage(event.target.value)} onPaste={pasteFiles} onKeyDown={(event) => {
        if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); event.currentTarget.form?.requestSubmit() }
      }} placeholder="Pergunte, analise, diagnostique ou descreva uma alteração…" rows={3}/>
      <div className="composer-footer"><div className="composer-tools"><input ref={fileInputRef} type="file" multiple hidden onChange={(event) => addFiles(Array.from(event.target.files || []))}/><button type="button" className="attach-button" disabled={!attachmentsEnabled || busy || Boolean(preparedAttachmentCount)} onClick={() => fileInputRef.current?.click()} title={attachmentsEnabled ? 'Anexar ficheiros ao ChatGPT' : 'Anexos diretos requerem o Desktop com planner manual'}><Icon name="plus" size={13}/> Anexar</button><span>Ctrl+V cola ficheiros · Enter envia</span></div><button className="send-button" disabled={busy || (!message.trim() && !attachments.length) || Boolean(preparedAttachmentCount)} aria-label="Enviar ao agente"><Icon name="send" /></button></div>
    </form>
  </section>
}
