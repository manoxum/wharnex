import { Fragment, type ClipboardEvent, type FormEvent, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent, useEffect, useMemo, useRef, useState } from 'react'
import type { AutomationMode, ChatArtifactKind, ChatArtifactSelection, ChatChangeFile, ChatItem, ChatRequestMode, ChatTransportMode, ExecutionMode, QueuedChatRequest, Session } from '../types'
import { clearComposerDraft, loadComposerDraft, loadComposerFileDraft, saveComposerDraft, saveComposerFileDraft, type TransportOptions, type WorkspaceChat } from '../lib/workspaceMemory'
import { Icon } from './Icon'
import { StatusPill } from './StatusPill'
import { stateLabel } from '../lib/risk'
import { addChatAttachments, uniquifyPastedChatFiles } from '../lib/chatAttachments'
import { MessageAttachmentCard, ComposerAttachmentChip } from './ChatAttachmentCard'
import { MarkdownContent } from './MarkdownContent'
import { fileReferenceQuery, matchingProjectFiles } from '../lib/projectFileReferences'
import { ChangeDiffEditor } from './ChangeDiffEditor'
import { BundleExchangeBar, ChatArtifactLibrary, ReturnedArtifactGallery } from './BundleExplorer'
import { useProgressiveChatHistory, type ChatViewportStore } from './useProgressiveChatHistory'
import { promptDialog } from '../lib/appDialog'
import { activePendingRequestId } from '../lib/pendingRequest'

const COMPOSER_MIN_HEIGHT = 118
const COMPOSER_MAX_HEIGHT = 420
const LONG_CHAT_MARKDOWN_CHARS = 1400
const LONG_CHAT_MARKDOWN_LINES = 18
const CHANGE_DIFF_PREVIEW_COUNT = 4

function clampComposerHeight(height: number) {
  return Math.min(COMPOSER_MAX_HEIGHT, Math.max(COMPOSER_MIN_HEIGHT, Math.round(height)))
}

function chatItemSource(item: ChatItem) {
  return item.source || (item.role === 'user' ? 'user' : item.turnKind ? 'chatgpt' : 'wharness')
}

function isWhxNotice(item: ChatItem) {
  return (item.presentation || 'message') === 'notice' && chatItemSource(item) === 'wharness'
}

function indexWhxNoticeRuns(items: ChatItem[]) {
  const hiddenIds = new Set<string>()
  const previousByLatestId = new Map<string, ChatItem[]>()
  let run: ChatItem[] = []
  const flush = () => {
    if (run.length > 1) {
      const previous = run.slice(0, -1)
      previous.forEach((item) => hiddenIds.add(item.id))
      previousByLatestId.set(run[run.length - 1].id, previous)
    }
    run = []
  }
  for (const item of items) {
    if (isWhxNotice(item)) run.push(item)
    else { flush() }
  }
  flush()
  return { hiddenIds, previousByLatestId }
}

function isNormativeChangePath(path: string) {
  const normalized = path.replace(/^\.\//, '')
  return normalized === 'AGENTS.md' || normalized.startsWith('SoT/')
}

function prioritizedChangeFiles(files: ChatChangeFile[]) {
  return files.map((file, index) => ({ file, index }))
    .sort((left, right) => Number(isNormativeChangePath(right.file.path)) - Number(isNormativeChangePath(left.file.path)) || left.index - right.index)
    .map(({ file }) => file)
}

export function ChatPanel({ session, items, chats, archivedChats, activeChatId, busy, embedded = false, hideSwitcher = false, historyViewportStore, executionMode, automationMode, chatTransportMode, attachmentsEnabled, preparedAttachmentCount, failedPromptDelivery, artifactSelection, artifactRequired, artifactContent, requestMode = 'direct', globalTransport = { disabledTunnelIds: [] }, chatTransport, tunnelInstances = [], taskInFlight = false, queuedRequests = [], transportProgress = '', onExecutionMode, onAutomationMode, onChatTransportMode, onKnowledgeSharing, onToggleArtifact, onRequestMode, onChatTransport, onSend, onComment, onQueueEdit, onQueueMove, onQueueRemove, onQueueMerge, onQueuePromote, onApprovePlan, onRejectPlan, onConfirmPrepared, onDismissPrepared, onRetryPreparedDelivery, onOpenFile, onRevertChange, onReprocessPolicyBlock, canReprocessPolicyBlock = false, onRepairWithGPT, canRepairWithGPT = false, onRetryDependencyNetwork, canRetryDependencyNetwork = false, onRetryTransportFailure, onResendPendingRequest, onCancelPendingRequest, onExportChat, onNewChat, onSelectChat, onArchiveChat, onRestoreChat, onDeleteArchivedChat }: {
  session: Session
  items: ChatItem[]
  chats: WorkspaceChat[]
  archivedChats: WorkspaceChat[]
  activeChatId: string
  busy: boolean
  embedded?: boolean
  hideSwitcher?: boolean
  historyViewportStore?: ChatViewportStore
  executionMode?: ExecutionMode
  automationMode?: AutomationMode
  chatTransportMode?: ChatTransportMode
  attachmentsEnabled?: boolean
  preparedAttachmentCount?: number
  failedPromptDelivery?: { kind: 'retry' | 'attention' | 'storage'; requestId: string }
  artifactSelection?: ChatArtifactSelection
  artifactRequired?: Partial<Record<ChatArtifactKind, boolean>>
  artifactContent?: Partial<Record<ChatArtifactKind, string>>
  requestMode?: ChatRequestMode
  globalTransport?: TransportOptions
  chatTransport?: TransportOptions
  tunnelInstances?: Array<{ id: string; provider: string; available: boolean; error?: string }>
  taskInFlight?: boolean
  queuedRequests?: QueuedChatRequest[]
  transportProgress?: string
  onExecutionMode?: (mode: ExecutionMode) => void
  onAutomationMode?: (mode: AutomationMode) => void
  onChatTransportMode?: (mode: ChatTransportMode) => void
  onKnowledgeSharing?: (enabled: boolean) => void
  onToggleArtifact?: (kind: ChatArtifactKind) => void
  onRequestMode?: (mode: ChatRequestMode) => void
  onChatTransport?: (transport?: TransportOptions) => void
  onSend: (message: string, attachments: File[], projectFiles: string[], artifacts: ChatArtifactSelection, requestMode: ChatRequestMode) => Promise<void>
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
  onRetryPreparedDelivery?: (requestId?: string) => Promise<void>
  onOpenFile?: (path: string) => void
  onRevertChange?: (item: ChatItem) => Promise<void>
  onReprocessPolicyBlock?: () => Promise<void>
	 canReprocessPolicyBlock?: boolean
	 onRepairWithGPT?: (detail: string) => Promise<void>
	 canRepairWithGPT?: boolean
	 onRetryDependencyNetwork?: () => Promise<void>
	 canRetryDependencyNetwork?: boolean
	 onRetryTransportFailure?: (requestId: string) => Promise<void>
	 onResendPendingRequest?: (requestId: string) => Promise<void>
	 onCancelPendingRequest?: (requestId: string) => Promise<void>
  onExportChat?: () => Promise<void>
  onNewChat: () => Promise<void>
  onSelectChat: (chatId: string) => Promise<void>
  onArchiveChat: (chatId: string) => Promise<void>
  onRestoreChat: (chatId: string) => Promise<void>
  onDeleteArchivedChat: (chatId: string) => Promise<void>
  onRenameChat?: (chatId: string, title: string) => Promise<void>
  onGenerateChatTitle?: (chatId: string) => Promise<void>
}) {
  const initialDraft = loadComposerDraft(session.project_path, activeChatId)
  const initialFileDraft = loadComposerFileDraft(session.project_path, activeChatId)
  const [message, setMessage] = useState(initialDraft.message)
  const [composerHeight, setComposerHeight] = useState(initialDraft.height)
  const [attachments, setAttachments] = useState<File[]>(initialFileDraft.attachments)
  const [attachmentError, setAttachmentError] = useState('')
  const [projectFiles, setProjectFiles] = useState<string[]>(initialFileDraft.projectFiles)
  const [fileQuery, setFileQuery] = useState<{ start: number; end: number; query: string }>()
  const [copiedMessageId, setCopiedMessageId] = useState('')
  const [archiveOpen, setArchiveOpen] = useState(false)
  const [contentView, setContentView] = useState<'conversation' | 'files'>('conversation')
  const [commentBusy, setCommentBusy] = useState(false)
  const [queueOpen, setQueueOpen] = useState(false)
  const [editingQueueId, setEditingQueueId] = useState('')
  const [editingQueueText, setEditingQueueText] = useState('')
  const [todoOpen, setTodoOpen] = useState(false)
  const [contextChannelOpen, setContextChannelOpen] = useState(false)
  const [expandedWhxNoticeRunId, setExpandedWhxNoticeRunId] = useState('')
  const [inspectedArtifact, setInspectedArtifact] = useState<ChatArtifactKind | ''>('')
  const [inspectedChangeFile, setInspectedChangeFile] = useState<ChatChangeFile>()
  const selectedArtifacts: ChatArtifactSelection = artifactSelection || { context: false, prompt: true, result: false, error: false }
  const currentExecutionMode = executionMode || session.execution_mode || 'protected'
  const currentAutomationMode = automationMode || session.automation_mode || 'manual'
  const currentChatTransportMode = chatTransportMode || session.chat_transport_mode || 'scraper'
  const knowledgeSharingEnabled = session.knowledge_sharing_enabled !== false
  const effectiveTransport = chatTransport || globalTransport
  const composerRef = useRef<HTMLFormElement>(null)
  const composerResizeRef = useRef<{ pointerId: number; startY: number; startHeight: number } | null>(null)
  const copiedResetTimerRef = useRef<number | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const todos = useMemo(() => latestTodoSnapshot(items), [items])
  const { endRef, hasOlder, hiddenItemCount, loadOlder, onScroll: onHistoryScroll, streamRef, visibleItems } = useProgressiveChatHistory(items, activeChatId, busy, historyViewportStore)
  const whxNoticeRuns = useMemo(() => indexWhxNoticeRuns(visibleItems), [visibleItems])
  const eligibleProjectFiles = useMemo(() => session.context.manifest.files.map((file) => file.path).filter((path) => path !== 'EXPORTS.md'), [session.context.manifest.files])
  const fileSuggestions = useMemo(() => fileQuery ? matchingProjectFiles(eligibleProjectFiles, fileQuery.query, projectFiles) : [], [eligibleProjectFiles, fileQuery, projectFiles])
  useEffect(() => { if (queuedRequests.length) setQueueOpen(true) }, [queuedRequests.length])
  useEffect(() => {
    const draft = loadComposerDraft(session.project_path, activeChatId)
    const fileDraft = loadComposerFileDraft(session.project_path, activeChatId)
    setMessage(draft.message); setComposerHeight(draft.height); setAttachments(fileDraft.attachments); setProjectFiles(fileDraft.projectFiles); setAttachmentError(''); setContentView('conversation'); setExpandedWhxNoticeRunId('')
  }, [session.project_path, activeChatId])
  useEffect(() => { saveComposerDraft(session.project_path, activeChatId, { message, height: composerHeight }) }, [session.project_path, activeChatId, message, composerHeight])
  useEffect(() => { saveComposerFileDraft(session.project_path, activeChatId, { attachments, projectFiles }) }, [session.project_path, activeChatId, attachments, projectFiles])
  useEffect(() => () => {
    if (copiedResetTimerRef.current !== null) window.clearTimeout(copiedResetTimerRef.current)
  }, [])
  useEffect(() => {
    const textarea = textareaRef.current
    const composer = composerRef.current
    if (!textarea || !composer) return
    textarea.style.height = 'auto'
    textarea.style.height = `${Math.max(76, textarea.scrollHeight)}px`

    const scrollArea = composer.querySelector<HTMLElement>('.composer-scroll-area')
    const footer = composer.querySelector<HTMLElement>('.composer-footer')
    if (!scrollArea || !footer) return
    const borderBox = Math.max(0, composer.offsetHeight - composer.clientHeight)
    const contentHeight = scrollArea.scrollHeight + footer.offsetHeight + borderBox
    const boundedHeight = clampComposerHeight(Math.ceil(contentHeight))
    setComposerHeight((current) => Math.max(current, boundedHeight))
  }, [message, attachments.length, projectFiles.length, attachmentError])
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
    setProjectFiles([])
    setFileQuery(undefined)
    setAttachmentError('')
    clearComposerDraft(session.project_path, activeChatId)
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  async function submitMain(event?: FormEvent) {
    event?.preventDefault()
    const text = message.trim() || (attachments.length ? 'Analise os ficheiros anexados.' : '')
    if (!text || preparedAttachmentCount || commentBusy) return
    const selected = attachments
    const selectedProjectFiles = projectFiles
    clearComposer()
    try { await onSend(text, selected, selectedProjectFiles, selectedArtifacts, requestMode) } catch { /* parent reports the actionable error */ }
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

  function updateMessage(value: string, caret: number) {
    setMessage(value)
    setFileQuery(fileReferenceQuery(value, caret))
  }

  function startComposerResize(event: ReactPointerEvent<HTMLDivElement>) {
    if (event.button !== 0) return
    const composer = composerRef.current
    if (!composer) return
    composerResizeRef.current = {
      pointerId: event.pointerId,
      startY: event.clientY,
      startHeight: composer.getBoundingClientRect().height || composerHeight,
    }
    event.currentTarget.setPointerCapture?.(event.pointerId)
    event.preventDefault()
  }

  function moveComposerResize(event: ReactPointerEvent<HTMLDivElement>) {
    const resize = composerResizeRef.current
    if (!resize || resize.pointerId !== event.pointerId) return
    setComposerHeight(clampComposerHeight(resize.startHeight + resize.startY - event.clientY))
    event.preventDefault()
  }

  function stopComposerResize(event: ReactPointerEvent<HTMLDivElement>) {
    const resize = composerResizeRef.current
    if (!resize || resize.pointerId !== event.pointerId) return
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
    composerResizeRef.current = null
  }

  function resizeComposerFromKeyboard(event: ReactKeyboardEvent<HTMLDivElement>) {
    if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return
    event.preventDefault()
    setComposerHeight((current) => clampComposerHeight(current + (event.key === 'ArrowUp' ? 24 : -24)))
  }

  function selectProjectFile(path: string) {
    if (!fileQuery) return
    setMessage((current) => `${current.slice(0, fileQuery.start)}${current.slice(fileQuery.end)}`)
    setProjectFiles((current) => [...new Set([...current, path])])
    setFileQuery(undefined)
    window.setTimeout(() => textareaRef.current?.focus(), 0)
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
    if (copiedResetTimerRef.current !== null) window.clearTimeout(copiedResetTimerRef.current)
    copiedResetTimerRef.current = window.setTimeout(() => {
      setCopiedMessageId((current) => current === item.id ? '' : current)
      copiedResetTimerRef.current = null
    }, 1400)
  }

  const latestFailureNoticeId = [...items].reverse().find(isFailureNotice)?.id
  const renderChatEntry = (item: ChatItem) => <Fragment key={item.id}>
    <ChatItemView item={item} copied={copiedMessageId === item.id} onCopy={copyMessage} onApprovePlan={onApprovePlan} onRejectPlan={onRejectPlan} onInspectArtifact={setInspectedArtifact} onInspectChange={setInspectedChangeFile} onOpenFile={onOpenFile} onRevertChange={onRevertChange} onReprocessPolicyBlock={onReprocessPolicyBlock} canReprocessPolicyBlock={canReprocessPolicyBlock} onRepairWithGPT={onRepairWithGPT} canRepairWithGPT={canRepairWithGPT && item.id === latestFailureNoticeId} onRetryDependencyNetwork={onRetryDependencyNetwork} canRetryDependencyNetwork={canRetryDependencyNetwork && item.id === latestFailureNoticeId} onRetryTransportFailure={onRetryTransportFailure} onResendPendingRequest={item.iteration && isLivePendingRequest(session, item.iteration.requestId) && canResendPreparedRequest(item) ? onResendPendingRequest : undefined} onCancelPendingRequest={item.iteration && isLivePendingRequest(session, item.iteration.requestId) ? onCancelPendingRequest : undefined} busy={busy} taskInFlight={taskInFlight} artifactContent={artifactContent} />
    {item.iteration?.phase === 'result' && item.turnKind !== 'workflow' && <ReturnedArtifactGallery sessionId={session.id} artifacts={session.artifacts} requestId={item.iteration.requestId}/>}
  </Fragment>

  return <section className={`chat-panel ${embedded ? 'embedded' : ''}`}>
    <header className={`panel-header chat-header ${embedded ? 'embedded' : ''}`}>
      <div className="chat-header-context" aria-label="Contexto isolado">
        <span className="chat-header-context-icon"><Icon name="shield" size={13}/></span>
        <span><strong>Contexto isolado</strong><small>{session.context.manifest.files.length} ficheiros · {session.context.manifest.sha256.slice(0, 12)}</small></span>
      </div>
      <BundleExchangeBar sessionId={session.id} artifacts={session.artifacts} requestLineages={session.request_lineages} />
      <div className="chat-header-actions">
        <StatusPill tone={session.state === 'failed' ? 'danger' : session.state === 'verified' || session.state === 'applied' ? 'success' : 'neutral'}>{stateLabel(session.state)}</StatusPill>
        {onExportChat && <button type="button" className="chat-export-button" disabled={busy} onClick={() => void onExportChat()} aria-label="Exportar ZIP" title="Exportar chat completo, execuções e bundles em ZIP"><Icon name="download" size={13}/></button>}
      </div>
    </header>

    {!hideSwitcher && <div className="chat-switcher" aria-label="Conversas do Harness">
      <button className="chat-new-button" disabled={busy} onClick={() => void onNewChat()} title="Novo chat" aria-label="Novo chat"><Icon name="plus" size={14}/></button>
      <div className="chat-tabs">
        {chats.map((chat) => <div key={chat.id} className={chat.id === activeChatId ? 'chat-tab-group active' : 'chat-tab-group'}>
          <button className={chat.id === activeChatId ? 'chat-tab active' : 'chat-tab'} disabled={busy} onClick={() => void onSelectChat(chat.id)} title={chat.chatgptUrl ? `${chat.title}\nChatGPT: ${chat.chatgptUrl}` : `${chat.title}\nChatGPT ainda não vinculado`}>
            <span>{chat.title}</span><i className={chat.chatgptUrl ? 'chat-link-dot linked' : 'chat-link-dot'} aria-hidden="true" />
          </button>
          <button className="chat-tab-remove" disabled={busy} onClick={() => void onArchiveChat(chat.id)} title={`Fechar e arquivar ${chat.title}`} aria-label={`Fechar e arquivar chat ${chat.title}`}><Icon name="close" size={11}/></button>
        </div>)}
      </div>
      {!embedded && <button className={archiveOpen ? 'chat-archive-toggle active' : 'chat-archive-toggle'} disabled={busy && !archiveOpen} onClick={() => setArchiveOpen((current) => !current)} title="Chats fechados"><Icon name="folder" size={13}/><span>Arquivados</span>{archivedChats.length > 0 && <b>{archivedChats.length}</b>}</button>}
    </div>}


    {!embedded && archiveOpen && <div className="chat-archive-panel">
      <div className="chat-archive-heading"><div><strong>Chats arquivados</strong><span>Fechar um chat preserva o histórico, o vínculo ChatGPT e os anexos locais.</span></div><button className="icon-button light" onClick={() => setArchiveOpen(false)} title="Fechar área de arquivados"><Icon name="close" size={13}/></button></div>
      {archivedChats.length ? <div className="chat-archive-list">{archivedChats.map((chat) => <div className="chat-archive-row" key={chat.id}>
        <div className="chat-archive-copy"><strong>{chat.title}</strong><span>{chat.chatgptUrl ? 'ChatGPT vinculado' : 'Sem vínculo ChatGPT'} · fechado em {formatMessageTime(chat.updatedAt)}</span></div>
        <div className="chat-archive-actions"><button className="text-button" disabled={busy} onClick={() => void onRestoreChat(chat.id)}><Icon name="refresh" size={12}/> Reabrir</button><button className="archive-delete-button" disabled={busy} onClick={() => void onDeleteArchivedChat(chat.id)} title="Eliminar definitivamente"><Icon name="trash" size={13}/></button></div>
      </div>)}</div> : <div className="chat-archive-empty">Nenhum chat fechado.</div>}
    </div>}

    <div className="chat-content-tabs" role="tablist" aria-label="Conteúdo do chat">
      <button type="button" role="tab" aria-selected={contentView === 'conversation'} className={contentView === 'conversation' ? 'active' : ''} onClick={() => setContentView('conversation')}><Icon name="chatgpt" size={12}/> Conversa</button>
      <button type="button" role="tab" aria-selected={contentView === 'files'} className={contentView === 'files' ? 'active' : ''} onClick={() => setContentView('files')}><Icon name="folder" size={12}/> Ficheiros</button>
    </div>

    {contentView === 'conversation' ? <div ref={streamRef} className="chat-stream" onScroll={onHistoryScroll}>
      {hasOlder && <div className="chat-history-loader"><span><Icon name="arrow-up" size={12}/> {hiddenItemCount} mensagem(ns) anterior(es)</span><button type="button" onClick={loadOlder}>Carregar anteriores</button></div>}
      {visibleItems.map((item) => {
        const previousNotices = whxNoticeRuns.previousByLatestId.get(item.id) || []
        if (whxNoticeRuns.hiddenIds.has(item.id)) return null
        const runExpanded = previousNotices.length > 0 && expandedWhxNoticeRunId === item.id
        return <Fragment key={item.id}>
          {previousNotices.length > 0 && <div className="whx-notice-run">
            <button type="button" className="whx-notice-stack-toggle" aria-expanded={runExpanded} aria-label={runExpanded ? 'Ocultar notificações WHX anteriores' : `Mostrar ${previousNotices.length} notificações WHX anteriores`} onClick={() => setExpandedWhxNoticeRunId((current) => current === item.id ? '' : item.id)}>
              <span aria-hidden="true">···</span><small>{runExpanded ? 'ocultar anteriores' : `${previousNotices.length} anterior${previousNotices.length === 1 ? '' : 'es'}`}</small>
            </button>
            {runExpanded && <div className="whx-notice-run-history">{previousNotices.map(renderChatEntry)}</div>}
          </div>}
          {renderChatEntry(item)}
        </Fragment>
      })}
      {busy && !taskInFlight && <div className="chat-thought live"><span className="thought-mark"><Icon name="agent" size={13}/></span><div><strong>Wharness</strong><div className="thinking"><span/><span/><span/> A processar o pedido</div></div></div>}
      <div ref={endRef}/>
    </div> : <ChatArtifactLibrary sessionId={session.id} artifacts={session.artifacts} requestLineages={session.request_lineages}/>}

    {failedPromptDelivery ? <div className="prepared-draft" role="status"><div><strong>{failedPromptDelivery.kind === 'storage' ? 'Armazenamento local sem espaço' : failedPromptDelivery.kind === 'attention' ? 'Ação necessária no ChatGPT' : 'Entrega ao ChatGPT pendente'}</strong><span>{failedPromptDelivery.kind === 'storage' ? 'O bundle foi preservado, mas o backend não consegue guardá-lo. Liberte espaço no disco e tente a ingestão novamente.' : failedPromptDelivery.kind === 'attention' ? 'A página abriu, mas o campo de escrita ainda não está disponível. Verifique login, verificação anti-robô ou avisos na aba ChatGPT.' : 'O mesmo prompt, contexto e anexos continuam disponíveis para uma nova tentativa.'}</span></div><button type="button" className="apply-button" disabled={busy} onClick={() => void onRetryPreparedDelivery?.(failedPromptDelivery.requestId)}><Icon name="refresh" size={14}/> {failedPromptDelivery.kind === 'storage' ? 'Tentar após liberar espaço' : failedPromptDelivery.kind === 'attention' ? 'Tentar depois de resolver' : 'Tentar entregar novamente'}</button></div> : null}
    {preparedAttachmentCount ? <div className="prepared-draft" role="status"><div><strong>Preparação enviada ao ChatGPT</strong><span>{preparedAttachmentCount} item(ns) de entrada preparados. O contexto é incluído automaticamente apenas quando necessário.</span></div><div><button type="button" className="text-button" onClick={onDismissPrepared}>Já enviei</button><button type="button" className="apply-button" disabled={busy} onClick={() => void onConfirmPrepared?.()}><Icon name="send" size={14}/> Confirmar e enviar</button></div></div> : null}

    {queueOpen && queuedRequests.length > 0 && <QueuePanel requests={queuedRequests} editingId={editingQueueId} editingText={editingQueueText} onEditing={(id, text) => { setEditingQueueId(id); setEditingQueueText(text) }} onEditingText={setEditingQueueText} onSave={() => { if (editingQueueId && editingQueueText.trim()) onQueueEdit?.(editingQueueId, editingQueueText.trim()); setEditingQueueId('') }} onCancel={() => setEditingQueueId('')} onMove={onQueueMove} onRemove={onQueueRemove} onMerge={onQueueMerge} onPromote={onQueuePromote} onClose={() => setQueueOpen(false)} />}
    {todoOpen && todos.length > 0 && <TodoPanel todos={todos} onClose={() => setTodoOpen(false)} />}

    {transportProgress && <div className="context-publication-progress" role="status"><span className="publication-orbit"><i/><i/><i/></span><div><strong>A preparar rotas remotas</strong><small>{transportProgress}</small></div></div>}

    <form ref={composerRef} className={`composer ${taskInFlight ? 'comment-mode' : ''}`} style={{ height: composerHeight }} onSubmit={submitMain}>
      <div
        className="composer-resize-handle"
        role="separator"
        aria-orientation="horizontal"
        aria-label="Redimensionar altura do chat composer"
        aria-valuemin={COMPOSER_MIN_HEIGHT}
        aria-valuemax={COMPOSER_MAX_HEIGHT}
        aria-valuenow={composerHeight}
        tabIndex={0}
        onPointerDown={startComposerResize}
        onPointerMove={moveComposerResize}
        onPointerUp={stopComposerResize}
        onPointerCancel={stopComposerResize}
        onKeyDown={resizeComposerFromKeyboard}
      />
      <div className="composer-scroll-area">
      {attachments.length ? <div className="composer-attachments">{attachments.map((file) => <ComposerAttachmentChip key={`${file.name}-${file.size}-${file.lastModified}`} file={file} onRemove={() => setAttachments((current) => current.filter((item) => item !== file))}/>)}</div> : null}
      {projectFiles.length ? <div className="composer-file-references" aria-label="Ficheiros do projeto referenciados">{projectFiles.map((path) => <span className="composer-file-reference-chip" key={path}><Icon name="file" size={11}/><b>{path}</b><button type="button" onClick={() => setProjectFiles((current) => current.filter((item) => item !== path))} aria-label={`Remover referência ${path}`}><Icon name="close" size={9}/></button></span>)}</div> : null}
      {attachmentError && <div className="composer-error" role="alert">{attachmentError}</div>}
      <div className="composer-editor-shell"><textarea ref={textareaRef} lang="pt-PT" spellCheck autoCorrect="on" autoCapitalize="sentences" disabled={Boolean(preparedAttachmentCount)} value={message} onChange={(event) => updateMessage(event.target.value, event.target.selectionStart)} onClick={(event) => setFileQuery(fileReferenceQuery(event.currentTarget.value, event.currentTarget.selectionStart))} onPaste={pasteFiles} onKeyDown={(event) => {
        if (fileSuggestions.length && event.key === 'Escape') { event.preventDefault(); setFileQuery(undefined); return }
        if (fileSuggestions.length && (event.key === 'Enter' || event.key === 'Tab')) { event.preventDefault(); selectProjectFile(fileSuggestions[0]); return }
        if (event.key !== 'Enter' || event.shiftKey) return
        event.preventDefault()
        if ((event.ctrlKey || event.metaKey) && taskInFlight) void submitComment()
        else event.currentTarget.form?.requestSubmit()
      }} placeholder="Pergunte, analise, diagnostique ou descreva uma alteração…" rows={3}/>{fileQuery && <div className="file-reference-menu" role="listbox" aria-label="Localizar ficheiro do projeto" data-chatgpt-overlay-blocker="true"><header><span>@file</span><small>{fileSuggestions.length ? 'Escolha um ficheiro do contexto' : 'Nenhum ficheiro elegível encontrado'}</small></header>{fileSuggestions.map((path, index) => <button type="button" role="option" aria-selected={index === 0} key={path} onMouseDown={(event) => event.preventDefault()} onClick={() => selectProjectFile(path)}><Icon name="file" size={12}/><span>{path}</span>{index === 0 && <kbd>Enter</kbd>}</button>)}</div>}</div>
      </div>
      <div className="composer-footer">
        <div className="composer-toolbar-row"><div className="composer-action-row" aria-label="Opções da próxima iteração">
          <ArtifactToggle kind="context" label="Contexto ZIP" selected={selectedArtifacts.context} required={artifactRequired?.context} onToggle={onToggleArtifact} onInspect={setInspectedArtifact} inspectable={Boolean(artifactContent?.context)} />
          <ArtifactToggle kind="prompt" label="Prompt" selected={selectedArtifacts.prompt} required onToggle={onToggleArtifact} onInspect={setInspectedArtifact} inspectable={Boolean(artifactContent?.prompt)} />
          <ArtifactToggle kind="result" label="Resultado" selected={selectedArtifacts.result} disabled={!session.last_execution && !session.last_bundle} onToggle={onToggleArtifact} onInspect={setInspectedArtifact} inspectable={Boolean(artifactContent?.result)} />
          <ArtifactToggle kind="error" label="Erro" selected={selectedArtifacts.error} required={artifactRequired?.error} disabled={!session.last_repair_error && session.last_execution?.success !== false && !artifactRequired?.error} onToggle={onToggleArtifact} onInspect={setInspectedArtifact} inspectable={Boolean(artifactContent?.error)} />
          <input ref={fileInputRef} type="file" multiple hidden onChange={(event) => addFiles(Array.from(event.target.files || []))}/>
          <button type="button" className={attachments.length ? 'composer-round-action selected' : 'composer-round-action'} disabled={!attachmentsEnabled || Boolean(preparedAttachmentCount)} onClick={() => fileInputRef.current?.click()} title={attachmentsEnabled ? `Ficheiros do utilizador${attachments.length ? ` · ${attachments.length} selecionado(s)` : ''}` : 'Anexos diretos requerem o Desktop com planner manual'} aria-label="Anexar ficheiros"><Icon name="file" size={12}/>{attachments.length > 0 && <b>{attachments.length}</b>}</button>
          <span className="composer-action-divider" />
          <span className="context-channel-picker"><button type="button" className={`composer-round-action ${contextChannelOpen || effectiveTransport.disabledTunnelIds.length ? 'selected' : ''}`} aria-expanded={contextChannelOpen} aria-haspopup="menu" aria-label="Túneis do ChatGPT" title="Ligar ou desligar túneis; o bundle ZIP é sempre enviado" onClick={() => setContextChannelOpen((open) => !open)}><Icon name="network" size={12}/></button>{contextChannelOpen && <span className="context-channel-menu" role="menu" data-chatgpt-overlay-blocker="true"><strong>Canais remotos</strong><span className="transport-protocol-note"><Icon name="file" size={13}/><span>Bundle ZIP<small>Sempre incluído em qualquer requisição</small></span><Icon name="check" size={13}/></span><TransportChoices value={effectiveTransport} tunnels={tunnelInstances} onChoose={(next) => onChatTransport?.(next)}/>{chatTransport && <button type="button" className="transport-use-default" onClick={() => onChatTransport?.(undefined)}><Icon name="refresh" size={13}/><span>Usar padrão global<small>Repõe a seleção global dos túneis</small></span></button>}</span>}</span>
          <button type="button" className={`composer-round-action ${knowledgeSharingEnabled ? 'selected' : ''}`} disabled={busy || !onKnowledgeSharing} aria-pressed={knowledgeSharingEnabled} aria-label="Conhecimento do projeto" title={knowledgeSharingEnabled ? 'Conhecimento ligado · enviar e atualizar conhecimento incremental nesta requisição' : 'Conhecimento desligado · não enviar catálogo existente; novas aprendizagens continuam a ser recolhidas'} onClick={() => onKnowledgeSharing?.(!knowledgeSharingEnabled)}><Icon name="knowledge" size={12}/>{knowledgeSharingEnabled && <span className="artifact-dot" aria-hidden="true"/>}</button>
          <span className="composer-mode-group" role="group" aria-label="Proteção de execução">
            <button type="button" className={`composer-round-action mode-protected ${currentExecutionMode === 'protected' ? 'selected' : ''}`} disabled={busy || !onExecutionMode} aria-pressed={currentExecutionMode === 'protected'} aria-label="Protected" title="Protected · executar e verificar primeiro na sandbox" onClick={() => onExecutionMode?.('protected')}><Icon name="shield" size={12}/></button>
            <button type="button" className={`composer-round-action mode-unprotected ${currentExecutionMode === 'unprotected' ? 'selected' : ''}`} disabled={busy || !onExecutionMode || Boolean(session.self_evolution)} aria-pressed={currentExecutionMode === 'unprotected'} aria-label="Unprotected" title={session.self_evolution ? 'Unprotected indisponível · auto-evolução do Wharness é sempre Protected' : 'Unprotected · executar diretamente no projeto real'} onClick={() => onExecutionMode?.('unprotected')}><Icon name="external" size={12}/></button>
          </span>
          <span className="composer-mode-group" role="group" aria-label="Automação de execução">
            <button type="button" className={`composer-round-action mode-manual ${currentAutomationMode === 'manual' ? 'selected' : ''}`} disabled={busy || !onAutomationMode} aria-pressed={currentAutomationMode === 'manual'} aria-label="Manual" title="Manual · executar e aplicar mudanças apenas por ação explícita" onClick={() => onAutomationMode?.('manual')}><Icon name="plan" size={12}/></button>
            <button type="button" className={`composer-round-action mode-auto ${currentAutomationMode === 'auto' ? 'selected' : ''}`} disabled={busy || !onAutomationMode} aria-pressed={currentAutomationMode === 'auto'} aria-label="Auto" title="Auto · mudanças válidas seguem Protected e são aplicadas após verificação" onClick={() => onAutomationMode?.('auto')}><Icon name="agent" size={12}/></button>
          </span>
          <span className="composer-mode-group" role="group" aria-label="Transporte com o ChatGPT">
            <button type="button" className={`composer-round-action mode-scraper ${currentChatTransportMode === 'scraper' ? 'selected' : ''}`} disabled={busy || !onChatTransportMode} aria-pressed={currentChatTransportMode === 'scraper'} aria-label="Scraper" title="Scraper · o Wharness interage diretamente com o ChatGPT" onClick={() => onChatTransportMode?.('scraper')}><Icon name="chatgpt" size={12}/></button>
            <button type="button" className={`composer-round-action mode-manual-transport ${currentChatTransportMode === 'manual' ? 'selected' : ''}`} disabled={busy || !onChatTransportMode} aria-pressed={currentChatTransportMode === 'manual'} aria-label="Manual (transporte)" title="Manual · copie o prompt e entregue o bundle de resposta manualmente" onClick={() => onChatTransportMode?.('manual')}><Icon name="clipboard" size={12}/></button>
          </span>
          <span className="composer-action-divider" />
          <button type="button" className={`composer-round-action plan-first ${requestMode === 'plan_first' ? 'selected' : ''}`} aria-pressed={requestMode === 'plan_first'} aria-label="Planificar antes de alterar" title={requestMode === 'plan_first' ? 'Plan first ativo · o Wharness pedirá uma proposta e aguardará aprovação' : 'Planificar antes de alterar'} onClick={() => onRequestMode?.(requestMode === 'plan_first' ? 'direct' : 'plan_first')}><Icon name="plan" size={12}/></button>
          <button type="button" className={`composer-round-action ${queueOpen ? 'selected' : ''}`} aria-label="Fila de espera" title="Fila de requests principais" onClick={() => setQueueOpen((current) => !current)}><Icon name="clipboard" size={12}/>{queuedRequests.length > 0 && <b>{queuedRequests.length}</b>}</button>
          <button type="button" className={`composer-round-action ${todoOpen ? 'selected' : ''}`} aria-label="Tarefas TODO" title="Tarefas da iteração" disabled={!todos.length} onClick={() => setTodoOpen((current) => !current)}><Icon name="check" size={12}/>{todos.length > 0 && <b>{todos.filter((todo) => !todo.done).length}</b>}</button>
          {taskInFlight && <span className="composer-comment-state"><span className="comment-pulse"/><Icon name="chatgpt" size={12}/> Request ativa · Ctrl+Enter comenta</span>}
        </div><button className="send-button" disabled={commentBusy || (!message.trim() && !attachments.length) || Boolean(preparedAttachmentCount)} aria-label={taskInFlight ? 'Adicionar request à fila' : 'Enviar ao agente'} title={taskInFlight ? 'Adicionar à fila' : 'Enviar'}><Icon name="send" size={15}/></button></div>
        <div className="composer-hint">{taskInFlight ? 'Enter adiciona à fila · Ctrl+Enter envia comentário · Shift+Enter cria linha' : requestMode === 'plan_first' ? 'Enter inicia a próxima request · Plan first aguarda aprovação' : 'Enter inicia a próxima request · Shift+Enter cria linha'}</div>
      </div>
    </form>

    {inspectedArtifact && <ArtifactInspector kind={inspectedArtifact} content={artifactContent?.[inspectedArtifact] || 'Conteúdo ainda não disponível para esta iteração.'} onClose={() => setInspectedArtifact('')} />}
    {inspectedChangeFile && <DiffInspector sessionId={session.id} file={inspectedChangeFile} onOpenFile={onOpenFile} onClose={() => setInspectedChangeFile(undefined)} />}
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

function ChatItemView({ item, copied, onCopy, onApprovePlan, onRejectPlan, onInspectArtifact, onInspectChange, onOpenFile, onRevertChange, onReprocessPolicyBlock, canReprocessPolicyBlock, onRepairWithGPT, canRepairWithGPT, onRetryDependencyNetwork, canRetryDependencyNetwork, onRetryTransportFailure, onResendPendingRequest, onCancelPendingRequest, busy, taskInFlight, artifactContent }: { item: ChatItem; copied: boolean; onCopy: (item: ChatItem) => Promise<void>; onApprovePlan?: (item: ChatItem) => Promise<void>; onRejectPlan?: (item: ChatItem) => void; onInspectArtifact: (kind: ChatArtifactKind) => void; onInspectChange: (file: ChatChangeFile) => void; onOpenFile?: (path: string) => void; onRevertChange?: (item: ChatItem) => Promise<void>; onReprocessPolicyBlock?: () => Promise<void>; canReprocessPolicyBlock: boolean; onRepairWithGPT?: (detail: string) => Promise<void>; canRepairWithGPT: boolean; onRetryDependencyNetwork?: () => Promise<void>; canRetryDependencyNetwork: boolean; onRetryTransportFailure?: (requestId: string) => Promise<void>; onResendPendingRequest?: (requestId: string) => Promise<void>; onCancelPendingRequest?: (requestId: string) => Promise<void>; busy: boolean; taskInFlight: boolean; artifactContent?: Partial<Record<ChatArtifactKind, string>> }) {
  const source = chatItemSource(item)
  const presentation = item.presentation || 'message'
  const visibleText = item.role === 'harness' ? stripTodoSection(item.text) : item.text
  if (presentation === 'change' && item.change) return <ChangeSummaryCard item={item} onInspect={onInspectChange} onOpenFile={onOpenFile} onRevert={onRevertChange} />
  if (presentation === 'notice') return <details id={`chat-item-${item.id}`} className={`chat-notice notice-${source} notice-${item.turnKind || 'status'}`}><summary><span className="notice-mark"><Icon name={noticeIcon(item)} size={12}/></span><strong>{source === 'chatgpt' ? 'ChatGPT' : 'WHX'}</strong><span className="notice-kind">{item.meta || item.turnKind || 'estado'}</span><span className="notice-summary">{compactNoticeText(visibleText)}</span><time dateTime={item.createdAt || ''}>{formatMessageTime(item.createdAt)}</time><Icon name="chevron-right" size={11}/></summary><div className="notice-content"><ExpandableMarkdown markdown={visibleText || 'Atualização da execução.'}/><div className="notice-actions">{canRepairWithGPT && onRepairWithGPT && isFailureNotice(item) && <button type="button" className="text-button" disabled={busy || taskInFlight} onClick={() => void requestGPTRepair(onRepairWithGPT)}><Icon name="agent" size={12}/> Corrigir com GPT</button>}{canRetryDependencyNetwork && onRetryDependencyNetwork && isFailureNotice(item) && <button type="button" className="text-button" disabled={busy} onClick={() => void onRetryDependencyNetwork()}><Icon name="network" size={12}/> Permitir rede e repetir</button>}{isPolicyBlockedNotice(item) && canReprocessPolicyBlock && onReprocessPolicyBlock && <button type="button" className="text-button" disabled={busy} onClick={() => void onReprocessPolicyBlock()}><Icon name="refresh" size={12}/> Reprocessar</button>}{isTransportFailureNotice(item) && item.iteration && onRetryTransportFailure && <button type="button" className="text-button" disabled={busy || taskInFlight} title={taskInFlight ? 'Existe um pedido mais recente em processamento' : undefined} onClick={() => void onRetryTransportFailure(item.iteration!.requestId)}><Icon name="refresh" size={12}/> Retomar pedido</button>}{item.iteration && onResendPendingRequest && <button type="button" className="text-button" disabled={busy || taskInFlight} title={taskInFlight ? 'Existe um pedido mais recente em processamento' : 'Reenvia o mesmo pedido ao ChatGPT, caso o envio automático não tenha sido entregue'} onClick={() => void onResendPendingRequest(item.iteration!.requestId)}><Icon name="refresh" size={12}/> Reenviar request</button>}{item.iteration && onCancelPendingRequest && <button type="button" className="text-button danger" disabled={busy} onClick={() => void onCancelPendingRequest(item.iteration!.requestId)}><Icon name="close" size={12}/> Cancelar pedido</button>}</div>{item.iteration && <IterationReference item={item} onInspectArtifact={onInspectArtifact} artifactContent={artifactContent}/>}</div></details>
  if (presentation === 'thought') return <div className="chat-thought"><span className="thought-mark"><Icon name="agent" size={13}/></span><div><strong>Raciocínio visível do ChatGPT</strong><MarkdownContent markdown={visibleText}/>{item.meta && <span>{item.meta}</span>}</div></div>

  const label = source === 'user' ? 'Você' : source === 'chatgpt' ? 'ChatGPT' : 'Wharness'
  return <article id={`chat-item-${item.id}`} tabIndex={-1} className={`message message-${source} ${presentation === 'plan' ? 'message-plan' : ''}`}>
    <div className="message-heading"><div className="message-label">{label}</div><div className="message-tools"><time dateTime={item.createdAt || ''}>{formatMessageTime(item.createdAt)}</time><button type="button" onClick={() => void onCopy(item)} title="Copiar mensagem" aria-label="Copiar mensagem"><Icon name={copied ? 'check' : 'copy'} size={12}/></button></div></div>
    <div className="message-body">{item.role === 'harness' ? <ExpandableMarkdown markdown={visibleText || 'Atualização de tarefas.'} /> : visibleText}</div>
    {item.attachments?.length ? <div className="message-attachments">{item.attachments.map((file, index) => <MessageAttachmentCard key={file.storageRef || `${file.name}-${file.size}-${index}`} attachment={file}/>)}</div> : null}
    {item.iteration && <IterationReference item={item} onInspectArtifact={onInspectArtifact} artifactContent={artifactContent} />}
    {(item.meta || (isPolicyBlockedNotice(item) && canReprocessPolicyBlock && onReprocessPolicyBlock)) && <div className="message-meta">{item.meta}{isPolicyBlockedNotice(item) && canReprocessPolicyBlock && onReprocessPolicyBlock && <button type="button" className="text-button" disabled={busy} onClick={() => void onReprocessPolicyBlock()}><Icon name="refresh" size={12}/> Reprocessar</button>}</div>}
    {item.approval && <div className={`plan-approval plan-${item.approval.status}`}>
      {item.approval.status === 'pending' ? <><div><Icon name="plan" size={13}/><span>Plano proposto · nenhuma alteração foi executada.</span></div><div><button type="button" className="text-button" onClick={() => onRejectPlan?.(item)}>Rejeitar</button><button type="button" className="apply-button" onClick={() => void onApprovePlan?.(item)}><Icon name="check" size={13}/> Aprovar e implementar</button></div></> : <span>{item.approval.status === 'approved' ? 'Plano aprovado para implementação.' : 'Plano rejeitado. Nenhuma alteração foi iniciada.'}</span>}
    </div>}
  </article>
}

function ExpandableMarkdown({ markdown }: { markdown: string }) {
  const [expanded, setExpanded] = useState(false)
  const collapsible = markdown.length > LONG_CHAT_MARKDOWN_CHARS || markdown.split('\n').length > LONG_CHAT_MARKDOWN_LINES
  return <div className={`chat-markdown-disclosure${collapsible ? ' collapsible' : ''}${expanded ? ' expanded' : ''}`}>
    <div className="chat-markdown-window"><MarkdownContent markdown={markdown}/></div>
    {collapsible && <button type="button" className="chat-markdown-toggle" aria-expanded={expanded} onClick={() => setExpanded((current) => !current)}>
      <span aria-hidden="true">{expanded ? '−' : '···'}</span>{expanded ? 'Mostrar menos' : 'Expandir conteúdo'}
    </button>}
  </div>
}

function compactNoticeText(value: string) {
  const plain = value.replace(/```[\s\S]*?```/g, ' código ').replace(/\[([^\]]+)\]\([^)]+\)/g, '$1').replace(/[*_#>`~]/g, '').replace(/\s+/g, ' ').trim()
  if (!plain) return 'Atualização da execução.'
  return plain.length > 150 ? `${plain.slice(0, 147)}…` : plain
}

function isFailureNotice(item: ChatItem) {
  return item.iteration?.phase === 'failed' || item.iteration?.artifacts.includes('error') || /falh|erro|bloquead/i.test(item.meta || '')
}

async function requestGPTRepair(onRepairWithGPT: (detail: string) => Promise<void>) {
  const detail = await promptDialog({
    title: 'Corrigir erro com GPT',
    message: 'O Wharness enviará o erro, os resultados da execução e o contexto atual. Pode acrescentar um detalhe para orientar a correção ou deixar em branco.',
    inputLabel: 'Detalhe opcional',
    placeholder: 'Ex.: verifique também o comportamento no Windows',
    confirmLabel: 'Enviar para correção',
    tone: 'warning',
  })
  if (detail === undefined) return
  await onRepairWithGPT(detail)
}

function ChangeSummaryCard({ item, onInspect, onOpenFile, onRevert }: { item: ChatItem; onInspect: (file: ChatChangeFile) => void; onOpenFile?: (path: string) => void; onRevert?: (item: ChatItem) => Promise<void> }) {
  const [expanded, setExpanded] = useState(false)
  const change = item.change!
  const hostCommands = change.hostCommands || []
  const additions = change.files.reduce((total, file) => total + file.additions, 0)
  const deletions = change.files.reduce((total, file) => total + file.deletions, 0)
  const prioritizedFiles = prioritizedChangeFiles(change.files)
  const visibleFiles = expanded ? prioritizedFiles : prioritizedFiles.slice(0, CHANGE_DIFF_PREVIEW_COUNT)
  const hiddenCount = Math.max(0, prioritizedFiles.length - visibleFiles.length)
  return <article className="change-summary-card">
    <header><div><span className="change-summary-icon"><Icon name="apply" size={14}/></span><div><strong>{change.reverted ? 'Alterações revertidas' : 'Alterações aplicadas'}</strong><span>{change.files.length} ficheiro(s) · {formatMessageTime(change.appliedAt)}</span></div></div><code>+{additions} −{deletions}</code></header>
    {prioritizedFiles.length > 0 && <div className={`change-file-disclosure${hiddenCount ? ' collapsed' : ''}`}>
      <div className="change-file-list">{visibleFiles.map((file) => <div className={`change-file-row${isNormativeChangePath(file.path) ? ' normative' : ''}`} key={file.path}><button type="button" className="change-file-name" onClick={() => onOpenFile?.(file.path)} title="Abrir no Editor"><Icon name="file" size={12}/><span>{file.path}</span>{isNormativeChangePath(file.path) && <em>Normativo</em>}</button><button type="button" className="change-file-diff" onClick={() => onInspect(file)} title="Ver diff"><b>+{file.additions}</b><i>−{file.deletions}</i></button></div>)}</div>
      {prioritizedFiles.length > CHANGE_DIFF_PREVIEW_COUNT && <button type="button" className="change-file-toggle" aria-expanded={expanded} onClick={() => setExpanded((current) => !current)}><span aria-hidden="true">{expanded ? '−' : '···'}</span>{expanded ? 'Mostrar menos diffs' : `Mostrar mais ${hiddenCount} diff${hiddenCount === 1 ? '' : 's'}`}</button>}
    </div>}
    {hostCommands.length > 0 && <div className="change-host-commands"><strong>Comandos no host</strong>{hostCommands.map((command, index) => <div className="change-host-command" key={`${command.argv.join(' ')}-${index}`}><code>{command.argv.join(' ')}</code><span>{command.cwd || '.'} · exit {command.exit_code} · {command.duration_ms} ms</span></div>)}</div>}
    <footer><span>Plano {change.planId}</span>{change.canRevert && !change.reverted && <button type="button" className="text-button change-revert" onClick={() => void onRevert?.(item)}><Icon name="refresh" size={12}/> Reverter alteração</button>}</footer>
  </article>
}

function DiffInspector({ sessionId, file, onOpenFile, onClose }: { sessionId: string; file: ChatChangeFile; onOpenFile?: (path: string) => void; onClose: () => void }) {
  useEffect(() => {
    const handleKeyDown = (event: globalThis.KeyboardEvent) => { if (event.key === 'Escape') onClose() }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [onClose])
  return <div className="diff-inspector-backdrop" data-chatgpt-overlay-blocker="true" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}><section className="diff-inspector" role="dialog" aria-modal="true" aria-label={`Diff de ${file.path}`}><header><div><strong>{file.path}</strong><span>+{file.additions} −{file.deletions}</span></div><div><button type="button" className="text-button" onClick={() => { onOpenFile?.(file.path); onClose() }}><Icon name="file" size={12}/> Abrir no Editor</button><button type="button" className="icon-button light" onClick={onClose} aria-label="Fechar diff"><Icon name="close" size={13}/></button></div></header><ChangeDiffEditor sessionId={sessionId} file={file}/></section></div>
}

function TransportChoices({ value, tunnels, onChoose }: { value: TransportOptions; tunnels: Array<{ id: string; provider: string; available: boolean; error?: string }>; onChoose?: (value: TransportOptions) => void }) {
  const disabled = new Set(value.disabledTunnelIds)
  const toggle = (id: string) => {
    if (disabled.has('*')) {
      onChoose?.({ disabledTunnelIds: tunnels.map((tunnel) => tunnel.id).filter((tunnelId) => tunnelId !== id) })
      return
    }
    const next = new Set(disabled)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    onChoose?.({ disabledTunnelIds: [...next] })
  }
  if (!tunnels.length) return <span className="transport-empty">Nenhum túnel configurado.</span>
  return <>{tunnels.map((tunnel) => {
    const enabled = tunnel.available && !disabled.has('*') && !disabled.has(tunnel.id)
    return <button key={tunnel.id} type="button" role="menuitemcheckbox" aria-checked={enabled} disabled={!tunnel.available} title={tunnel.error || undefined} onClick={() => toggle(tunnel.id)}><Icon name="network" size={13}/><span>{tunnel.id}<small>{tunnel.provider}{tunnel.available ? '' : ' · indisponível'}</small></span>{enabled && <Icon name="check" size={13}/>}</button>
  })}</>
}

function ArtifactToggle({ kind, label, selected, required = false, disabled = false, inspectable = false, onToggle, onInspect }: { kind: ChatArtifactKind; label: string; selected: boolean; required?: boolean; disabled?: boolean; inspectable?: boolean; onToggle?: (kind: ChatArtifactKind) => void; onInspect?: (kind: ChatArtifactKind) => void }) {
  const title = `${required ? `${label} · selecionado automaticamente` : `${label} · ${selected ? 'será anexado' : 'não será anexado'}`}${inspectable ? ' · clique duplo para visualizar' : ''}`
  return <button type="button" className={`composer-round-action artifact-${kind} ${selected ? 'selected' : ''} ${required ? 'automatic' : ''}`} disabled={disabled} aria-pressed={selected} aria-label={label} title={title} onDoubleClick={() => { if (inspectable) onInspect?.(kind) }} onClick={() => { if (!required) onToggle?.(kind); else if (inspectable) onInspect?.(kind) }}>
    {artifactIcon(kind)} {selected && <span className="artifact-dot"/>}
  </button>
}

function IterationReference({ item, onInspectArtifact, artifactContent }: { item: ChatItem; onInspectArtifact: (kind: ChatArtifactKind) => void; artifactContent?: Partial<Record<ChatArtifactKind, string>> }) {
  const iteration = item.iteration!
  return <div className="message-iteration" id={iteration.phase === 'outbound' ? `request-${iteration.requestId}` : undefined} title={iteration.chatgptUrl || iteration.requestId}>
    <Icon name="bridge" size={11}/><a href={`#request-${iteration.requestId}`} aria-label={`Pedido ${iteration.requestId}`}><code>{iteration.requestId.replace(/^req_/, '').slice(0, 18)}</code></a><span>{iterationPhaseLabel(iteration.phase)}</span>
    <span className="iteration-artifacts">{iteration.artifacts.map((kind) => <button type="button" key={kind} title={`Ver ${artifactLabel(kind)}`} aria-label={`Ver ${artifactLabel(kind)}`} disabled={!artifactContent?.[kind]} onClick={() => onInspectArtifact(kind)}>{artifactIcon(kind)}</button>)}</span>
  </div>
}

function artifactIcon(kind: ChatArtifactKind) {
  return kind === 'context' ? <Icon name="workspace" size={11}/> : kind === 'prompt' ? <Icon name="plan" size={11}/> : kind === 'result' ? <Icon name="download" size={11}/> : <Icon name="shield" size={11}/>
}
function artifactLabel(kind: ChatArtifactKind) { return kind === 'context' ? 'contexto' : kind === 'prompt' ? 'prompt' : kind === 'result' ? 'resultado' : 'erro' }
function noticeIcon(item: ChatItem) { return item.turnKind === 'blocked' ? 'shield' : item.turnKind === 'workflow' ? 'terminal' : item.turnKind === 'change' ? 'apply' : item.iteration?.phase === 'failed' ? 'shield' : 'bridge' as const }
function isPolicyBlockedNotice(item: ChatItem) { return item.meta?.includes('Policy bloqueada') || item.text.includes('bloqueado pela Policy') }
function isTransportFailureNotice(item: ChatItem) { return item.meta?.includes('Falha de comunicação') || item.meta?.includes('Falha de protocolo') || item.meta?.includes('Pedido não concluído') }
function canResendPreparedRequest(item: ChatItem) { return item.iteration?.phase === 'outbound' || item.iteration?.phase === 'prepared' || item.iteration?.phase === 'submitted' }
// A notice may reference a request that has since been superseded/cancelled.
// A present pending-request list is authoritative: once the backend removes a
// delivered request from it, last_request_id is historical provenance only.
// Legacy sessions without that field fall back to the states that can still
// own a live remote request.
function isLivePendingRequest(session: Session, requestId: string) {
  return activePendingRequestId(session) === requestId
}

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
