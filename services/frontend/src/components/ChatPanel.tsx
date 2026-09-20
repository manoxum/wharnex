import { Fragment, forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState, type ForwardedRef, type FormEvent, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react'
import type { AutomationMode, EffortLevel, ArtifactRecord, ChatArtifactKind, ChatArtifactSelection, ChatChangeFile, ChatItem, ChatRequestMode, ChatTransportMode, ExecutionMode, ExecutionPlan, Interview, InterviewQuestion, ManagedArtifact, ChatFileRecord, ProjectTodo, QueuedChatRequest, Session } from '../types'
import type { ReasoningEffort } from '../types'
import { clearComposerDraft, flushComposerDraftSave, loadComposerDraft, loadComposerFileDraft, loadComposerStoredFileDraft, saveComposerFileDraft, saveComposerStoredFileDraft, scheduleComposerDraftSave, type ComposerStoredAttachmentDraft, type TransportOptions, type WorkspaceChat } from '../lib/workspaceMemory'
import { Icon } from './Icon'
import { ChatItemBoundary } from './ChatItemBoundary'
import { StatusPill } from './StatusPill'
import { stateLabel } from '../lib/risk'
import { addChatAttachments, encodeChatAttachments, uniquifyPastedChatFiles } from '../lib/chatAttachments'
import { MessageAttachmentCard, ComposerAttachmentChip } from './ChatAttachmentCard'
import { MarkdownContent } from './MarkdownContent'
import {
  applyDirectiveKindSuggestion,
  applyDirectiveSuggestion,
  canonicalDirective,
  directiveKindQuery,
  directiveKindSuggestions,
  directiveQuery,
  isCanonicalDirective,
  directiveSuggestions,
  parseDirectives,
  removeDirective,
  seeDirectiveAvailable,
  type ComposerDirective,
  type DirectiveKindSuggestion,
  type DirectiveQuery,
  type ReferenceableProject,
} from '../lib/composerDirectives'
import { ComposerDirectiveConfigPopover, type DirectivePopoverAnchor } from './ComposerDirectiveConfigPopover'
import { ComposerRichEditor, type CaretRequest, type ComposerRichEditorHandle } from './ComposerRichEditor'
import { ComposerAttachmentPanel } from './ComposerAttachmentPanel'
import { ComposerDirectiveMenuLayer } from './ComposerDirectiveMenuLayer'
import { ComposerReferenceThumbnail, ComposerTransportThumbnail } from './ComposerReferenceThumbnail'
import { desktopBridge } from '../lib/desktop'
import { api } from '../lib/api'
import { ChangeDiffEditor } from './ChangeDiffEditor'
import { BundleExchangeBar, ComposerBundlePreviewExplorer, ReturnedArtifactGallery } from './BundleExplorer'
import { useProgressiveChatHistory, type ChatViewportStore } from './useProgressiveChatHistory'
import { ProgressiveTranscriptEntry } from './ProgressiveTranscriptEntry'
import { promptDialog } from '../lib/appDialog'
import { plannerDeclaredNonRetryable, promptGPTRepairDetail } from '../lib/plannerRecovery'
import { activePendingRequestId } from '../lib/pendingRequest'
import { ARTIFACT_INDEX_EVENT, artifactIndexMarker, type ArtifactIndexRequest } from '../lib/artifactIndexing'
import { projectTodoPrePlanAttachment, storedAttachmentFile } from '../lib/projectTodoForwarding'

const COMPOSER_MIN_HEIGHT = 118
const COMPOSER_MAX_HEIGHT = 420
const LONG_CHAT_MARKDOWN_CHARS = 1400
const LONG_CHAT_MARKDOWN_LINES = 18
const LONG_USER_PROMPT_CHARS = 900
const LONG_USER_PROMPT_LINES = 12
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

// A identidade que o operador copia tem de nomear o contexto realmente
// transportado. Um workspace com projetos relacionados gera um hash proprio,
// por isso o hash do manifesto primario deixaria de identificar o que o planner leu.
function contextIdentityHash(session: Session) {
  return session.context.workspace_sha256 || session.context.manifest.sha256
}

/**
 * An imperative escape hatch onto the composer's rich editor — chiefly for
 * tests that need to drive it directly (see ChatPanel.test.tsx): jsdom cannot
 * faithfully simulate real keystrokes into a contenteditable Quill instance,
 * so tests instead call the underlying Quill API through here, exactly the
 * same way flowdocs' own editor keeps a `getEditor()` escape hatch for its
 * own imperative chip operations.
 */
export type ChatPanelHandle = { getComposerEditor: () => ReturnType<ComposerRichEditorHandle['getEditor']>; prepareExecutionPlanAdjustment: (plan: ExecutionPlan) => void }

export type ChatPanelProps = {
  session: Session
  items: ChatItem[]
  chats: WorkspaceChat[]
  archivedChats: WorkspaceChat[]
  activeChatId: string
  busy: boolean
  embedded?: boolean
  hideSwitcher?: boolean
  composerOnly?: boolean
  compactComposer?: boolean
  composerPlaceholder?: string
  composerSendLabel?: string
  composerHint?: string
  historyViewportStore?: ChatViewportStore
  executionMode?: ExecutionMode
  automationMode?: AutomationMode
  effortLevel?: EffortLevel
  reasoningEffort?: ReasoningEffort
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
  transportRequestId?: string
  onExecutionMode?: (mode: ExecutionMode) => void
  onAutomationMode?: (mode: AutomationMode) => void
  onDebugMode?: (enabled: boolean) => void
  onEffortLevel?: (level: EffortLevel) => void
  onReasoningEffort?: (effort: ReasoningEffort) => void
  onChatTransportMode?: (mode: ChatTransportMode) => void
  onKnowledgeSharing?: (enabled: boolean) => void
  onToggleArtifact?: (kind: ChatArtifactKind) => void
  onRequestMode?: (mode: ChatRequestMode) => void
  onChatTransport?: (transport?: TransportOptions) => void
  onComposerTyping?: () => void
  onSend: (message: string, attachments: File[], projectFiles: string[], artifacts: ChatArtifactSelection, requestMode: ChatRequestMode) => Promise<void>
  onAdjustExecutionPlan?: (message: string, attachments: File[], projectFiles: string[], artifacts: ChatArtifactSelection) => Promise<void>
  onPreviewBundle?: (message: string, attachments: File[], projectFiles: string[], artifacts: ChatArtifactSelection, requestMode: ChatRequestMode) => Promise<ArtifactRecord>
  onComment?: (message: string, attachments: File[]) => Promise<void>
  onQueueEdit?: (id: string, message: string) => void
  onQueueMove?: (id: string, direction: -1 | 1) => void
  onQueueRemove?: (id: string) => void
  onQueueMerge?: (id: string) => void
  onQueuePromote?: (id: string) => Promise<void>
  onApprovePlan?: (item: ChatItem) => Promise<void>
  onCorrectPlan?: (item: ChatItem, guidance: string) => Promise<void>
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
  onSaveChat?: (chatId: string) => Promise<void>
  onArchiveChat: (chatId: string) => Promise<void>
  onRestoreChat: (chatId: string) => Promise<void>
  onDeleteArchivedChat: (chatId: string) => Promise<void>
  onRenameChat?: (chatId: string, title: string) => Promise<void>
  onGenerateChatTitle?: (chatId: string) => Promise<void>
}

export const ChatPanel = forwardRef<ChatPanelHandle, ChatPanelProps>(function ChatPanel({ session, items, chats, archivedChats, activeChatId, busy, embedded = false, hideSwitcher = false, composerOnly = false, compactComposer = false, composerPlaceholder, composerSendLabel, composerHint, historyViewportStore, executionMode, automationMode, effortLevel, reasoningEffort, chatTransportMode, attachmentsEnabled, preparedAttachmentCount, failedPromptDelivery, artifactSelection, artifactRequired, artifactContent, requestMode = 'direct', globalTransport = { disabledTunnelIds: [] }, chatTransport, tunnelInstances = [], taskInFlight = false, queuedRequests = [], transportProgress = '', transportRequestId = '', onExecutionMode, onAutomationMode, onDebugMode, onEffortLevel, onReasoningEffort, onChatTransportMode, onKnowledgeSharing, onToggleArtifact, onRequestMode, onChatTransport, onComposerTyping, onSend, onAdjustExecutionPlan, onPreviewBundle, onComment, onQueueEdit, onQueueMove, onQueueRemove, onQueueMerge, onQueuePromote, onApprovePlan, onCorrectPlan, onRejectPlan, onConfirmPrepared, onDismissPrepared, onRetryPreparedDelivery, onOpenFile, onRevertChange, onReprocessPolicyBlock, canReprocessPolicyBlock = false, onRepairWithGPT, canRepairWithGPT = false, onRetryDependencyNetwork, canRetryDependencyNetwork = false, onRetryTransportFailure, onResendPendingRequest, onCancelPendingRequest, onExportChat, onNewChat, onSelectChat, onSaveChat, onArchiveChat, onRestoreChat, onDeleteArchivedChat }, forwardedRef: ForwardedRef<ChatPanelHandle>) {
  const [initialDraft] = useState(() => loadComposerDraft(session.project_path, activeChatId))
  const [initialFileDraft] = useState(() => loadComposerFileDraft(session.project_path, activeChatId))
  const [message, setMessage] = useState(initialDraft.message)
  const [composerHeight, setComposerHeight] = useState(initialDraft.height)
  const [attachments, setAttachments] = useState<File[]>(initialFileDraft.attachments)
  const [planAdjustment, setPlanAdjustment] = useState<{ planId: string; requestId: string; fileName: string; summary: string }>()
  const [attachmentError, setAttachmentError] = useState('')
  const [bundlePreview, setBundlePreview] = useState<ArtifactRecord>()
  const bundlePreviewRef = useRef<ArtifactRecord | undefined>(undefined)
  const [bundlePreviewBusy, setBundlePreviewBusy] = useState(false)
  const [bundlePreviewError, setBundlePreviewError] = useState('')
  const [projectFiles, setProjectFiles] = useState<string[]>(initialFileDraft.projectFiles)
  const [fileQuery, setFileQuery] = useState<DirectiveQuery>()
  const [activeSuggestionIndex, setActiveSuggestionIndex] = useState(0)
  const [copiedMessageId, setCopiedMessageId] = useState('')
  const [contextIdentityCopied, setContextIdentityCopied] = useState(false)
  const [archiveOpen, setArchiveOpen] = useState(false)
  const [commentBusy, setCommentBusy] = useState(false)
  const [queueOpen, setQueueOpen] = useState(false)
  const [editingQueueId, setEditingQueueId] = useState('')
  const [editingQueueText, setEditingQueueText] = useState('')
  const [todoOpen, setTodoOpen] = useState(false)
  const [contextChannelOpen, setContextChannelOpen] = useState(false)
  const [attachmentsPanelOpen, setAttachmentsPanelOpen] = useState(false)
  const [attachmentsPanelPath, setAttachmentsPanelPath] = useState<string>()
  const [attachmentsPanelKind, setAttachmentsPanelKind] = useState<'attach' | 'ref'>('attach')
  const [attachedPathFiles, setAttachedPathFiles] = useState<Array<{ root: string; files: string[] }>>([])
  // The directive currently showing its configuration popover, opened from
  // the chip embedded directly in the prompt text.
  const [openDirective, setOpenDirective] = useState<{ directive: ComposerDirective; anchor: DirectivePopoverAnchor }>()
  // Where the rich editor should place its caret next — applied whenever
  // `token` changes, independent of whether the text itself also changed (see
  // ComposerRichEditor). Bumped by every programmatic edit: picking a
  // directive from a menu or reopening one for editing.
  const [pendingCaret, setPendingCaret] = useState<CaretRequest>()
  // Every project Wharnex has worked on before, open or closed — the same
  // candidate set `@ref` resolves against at submit time (see
  // Service.KnownProjects). Fetched once per session/project rather than kept
  // in sync live: a menu that is a request behind reality is a normal, minor
  // staleness, unlike suggesting a name the engine will actually refuse.
  const [knownProjects, setKnownProjects] = useState<{ name: string; projectPath: string }[]>([])
  const [libraryArtifacts, setLibraryArtifacts] = useState<ManagedArtifact[]>([])
  const [chatFiles, setChatFiles] = useState<ChatFileRecord[]>([])
  const [projectTodos, setProjectTodos] = useState<ProjectTodo[]>([])
  const [kindQuery, setKindQuery] = useState<{ start: number; end: number; query: string }>()
  const [expandedWhxNoticeRunId, setExpandedWhxNoticeRunId] = useState('')
  const [inspectedArtifact, setInspectedArtifact] = useState<ChatArtifactKind | ''>('')
  const [inspectedChangeFile, setInspectedChangeFile] = useState<ChatChangeFile>()

  const draftInterviewReply = (interview: Interview, question: InterviewQuestion, option: { id: string; label: string }) => {
    const reply = [`Resposta da entrevista (${interview.protocol})`, `- ${question.prompt}`, `  - ${option.label}`].join('\n')
    composerMessageRef.current = reply
    setMessage(reply)
    setPendingCaret({ index: reply.length, token: Date.now() })
    richEditorRef.current?.focus()
  }
  const selectedArtifacts: ChatArtifactSelection = artifactSelection || { context: false, prompt: true, result: false, error: false }
  const currentExecutionMode = executionMode || session.execution_mode || 'protected'
  const currentAutomationMode = automationMode || session.automation_mode || 'manual'
  const currentEffortLevel = effortLevel || session.effort_level || 'medium'
  const currentReasoningEffort = reasoningEffort || session.reasoning_effort || 'high'
  const currentChatTransportMode = chatTransportMode || session.chat_transport_mode || 'scraper'
  const knowledgeSharingEnabled = session.knowledge_sharing_enabled !== false
  const effectiveTransport = chatTransport || globalTransport
  const composerRef = useRef<HTMLFormElement>(null)
  const composerResizeRef = useRef<{ pointerId: number; startY: number; startHeight: number } | null>(null)
  const copiedResetTimerRef = useRef<number | null>(null)
  const richEditorRef = useRef<ComposerRichEditorHandle>(null)
  const composerMessageRef = useRef(initialDraft.message)
  const composerCaretRef = useRef(initialDraft.message.length)
  const editorShellRef = useRef<HTMLDivElement>(null)
  const draftPersistRevisionRef = useRef(0)
  const draftPersistQueueRef = useRef<Promise<void>>(Promise.resolve())
  const draftRestoreRevisionRef = useRef(0)
  function prepareExecutionPlanAdjustment(plan: ExecutionPlan) {
    const safeID = plan.plan_id.replace(/[^A-Za-z0-9_-]+/g, '-').slice(0, 80) || 'atual'
    const fileName = `plano-execucao-${safeID}.md`
    const body = [
      '# Plano de execução atual',
      '',
      `- Plan ID: ${plan.plan_id}`,
      `- Request ID: ${plan.request_id}`,
      `- Risco: ${plan.risk}`,
      '',
      `## Resumo\n${plan.summary}`,
      `## Contrato\n${plan.document || '_Sem documento detalhado._'}`,
      `## Ficheiros previstos\n${(plan.impact_files || []).map((path) => `- ${path}`).join('\n') || '- Nenhum declarado'}`,
      `## Operações\n\`\`\`json\n${JSON.stringify(plan.operations || [], null, 2)}\n\`\`\``,
      `## Verificação\n\`\`\`json\n${JSON.stringify(plan.verification || [], null, 2)}\n\`\`\``,
    ].join('\n\n')
    const file = new File([body], fileName, { type: 'text/markdown', lastModified: Date.now() })
    const withoutPrevious = attachments.filter((item) => item.name !== planAdjustment?.fileName)
    const next = addChatAttachments(withoutPrevious, [file])
    persistAttachments(next.files)
    setAttachmentError(next.error || '')
    setPlanAdjustment({ planId: plan.plan_id, requestId: plan.request_id, fileName, summary: plan.summary })
    window.setTimeout(() => richEditorRef.current?.focus(), 0)
  }

  useImperativeHandle(forwardedRef, () => ({ getComposerEditor: () => richEditorRef.current?.getEditor(), prepareExecutionPlanAdjustment }), [attachments, planAdjustment])
  const fileInputRef = useRef<HTMLInputElement>(null)
  const todos = useMemo(() => latestTodoSnapshot(items), [items])
  const { afterHeight, beforeHeight, endRef, hasOlder, hasNewer, hiddenItemCount, hiddenNewerItemCount, loadOlder, loadNewer, onScroll: onHistoryScroll, streamRef, visibleItems } = useProgressiveChatHistory(items, activeChatId, busy, historyViewportStore)
  const whxNoticeRuns = useMemo(() => indexWhxNoticeRuns(visibleItems), [visibleItems])
  const eligibleProjectFiles = useMemo(() => session.context.manifest.files.map((file) => file.path).filter((path) => path !== 'EXPORTS.md'), [session.context.manifest.files])
  // `@ref` names any project Wharnex has worked on before — attached projects
  // first, so a shared basename resolves to the one already in front of the
  // operator, then every other known project by name only (its files are not
  // browsable until it is actually attached, which happens automatically once
  // the reference resolves at submit time).
  const attachedProjects = useMemo<ReferenceableProject[]>(() => (session.context.related_projects || []).map((project) => ({
    name: project.name, projectPath: project.project_path, attached: true,
    files: project.manifest.files.map((file) => file.path).filter((path) => path !== 'EXPORTS.md'),
  })), [session.context.related_projects])
  const referenceableProjects = useMemo<ReferenceableProject[]>(() => {
    const attachedPaths = new Set(attachedProjects.map((project) => project.projectPath))
    const unattached = knownProjects
      .filter((project) => !attachedPaths.has(project.projectPath))
      .map((project) => ({ name: project.name, projectPath: project.projectPath, files: [], attached: false }))
    return [...attachedProjects, ...unattached]
  }, [attachedProjects, knownProjects])
  useEffect(() => {
    let alive = true
    void api.knownProjects(session.id)
      .then((result) => { if (alive) setKnownProjects((result.projects || []).map((project) => ({ name: project.name, projectPath: project.project_path }))) })
      .catch(() => { if (alive) setKnownProjects([]) })
    return () => { alive = false }
  }, [session.id])
  useEffect(() => {
    let alive = true
    void api.managedArtifacts('', false, 'library')
      .then((result) => { if (alive) setLibraryArtifacts(result.artifacts || []) })
      .catch(() => { if (alive) setLibraryArtifacts([]) })
    return () => { alive = false }
  }, [session.id])
  useEffect(() => {
    let alive = true
    void api.chatFiles(session.id)
      .then((result) => { if (alive) setChatFiles(result.files || []) })
      .catch(() => { if (alive) setChatFiles([]) })
    return () => { alive = false }
  }, [session.id, session.artifacts])
  useEffect(() => {
    let alive = true
    void api.projectTodos(session.id)
      .then((result) => { if (alive) setProjectTodos(result.todos || []) })
      .catch(() => { if (alive) setProjectTodos([]) })
    return () => { alive = false }
  }, [session.id])
  const attachmentNames = useMemo(() => attachments.map((file) => file.name), [attachments])
  const chatFileCandidates = useMemo(() => chatFiles.map((file) => ({ value: file.direct ? `artifact|${file.artifact_id}` : `entry|${file.artifact_id}|${file.path || ''}`, label: file.name, detail: file.source === 'attachment' ? 'Anexo enviado' : file.source === 'returned' ? 'Ficheiro devolvido' : file.direction })), [chatFiles])
  const libraryFileCandidates = useMemo(() => libraryArtifacts.map((item) => ({ value: `session|${item.session_id}|${item.artifact.id}`, label: item.artifact.name, detail: `${item.project_path} · ${item.artifact.kind}` })), [libraryArtifacts])
  const todoCandidates = useMemo(() => projectTodos.filter((todo) => todo.status === 'open').map((todo) => ({ value: todo.id, label: todo.body.slice(0, 90), detail: todo.execution_status === 'processing' ? 'Em execução' : todo.id })), [projectTodos])
  const fileSuggestions = useMemo(() => fileQuery ? directiveSuggestions(fileQuery, eligibleProjectFiles, referenceableProjects, attachmentNames, attachedPathFiles, chatFileCandidates, libraryFileCandidates, todoCandidates) : [], [eligibleProjectFiles, fileQuery, referenceableProjects, attachmentNames, attachedPathFiles, chatFileCandidates, libraryFileCandidates, todoCandidates])
  const kindSuggestions = useMemo(() => kindQuery ? directiveKindSuggestions(kindQuery.query) : [], [kindQuery])
  const activeSuggestionCount = kindQuery
    ? kindSuggestions.length
    : fileQuery?.kind === 'attach'
      ? (fileQuery.query.startsWith('/') ? 2 : 1)
      : fileSuggestions.length
  const selectedSuggestionIndex = activeSuggestionCount ? Math.min(activeSuggestionIndex, activeSuggestionCount - 1) : 0
  useEffect(() => { setActiveSuggestionIndex(0) }, [fileQuery?.kind, fileQuery?.start, fileQuery?.end, fileQuery?.query, kindQuery?.start, kindQuery?.end, kindQuery?.query])
  const parsedDirectives = useMemo(() => parseDirectives(message), [message])
  // Miniatures are a projection only of completed canonical markers. Typed
  // autocomplete fragments stay plain text until a concrete reference is chosen.
  const canonicalReferenceDirectives = useMemo(() => parsedDirectives.filter((directive) => isCanonicalDirective(message, directive)), [message, parsedDirectives])
  const attachedPaths = useMemo(() => parsedDirectives.filter((directive) => directive.kind === 'attach'), [parsedDirectives])
  const attachmentDirectiveKey = useMemo(() => attachedPaths.map(canonicalDirective).join(' '), [attachedPaths])
  useEffect(() => {
    let alive = true
    const directives = parseDirectives(attachmentDirectiveKey)
    Promise.all(directives.map(async (directive) => {
      try {
        const inspection = await api.attachmentInspection(session.id, canonicalDirective(directive))
        return { root: directive.path, files: inspection.entries.filter((entry) => entry.status === 'included' && entry.kind === 'file').map((entry) => entry.path) }
      } catch { return { root: directive.path, files: [] } }
    })).then((values) => { if (alive) setAttachedPathFiles(values) })
    return () => { alive = false }
  }, [session.id, attachmentDirectiveKey])
  useEffect(() => {
    const onIndex = (event: Event) => {
      const detail = (event as CustomEvent<ArtifactIndexRequest>).detail
      if (!detail || (detail.kind !== 'chat' && detail.kind !== 'lib') || !detail.value) return
      const marker = artifactIndexMarker(detail.kind, detail.value)
      setMessage((current) => {
        const caret = Math.max(0, Math.min(composerCaretRef.current, current.length))
        const before = current.slice(0, caret)
        const after = current.slice(caret)
        const leftSpace = before && !/\s$/.test(before) ? ' ' : ''
        const rightSpace = after && !/^\s/.test(after) ? ' ' : ''
        const insertion = `${leftSpace}${marker}${rightSpace}`
        const next = `${before}${insertion}${after}`
        const nextCaret = caret + insertion.length
        composerMessageRef.current = next
        composerCaretRef.current = nextCaret
        window.setTimeout(() => focusCaretAt(nextCaret), 0)
        return next
      })
    }
    window.addEventListener(ARTIFACT_INDEX_EVENT, onIndex)
    return () => window.removeEventListener(ARTIFACT_INDEX_EVENT, onIndex)
  }, [])
  useEffect(() => {
    const onTodoInsert = (event: Event) => {
      const detail = (event as CustomEvent<{ chatId: string; text: string }>).detail
      if (!detail || detail.chatId !== activeChatId || !detail.text) return
      setMessage((current) => {
        const next = [current.trim(), detail.text.trim()].filter(Boolean).join('\n')
        composerMessageRef.current = next
        composerCaretRef.current = next.length
        window.setTimeout(() => focusCaretAt(next.length), 0)
        return next
      })
    }
    window.addEventListener('wharnex:todo-insert', onTodoInsert)
    return () => window.removeEventListener('wharnex:todo-insert', onTodoInsert)
  }, [activeChatId])
  const isProjectAttached = (name: string) => attachedProjects.some((project) => project.name.toLowerCase() === name.toLowerCase())
  const isSeeTargetAvailable = (directive: ComposerDirective) => seeDirectiveAvailable(directive, eligibleProjectFiles, referenceableProjects, attachmentNames, attachedPathFiles)
  // The directive the caret currently sits inside, if any — the one that gets
  // the chip toolbar. Recomputed from the same parse the overlay itself draws
  // from, so "which chip is active" can never disagree with "which chips
  // exist".
  useEffect(() => { if (queuedRequests.length) setQueueOpen(true) }, [queuedRequests.length])
  useEffect(() => {
    const projectPath = session.project_path
    const chatId = activeChatId
    const draft = loadComposerDraft(projectPath, chatId)
    const fileDraft = loadComposerFileDraft(projectPath, chatId)
    const storedDraft = loadComposerStoredFileDraft(projectPath, chatId)
    // References used to live in a list beside the composer. A draft saved under
    // that model is folded into inline markers once, so an operator who left a
    // draft open across the change does not silently lose the files they had
    // already chosen.
    const migrated = fileDraft.projectFiles.map((path) => canonicalDirective({ kind: 'file', value: path })).join(' ')
    const nextMessage = migrated ? [draft.message.trim(), migrated].filter(Boolean).join(' ') : draft.message
    composerMessageRef.current = nextMessage
    composerCaretRef.current = nextMessage.length
    setMessage(nextMessage)
    setComposerHeight(draft.height); setAttachments(fileDraft.attachments); setProjectFiles([]); setAttachmentError(''); setExpandedWhxNoticeRunId(''); setPlanAdjustment(undefined)

    const bridge = desktopBridge()
    if (!bridge || !storedDraft.length) return undefined
    const restoreRevision = ++draftRestoreRevisionRef.current
    void Promise.all(storedDraft.map(async (attachment) => {
      try {
        const stored = await bridge.attachments.read({ storageRef: attachment.storageRef })
        const recovered = storedAttachmentFile(stored, attachment.mime)
        const file = attachment.lastModified > 0
          ? new File([recovered], recovered.name, { type: recovered.type, lastModified: attachment.lastModified })
          : recovered
        return { file, attachment: { ...attachment, name: file.name, size: file.size, mime: file.type || attachment.mime, lastModified: file.lastModified } }
      } catch { return undefined }
    })).then((results) => {
      if (draftRestoreRevisionRef.current !== restoreRevision) return
      const recovered = results.filter((item): item is { file: File; attachment: ComposerStoredAttachmentDraft } => Boolean(item))
      saveComposerStoredFileDraft(projectPath, chatId, recovered.map((item) => item.attachment))
      if (recovered.length) {
        setAttachments((current) => {
          const seen = new Set(current.map((file) => `${file.name}\u0000${file.size}\u0000${file.type}`))
          const next = [...current]
          for (const { file } of recovered) {
            const key = `${file.name}\u0000${file.size}\u0000${file.type}`
            if (!seen.has(key)) { next.push(file); seen.add(key) }
          }
          saveComposerFileDraft(projectPath, chatId, { attachments: next, projectFiles: [] })
          return next
        })
      }
      if (recovered.length !== storedDraft.length) setAttachmentError('Alguns anexos do rascunho já não estavam disponíveis e foram removidos.')
    })
    return () => { draftRestoreRevisionRef.current += 1 }
  }, [session.project_path, activeChatId])
  useEffect(() => {
    if (message !== composerMessageRef.current) return
    scheduleComposerDraftSave(session.project_path, activeChatId, { message, height: composerHeight })
  }, [session.project_path, activeChatId, message, composerHeight])
  useEffect(() => () => { flushComposerDraftSave(session.project_path, activeChatId) }, [session.project_path, activeChatId])
  useEffect(() => { saveComposerFileDraft(session.project_path, activeChatId, { attachments, projectFiles }) }, [session.project_path, activeChatId, attachments, projectFiles])
  useEffect(() => { bundlePreviewRef.current = bundlePreview }, [bundlePreview])
  useEffect(() => () => {
    const record = bundlePreviewRef.current
    if (record) void api.deleteManagedArtifact(session.id, record.id).catch(() => undefined)
  }, [session.id])
  useEffect(() => () => {
    if (copiedResetTimerRef.current !== null) window.clearTimeout(copiedResetTimerRef.current)
  }, [])
  useEffect(() => {
    const composer = composerRef.current
    if (!composer) return
    // The rich editor grows with its own content like any block element — no
    // height to set by hand the way a textarea needed.
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

  function queueDurableComposerDraft(nextAttachments: File[], surfaceError = true) {
    const bridge = desktopBridge()
    if (!bridge) return
    const projectPath = session.project_path
    const chatId = activeChatId
    const revision = ++draftPersistRevisionRef.current
    const files = [...nextAttachments]
    draftPersistQueueRef.current = draftPersistQueueRef.current.catch(() => undefined).then(async () => {
      try {
        const encoded = await encodeChatAttachments(files)
        const persisted = await bridge.attachments.persist({ cacheKey: chatId, messageId: 'composer_draft', attachments: encoded })
        if (draftPersistRevisionRef.current !== revision) return
        saveComposerStoredFileDraft(projectPath, chatId, persisted.attachments.map((attachment, index) => ({ ...attachment, lastModified: files[index]?.lastModified ?? 0 })))
      } catch {
        if (draftPersistRevisionRef.current !== revision) return
        saveComposerStoredFileDraft(projectPath, chatId, [])
        if (surfaceError) setAttachmentError('Não foi possível guardar os anexos do rascunho para restaurar após recarregar a tela.')
      }
    })
  }

  function persistAttachments(nextAttachments: File[]) {
    saveComposerFileDraft(session.project_path, activeChatId, { attachments: nextAttachments, projectFiles })
    setAttachments(nextAttachments)
    queueDurableComposerDraft(nextAttachments)
  }

  function clearComposer() {
    composerMessageRef.current = ''
    composerCaretRef.current = 0
    setMessage('')
    setAttachments([])
    setProjectFiles([])
    setFileQuery(undefined)
    setAttachmentError('')
    clearComposerDraft(session.project_path, activeChatId)
    queueDurableComposerDraft([], false)
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  async function submitMain(event?: FormEvent) {
    event?.preventDefault()
    const typed = composerMessageRef.current.trim()
    const text = typed || (attachments.length && !planAdjustment ? 'Analise os ficheiros anexados.' : '')
    if (!text || preparedAttachmentCount || commentBusy) return
    let selected: File[]
    try { selected = await resolveIndexedArtifactFiles(text, attachments) } catch (error) { setAttachmentError(error instanceof Error ? error.message : 'Não foi possível indexar o ficheiro referido.'); return }
    const selectedProjectFiles = projectFiles
    if (planAdjustment) {
      if (!onAdjustExecutionPlan) return
      try {
        await onAdjustExecutionPlan(text, selected, selectedProjectFiles, selectedArtifacts)
        clearComposer()
        setPlanAdjustment(undefined)
      } catch { /* parent reports the actionable error; keep the adjustment draft */ }
      return
    }
    clearComposer()
    try { await onSend(text, selected, selectedProjectFiles, selectedArtifacts, requestMode) } catch { /* parent reports the actionable error */ }
  }

  async function previewMainBundle() {
    const text = composerMessageRef.current.trim() || (attachments.length ? 'Analise os ficheiros anexados.' : '')
    if (!text || !onPreviewBundle || preparedAttachmentCount || commentBusy || bundlePreviewBusy) return
    setBundlePreviewBusy(true)
    setBundlePreviewError('')
    try {
      const selected = await resolveIndexedArtifactFiles(text, attachments)
      const record = await onPreviewBundle(text, selected, projectFiles, selectedArtifacts, requestMode)
      if (bundlePreview) void api.deleteManagedArtifact(session.id, bundlePreview.id).catch(() => undefined)
      setBundlePreview(record)
    } catch (reason) {
      setBundlePreviewError(reason instanceof Error ? reason.message : 'Não foi possível montar a pré-visualização do bundle.')
    } finally {
      setBundlePreviewBusy(false)
    }
  }

  function closeBundlePreview() {
    const record = bundlePreview
    setBundlePreview(undefined)
    if (record) void api.deleteManagedArtifact(session.id, record.id).catch(() => undefined)
  }

  async function submitComment() {
    const text = composerMessageRef.current.trim() || (attachments.length ? 'Analise os ficheiros anexados como orientação adicional para esta tarefa.' : '')
    if (!text || !taskInFlight || !onComment || preparedAttachmentCount || commentBusy) return
    let selected: File[]
    try { selected = await resolveIndexedArtifactFiles(text, attachments) } catch (error) { setAttachmentError(error instanceof Error ? error.message : 'Não foi possível indexar o ficheiro referido.'); return }
    clearComposer()
    setCommentBusy(true)
    try { await onComment(text, selected) } catch { /* parent surfaces the transport error */ } finally { setCommentBusy(false) }
  }

  function addFiles(files: File[]) {
    const next = addChatAttachments(attachments, files)
    persistAttachments(next.files); setAttachmentError(next.error || '')
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  async function resolveIndexedArtifactFiles(text: string, existing: File[]) {
    const files = [...existing]
    const seen = new Set(files.map((file) => `${file.name}:${file.size}`))
    const append = (file: File) => {
      const key = `${file.name}:${file.size}`
      if (!seen.has(key)) { files.push(file); seen.add(key) }
    }
    const indexedDirectives = parseDirectives(text).filter((item) => item.kind === 'chat' || item.kind === 'lib' || item.kind === 'todo')
    let currentTodos = projectTodos
    if (indexedDirectives.some((item) => item.kind === 'todo')) {
      const refreshed = await api.projectTodos(session.id)
      currentTodos = refreshed.todos || projectTodos
    }
    for (const directive of indexedDirectives) {
      if (directive.kind === 'todo') {
        const todo = currentTodos.find((item) => item.id === directive.value)
        if (!todo) throw new Error(`O TODO @todo ${directive.value} já não está disponível neste projeto.`)
        append(projectTodoPrePlanAttachment(todo))
        if (todo.attachments?.length) {
          const bridge = desktopBridge()
          if (!bridge) throw new Error(`Recuperar os artefactos do TODO ${directive.value} requer o Wharnex Desktop.`)
          for (const attachment of todo.attachments) {
            const stored = await bridge.attachments.read({ storageRef: attachment.storage_ref })
            append(storedAttachmentFile(stored, attachment.mime || 'application/octet-stream'))
          }
        }
        continue
      }

      let url = ''
      let name = ''
      let contentType = 'application/octet-stream'
      if (directive.kind === 'chat') {
        if (directive.value.startsWith('entry|')) {
          const [, bundleId, entryPath] = directive.value.split('|', 3)
          url = api.artifactEntryURL(session.id, bundleId, entryPath)
          name = entryPath.split('/').pop() || entryPath
        } else {
          const artifact = directive.value.startsWith('artifact|')
            ? (session.artifacts || []).find((item) => item.id === directive.value.slice('artifact|'.length))
            : [...(session.artifacts || [])].reverse().find((item) => item.name === directive.value)
          if (!artifact) throw new Error(`O ficheiro @chat ${directive.value} já não está disponível neste chat.`)
          url = api.artifactURL(session.id, artifact.id); name = artifact.name; contentType = artifact.content_type || contentType
        }
      } else {
        const parts = directive.value.split('|')
        const sourceSession = parts[1]; const artifactId = parts[2]
        const item = libraryArtifacts.find((candidate) => candidate.session_id === sourceSession && candidate.artifact.id === artifactId)
        if (!item) throw new Error(`O ficheiro @lib ${artifactId} já não está disponível na biblioteca.`)
        url = api.artifactURL(sourceSession, artifactId); name = item.artifact.name; contentType = item.artifact.content_type || contentType
      }
      const response = await fetch(url)
      if (!response.ok) throw new Error(`Falha ao carregar ${name || directive.value} para o próximo bundle (HTTP ${response.status}).`)
      const blob = await response.blob()
      append(new File([blob], name || 'artifact.bin', { type: blob.type || contentType }))
    }
    return files
  }

  function pasteFiles(files: File[]) {
    if (!attachmentsEnabled) {
      setAttachmentError('Colar ficheiros requer o Wharnex Desktop com o planner manual.')
      return
    }
    addFiles(uniquifyPastedChatFiles(attachments, files))
  }

  // The two menus are mutually exclusive by construction: a value query only
  // matches once a keyword and ":" have been typed, a kind query only before
  // that — so the caret is never "in" both states, and exactly one of the two
  // ever opens.
  function syncDirectiveQueries(value: string, caret: number) {
    const value_query = directiveQuery(value, caret)
    setFileQuery(value_query)
    setKindQuery(value_query ? undefined : directiveKindQuery(value, caret))
  }

  // Every keystroke in the rich editor arrives here: the canonical text plus
  // where its caret landed, translated from the Quill document back to a
  // plain-text offset (see composerRichText.ts) — everything downstream
  // (drafts, submission and autocomplete) keeps reading and writing that same
  // plain string exactly as it did before the rich editor.
  function updateMessage(value: string, caret: number) {
    const textChanged = value !== composerMessageRef.current
    composerMessageRef.current = value
    composerCaretRef.current = caret
    setMessage(value)
    syncDirectiveQueries(value, caret)
    if (textChanged) onComposerTyping?.()
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

  // Requests the rich editor place its caret at an exact position — the
  // pattern every programmatic insertion below shares, so the operator's next
  // keystroke always lands where the menu just wrote. `token` always bumps, so
  // a request to a position identical to the last one (jumping to the same
  // chip twice) still takes effect.
  function focusCaretAt(position: number) {
    composerCaretRef.current = position
    richEditorRef.current?.focus()
    setPendingCaret((current) => ({ index: position, token: (current?.token ?? 0) + 1 }))
  }

  // The directive is written where it was being typed, already canonical, so
  // the chip the operator sees and the marker the model receives are the same
  // string. A project row narrows the query instead of ending it, because
  // naming a project and naming a file inside it are one intent at two levels.
  // There is nothing to autocomplete for a path outside every project, so the
  // operator picks it. The native picker is also the only affordance that can
  // confirm the path exists before it reaches the prompt.
  async function pickAttachment() {
    const picked = await desktopBridge()?.projects.pickDirectory({ title: 'Anexar pasta ao contexto' })
    if (!picked || picked.cancelled || !picked.path) return
    selectDirective({ value: picked.path, label: picked.path })
    setAttachmentsPanelPath(picked.path)
    setAttachmentsPanelKind('attach')
    setAttachmentsPanelOpen(true)
  }

  function selectDirective(suggestion: { value: string; label: string; continues?: boolean }) {
    if (!fileQuery) return
    const applied = applyDirectiveSuggestion(message, fileQuery, suggestion)
    composerMessageRef.current = applied.text
    setMessage(applied.text)
    setFileQuery(suggestion.continues ? directiveQuery(applied.text, applied.caret) : undefined)
    setActiveSuggestionIndex(0)
    focusCaretAt(applied.caret)
  }

  // Typing "@" alone opens this before any keyword exists, so the operator
  // never has to already know and spell out a directive to start one. Picking
  // a kind writes its canonical keyword and colon and hands off directly to
  // the value query — the two menus chain into one continuous flow.
  function selectKind(suggestion: DirectiveKindSuggestion) {
    if (!kindQuery) return
    const applied = applyDirectiveKindSuggestion(message, kindQuery, suggestion)
    composerMessageRef.current = applied.text
    setMessage(applied.text)
    setKindQuery(undefined)
    setFileQuery(directiveQuery(applied.text, applied.caret))
    setActiveSuggestionIndex(0)
    focusCaretAt(applied.caret)
  }

  // Edit reopens the picker for that directive in place: for `attach` that is
  // the include/exclude modal, for `file`/`ref` it is the same completion menu
  // that created it, positioned to replace exactly this occurrence and no
  // other — two directives can share a value with different surrounding text.
  function editDirective(directive: ComposerDirective) {
    if (directive.kind === 'attach' || directive.kind === 'ref') {
      setAttachmentsPanelPath(directive.kind === 'ref' ? directive.project : directive.path)
      setAttachmentsPanelKind(directive.kind)
      setAttachmentsPanelOpen(true)
      return
    }
    const keyword = directive.kind
    const prefix = message.slice(0, directive.start)
    const suffix = message.slice(directive.end)
    const next = `${prefix}@${keyword}:${suffix}`
    composerMessageRef.current = next
    setMessage(next)
    const caret = directive.start + keyword.length + 2
    setFileQuery(directiveQuery(next, caret))
    focusCaretAt(caret)
  }

  function removeDirectiveChip(directive: ComposerDirective) {
    setMessage((current) => {
      const next = removeDirective(current, directive)
      composerMessageRef.current = next
      return next
    })
    setFileQuery(undefined)
    setKindQuery(undefined)
    setOpenDirective((current) => current?.directive.start === directive.start && current.directive.end === directive.end ? undefined : current)
  }

  // Opens the configuration popover for one directive, anchored to the chip
  // embed the operator clicked in the rich editor (see ComposerRichEditor).
  function openDirectivePopover(directive: ComposerDirective, rect: DOMRect) {
    setOpenDirective({ directive, anchor: { left: rect.left, top: rect.top, bottom: rect.bottom, width: rect.width } })
  }

  function configureDirective(directive: ComposerDirective, rect: DOMRect) {
    if (directive.kind === 'attach' || directive.kind === 'ref') {
      editDirective(directive)
      setOpenDirective(undefined)
      return
    }
    openDirectivePopover(directive, rect)
  }

  async function writeClipboard(text: string) {
    try {
      await navigator.clipboard.writeText(text)
    } catch {
      const textarea = document.createElement('textarea')
      textarea.value = text; textarea.style.position = 'fixed'; textarea.style.opacity = '0'
      document.body.appendChild(textarea); textarea.select(); document.execCommand('copy'); textarea.remove()
    }
  }

  function resetCopyFeedback(reset: () => void) {
    if (copiedResetTimerRef.current !== null) window.clearTimeout(copiedResetTimerRef.current)
    copiedResetTimerRef.current = window.setTimeout(() => {
      reset()
      copiedResetTimerRef.current = null
    }, 1400)
  }

  async function copyMessage(item: ChatItem) {
    await writeClipboard(item.text)
    setCopiedMessageId(item.id)
    resetCopyFeedback(() => setCopiedMessageId((current) => current === item.id ? '' : current))
  }

  async function copyContextIdentity() {
    const hash = contextIdentityHash(session)
    const chatId = activeChatId || session.chat_id || '—'
    await writeClipboard(`Hash: ${hash}\nChat ID: ${chatId}`)
    setContextIdentityCopied(true)
    resetCopyFeedback(() => setContextIdentityCopied(false))
  }

  const latestFailureNoticeId = [...items].reverse().find(isFailureNotice)?.id
  const contextLabel = session.context.related_projects?.length ? `Contexto de ${session.context.related_projects.length + 1} projetos` : 'Contexto isolado'
  const contextStateTone = session.state === 'failed' ? 'danger' : session.state === 'verified' || session.state === 'applied' ? 'success' : 'neutral'
  // Each entry renders inside its own boundary: without one, a single throwing
  // item unmounts the whole workspace and leaves a blank window, turning a
  // cosmetic defect in one message into total loss of the UI.
  const renderChatEntry = (item: ChatItem) => <Fragment key={item.id}>
    <ChatItemBoundary label="Esta mensagem não pôde ser apresentada">
    <ChatItemView item={item} copied={copiedMessageId === item.id} onCopy={copyMessage} onApprovePlan={onApprovePlan} onCorrectPlan={onCorrectPlan} onRejectPlan={onRejectPlan} onInspectArtifact={setInspectedArtifact} onInspectChange={setInspectedChangeFile} onOpenFile={onOpenFile} onRevertChange={onRevertChange} onReprocessPolicyBlock={onReprocessPolicyBlock} canReprocessPolicyBlock={canReprocessPolicyBlock} onRepairWithGPT={onRepairWithGPT} canRepairWithGPT={canRepairWithGPT && item.id === latestFailureNoticeId} requiresOperatorGuidance={plannerDeclaredNonRetryable(session)} onRetryDependencyNetwork={onRetryDependencyNetwork} canRetryDependencyNetwork={canRetryDependencyNetwork && item.id === latestFailureNoticeId} onRetryTransportFailure={onRetryTransportFailure} onResendPendingRequest={item.iteration && isLivePendingRequest(session, item.iteration.requestId) && canResendPreparedRequest(item) ? onResendPendingRequest : undefined} onCancelPendingRequest={item.iteration && isLivePendingRequest(session, item.iteration.requestId) ? onCancelPendingRequest : undefined} busy={busy} taskInFlight={taskInFlight} artifactContent={artifactContent} onInterviewChoice={draftInterviewReply} />
    </ChatItemBoundary>
    {item.iteration?.phase === 'result' && item.turnKind !== 'workflow' && <ChatItemBoundary label="Os artefactos desta iteração não puderam ser apresentados"><ReturnedArtifactGallery sessionId={session.id} artifacts={session.artifacts} requestId={item.iteration.requestId}/></ChatItemBoundary>}
  </Fragment>

  return <section className={`chat-panel ${embedded ? 'embedded' : ''} ${composerOnly ? 'composer-only' : ''} ${compactComposer ? 'compact-composer' : ''}`}>
    {!composerOnly && <header className={`panel-header chat-header ${embedded ? 'embedded' : ''}`}>
      <div className="chat-header-context" aria-label={contextLabel}>
        <span className="chat-header-context-icon"><Icon name="shield" size={13}/></span>
        <strong title={contextLabel}>{contextLabel}</strong>
        <StatusPill tone={contextStateTone}>{stateLabel(session.state)}</StatusPill>
        <div className="chat-header-context-actions">
          <button type="button" className="chat-header-context-copy-button" onClick={() => void copyContextIdentity()} aria-label="Copiar hash e ID do chat" title={contextIdentityCopied ? 'Hash e ID copiados' : 'Copiar hash completo e ID do chat'}><Icon name={contextIdentityCopied ? 'check' : 'copy'} size={12}/></button>
          {onExportChat && <button type="button" className="chat-export-button" disabled={busy} onClick={() => void onExportChat()} aria-label="Exportar ZIP" title="Exportar chat completo, execuções e bundles em ZIP"><Icon name="download" size={13}/></button>}
        </div>
      </div>
      <BundleExchangeBar sessionId={session.id} artifacts={session.artifacts} requestLineages={session.request_lineages} />
    </header>}

    {!composerOnly && !hideSwitcher && <div className="chat-switcher" aria-label="Conversas do Harness">
      <button className="chat-new-button" disabled={busy} onClick={() => void onNewChat()} title="Novo chat" aria-label="Novo chat"><Icon name="plus" size={14}/></button>
      {archivedChats.length > 0 && <button className="chat-new-button chat-reopen-button" disabled={busy} onClick={() => void onRestoreChat(archivedChats[0].id)} title={`Reabrir último chat fechado: ${archivedChats[0].title}`} aria-label="Reabrir último chat fechado"><Icon name="refresh" size={13}/></button>}
      <div className="chat-tabs">
        {chats.map((chat) => <div key={chat.id} className={chat.id === activeChatId ? 'chat-tab-group active' : 'chat-tab-group'}>
          <button className={chat.id === activeChatId ? 'chat-tab active' : 'chat-tab'} disabled={busy} onClick={() => void onSelectChat(chat.id)} title={chat.chatgptUrl ? `${chat.title}\nChatGPT: ${chat.chatgptUrl}` : `${chat.title}\nChatGPT ainda não vinculado`}>
            <span>{chat.title}</span><i className={chat.chatgptUrl ? 'chat-link-dot linked' : 'chat-link-dot'} aria-hidden="true" />
          </button>
          {onSaveChat && <button className="chat-tab-remove chat-tab-save" disabled={busy} onClick={() => void onSaveChat(chat.id)} title={`Guardar ${chat.title} em standby`} aria-label={`Guardar chat ${chat.title}`}><Icon name="save" size={11}/></button>}
          <button className="chat-tab-remove" disabled={busy} onClick={() => void onArchiveChat(chat.id)} title={`Fechar e arquivar ${chat.title}`} aria-label={`Fechar e arquivar chat ${chat.title}`}><Icon name="close" size={11}/></button>
        </div>)}
      </div>
      {!embedded && <button className={archiveOpen ? 'chat-archive-toggle active' : 'chat-archive-toggle'} disabled={busy && !archiveOpen} onClick={() => setArchiveOpen((current) => !current)} title="Chats fechados"><Icon name="folder" size={13}/><span>Arquivados</span>{archivedChats.length > 0 && <b>{archivedChats.length}</b>}</button>}
    </div>}


    {!composerOnly && !embedded && archiveOpen && <div className="chat-archive-panel">
      <div className="chat-archive-heading"><div><strong>Chats arquivados</strong><span>Fechar um chat preserva o histórico, o vínculo ChatGPT e os anexos locais.</span></div><button className="icon-button light" onClick={() => setArchiveOpen(false)} title="Fechar área de arquivados"><Icon name="close" size={13}/></button></div>
      {archivedChats.length ? <div className="chat-archive-list">{archivedChats.map((chat) => <div className="chat-archive-row" key={chat.id}>
        <div className="chat-archive-copy"><strong>{chat.title}</strong><span>{chat.chatgptUrl ? 'ChatGPT vinculado' : 'Sem vínculo ChatGPT'} · fechado em {formatMessageTime(chat.updatedAt)}</span></div>
        <div className="chat-archive-actions"><button className="text-button" disabled={busy} onClick={() => void onRestoreChat(chat.id)}><Icon name="refresh" size={12}/> Reabrir</button><button className="archive-delete-button" disabled={busy} onClick={() => void onDeleteArchivedChat(chat.id)} title="Eliminar definitivamente"><Icon name="trash" size={13}/></button></div>
      </div>)}</div> : <div className="chat-archive-empty">Nenhum chat fechado.</div>}
    </div>}

    {!composerOnly && <div ref={streamRef} className="chat-stream" onScroll={onHistoryScroll}>
      {beforeHeight > 0 && (
        <div className="chat-virtual-spacer" aria-hidden="true" style={{ height: beforeHeight }}/>
      )}
      {hasOlder && <div className="chat-history-loader"><span><Icon name="arrow-up" size={12}/> {hiddenItemCount} mensagem(ns) anterior(es)</span><button type="button" onClick={loadOlder}>Carregar mensagens anteriores</button></div>}
      {visibleItems.map((item, index) => {
        const previousNotices = whxNoticeRuns.previousByLatestId.get(item.id) || []
        if (whxNoticeRuns.hiddenIds.has(item.id)) return null
        const runExpanded = previousNotices.length > 0 && expandedWhxNoticeRunId === item.id
        const entry = <Fragment>
          {previousNotices.length > 0 && <div className="whx-notice-run">
            <button type="button" className="whx-notice-stack-toggle" aria-expanded={runExpanded} aria-label={runExpanded ? 'Ocultar notificações WHX anteriores' : `Mostrar ${previousNotices.length} notificações WHX anteriores`} onClick={() => setExpandedWhxNoticeRunId((current) => current === item.id ? '' : item.id)}>
              <span aria-hidden="true">···</span><small>{runExpanded ? 'ocultar anteriores' : `${previousNotices.length} anterior${previousNotices.length === 1 ? '' : 'es'}`}</small>
            </button>
            {runExpanded && <div className="whx-notice-run-history">{previousNotices.map(renderChatEntry)}</div>}
          </div>}
          {renderChatEntry(item)}
        </Fragment>
        return <ProgressiveTranscriptEntry key={item.id} streamRef={streamRef} deferUntilNear={index < visibleItems.length - 4} priority={index} variant={item.role === 'user' ? 'user' : 'assistant'}>{entry}</ProgressiveTranscriptEntry>
      })}
      {hasNewer && <div className="chat-history-loader newer"><span>{hiddenNewerItemCount} mensagem(ns) mais recente(s)</span><button type="button" onClick={loadNewer}>Carregar mensagens mais recentes</button></div>}
      {afterHeight > 0 && (
        <div className="chat-virtual-spacer" aria-hidden="true" style={{ height: afterHeight }}/>
      )}
      {busy && !taskInFlight && <div className="chat-thought live"><span className="thought-mark"><Icon name="agent" size={13}/></span><div><strong>Wharnex</strong><div className="thinking"><span/><span/><span/> A processar o pedido</div></div></div>}
      <div ref={endRef}/>
    </div>}

    {!composerOnly && <>
      {failedPromptDelivery ? <div className="prepared-draft" role="status"><div><strong>{failedPromptDelivery.kind === 'storage' ? 'Armazenamento local sem espaço' : failedPromptDelivery.kind === 'attention' ? 'Ação necessária no ChatGPT' : 'Entrega ao ChatGPT pendente'}</strong><span>{failedPromptDelivery.kind === 'storage' ? 'O bundle foi preservado, mas o backend não consegue guardá-lo. Liberte espaço no disco e tente a ingestão novamente.' : failedPromptDelivery.kind === 'attention' ? 'A página abriu, mas o campo de escrita ainda não está disponível. Verifique login, verificação anti-robô ou avisos na aba ChatGPT.' : 'O mesmo prompt, contexto e anexos continuam disponíveis para uma nova tentativa.'}</span></div><button type="button" className="apply-button" disabled={busy} onClick={() => void onRetryPreparedDelivery?.(failedPromptDelivery.requestId)}><Icon name="refresh" size={14}/> {failedPromptDelivery.kind === 'storage' ? 'Tentar após liberar espaço' : failedPromptDelivery.kind === 'attention' ? 'Tentar depois de resolver' : 'Tentar entregar novamente'}</button></div> : null}
      {preparedAttachmentCount ? <div className="prepared-draft" role="status"><div><strong>Preparação enviada ao ChatGPT</strong><span>{preparedAttachmentCount} item(ns) de entrada preparados. O contexto é incluído automaticamente apenas quando necessário.</span></div><div><button type="button" className="text-button" onClick={onDismissPrepared}>Já enviei</button><button type="button" className="apply-button" disabled={busy} onClick={() => void onConfirmPrepared?.()}><Icon name="send" size={14}/> Confirmar e enviar</button></div></div> : null}
    </>}

    {queueOpen && queuedRequests.length > 0 && <QueuePanel requests={queuedRequests} editingId={editingQueueId} editingText={editingQueueText} onEditing={(id, text) => { setEditingQueueId(id); setEditingQueueText(text) }} onEditingText={setEditingQueueText} onSave={() => { if (editingQueueId && editingQueueText.trim()) onQueueEdit?.(editingQueueId, editingQueueText.trim()); setEditingQueueId('') }} onCancel={() => setEditingQueueId('')} onMove={onQueueMove} onRemove={onQueueRemove} onMerge={onQueueMerge} onPromote={onQueuePromote} onClose={() => setQueueOpen(false)} />}
    {todoOpen && todos.length > 0 && <TodoPanel todos={todos} onClose={() => setTodoOpen(false)} />}

    {transportProgress && <div className="context-publication-progress" role="status"><span className="publication-orbit"><i/><i/><i/></span><div className="context-publication-copy"><strong>A preparar rotas remotas</strong><small>{transportProgress}</small></div>{transportRequestId && onCancelPendingRequest ? <button type="button" className="text-button danger context-publication-cancel" aria-label="Cancelar preparação do bundle" onClick={() => void onCancelPendingRequest(transportRequestId)}><Icon name="close" size={12}/> Cancelar</button> : null}</div>}

    <form ref={composerRef} className={`composer ${taskInFlight ? 'comment-mode' : ''} ${planAdjustment ? 'plan-adjustment-mode' : ''}`} style={{ height: composerHeight }} onSubmit={submitMain}>
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
      {planAdjustment && <div className="plan-adjustment-context"><span className="plan-adjustment-icon"><Icon name="plan" size={13}/></span><div><strong>Ajustar plano de execução</strong><small>{planAdjustment.summary}</small><code>{planAdjustment.fileName}</code></div><button type="button" aria-label="Cancelar ajuste do plano" title="Cancelar ajuste" onClick={() => { persistAttachments(attachments.filter((file) => file.name !== planAdjustment.fileName)); setPlanAdjustment(undefined) }}><Icon name="close" size={12}/></button></div>}
      {(attachments.length || canonicalReferenceDirectives.length || (!compactComposer && Object.values(selectedArtifacts).some(Boolean))) ? <div className="composer-attachments composer-reference-tray" aria-label="Conteúdo e referências da próxima iteração">
        {attachments.map((file) => <ComposerAttachmentChip key={`${file.name}-${file.size}-${file.lastModified}`} file={file} onRemove={() => persistAttachments(attachments.filter((item) => item !== file))}/>)}
        {canonicalReferenceDirectives.map((directive) => <ComposerReferenceThumbnail key={`${directive.kind}-${directive.start}-${directive.end}-${directive.value}`} session={session} directive={directive} attachments={attachments} chatFiles={chatFiles} libraryArtifacts={libraryArtifacts} projectTodos={projectTodos} onRemove={() => removeDirectiveChip(directive)}/>)}
        {!compactComposer && selectedArtifacts.context && <ComposerTransportThumbnail kind="context" label="Contexto ZIP" onOpen={() => setInspectedArtifact('context')}/>}
        {!compactComposer && selectedArtifacts.prompt && <ComposerTransportThumbnail kind="prompt" label="Prompt" onOpen={() => setInspectedArtifact('prompt')}/>}
        {!compactComposer && selectedArtifacts.result && <ComposerTransportThumbnail kind="result" label="Resultado" onOpen={() => setInspectedArtifact('result')}/>}
        {!compactComposer && selectedArtifacts.error && <ComposerTransportThumbnail kind="error" label="Erro" onOpen={() => setInspectedArtifact('error')}/>}
      </div> : null}
      {attachmentError && <div className="composer-error" role="alert">{attachmentError}</div>}
      {bundlePreviewError && <div className="composer-error" role="alert">{bundlePreviewError}</div>}
      {attachmentsPanelOpen && <ComposerAttachmentPanel sessionId={session.id} message={message} onMessage={(value) => { composerMessageRef.current = value; setMessage(value) }} initialPath={attachmentsPanelPath} initialKind={attachmentsPanelKind} onClose={() => { setAttachmentsPanelOpen(false); setAttachmentsPanelPath(undefined) }}/>}
      <div ref={editorShellRef} className="composer-editor-shell">
        <ComposerRichEditor
          ref={richEditorRef} value={message} caret={pendingCaret} onChange={updateMessage}
          onClickDirective={openDirectivePopover} onConfigureDirective={configureDirective} onRemoveDirective={removeDirectiveChip}
          onPasteFiles={pasteFiles} disabled={Boolean(preparedAttachmentCount)} lang="pt-PT"
          placeholder={composerPlaceholder || "Pergunte, analise, diagnostique ou descreva uma alteração…"}
          onKeyDownCapture={(event) => {
            if ((fileSuggestions.length || kindSuggestions.length || fileQuery?.kind === 'attach') && event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); setFileQuery(undefined); setKindQuery(undefined); return }
            if (activeSuggestionCount && (event.key === 'ArrowUp' || event.key === 'ArrowDown' || event.key === 'Home' || event.key === 'End')) {
              event.preventDefault(); event.stopPropagation()
              setActiveSuggestionIndex((current) => event.key === 'Home' ? 0 : event.key === 'End' ? activeSuggestionCount - 1 : (current + (event.key === 'ArrowDown' ? 1 : -1) + activeSuggestionCount) % activeSuggestionCount)
              return
            }
            if (kindQuery && kindSuggestions.length && (event.key === 'Enter' || event.key === 'Tab')) { event.preventDefault(); event.stopPropagation(); selectKind(kindSuggestions[selectedSuggestionIndex]); return }
            if (fileQuery?.kind === 'attach' && (event.key === 'Enter' || event.key === 'Tab')) {
              event.preventDefault(); event.stopPropagation()
              if (selectedSuggestionIndex === 1 && fileQuery.query.startsWith('/')) selectDirective({ value: fileQuery.query, label: fileQuery.query })
              else void pickAttachment()
              return
            }
            if (fileSuggestions.length && (event.key === 'Enter' || event.key === 'Tab')) { event.preventDefault(); event.stopPropagation(); selectDirective(fileSuggestions[selectedSuggestionIndex]); return }
            if (event.key !== 'Enter' || event.shiftKey) return
            event.preventDefault(); event.stopPropagation()
            if (planAdjustment) void submitMain()
            else if ((event.ctrlKey || event.metaKey) && taskInFlight) void submitComment()
            else void submitMain()
          }}
        />
        {/* Typing "@" alone, before any keyword exists, offers the directive
            kinds themselves — the operator does not have to already know and
            spell out @file/@ref/@attach to start one. */}
        {kindQuery && <ComposerDirectiveMenuLayer anchorRef={editorShellRef} className="kind" ariaLabel="Escolher tipo de referência">
          <header><span>@</span><small>Escolha o tipo de referência</small></header>
          {kindSuggestions.length ? kindSuggestions.map((suggestion, index) => <button type="button" role="option" aria-selected={index === selectedSuggestionIndex} key={suggestion.kind} onMouseDown={(event) => event.preventDefault()} onClick={() => selectKind(suggestion)}>
            <Icon name={directiveKindIcon(suggestion.kind)} size={12}/><span>@{suggestion.keyword}</span><small>{suggestion.label}{suggestion.aliases.length ? ` · ${suggestion.aliases.map((alias) => `@${alias}`).join(', ')}` : ''}</small>{index === 0 && <kbd>Enter</kbd>}
          </button>) : <p className="composer-attachment-empty">Nenhuma diretiva corresponde.</p>}
        </ComposerDirectiveMenuLayer>}
        {fileQuery && fileQuery.kind === 'attach' && <ComposerDirectiveMenuLayer anchorRef={editorShellRef} className="attach" ariaLabel="Anexar caminho externo"><header><span>@attach</span><small>Escolha um ficheiro ou pasta fora do projeto</small></header><button type="button" role="option" aria-selected={selectedSuggestionIndex === 0} onMouseDown={(event) => event.preventDefault()} onClick={() => void pickAttachment()}><Icon name="folder" size={12}/><span>Escolher pasta…</span><kbd>Enter</kbd></button>{fileQuery.query.startsWith('/') && <button type="button" role="option" aria-selected={selectedSuggestionIndex === 1} onMouseDown={(event) => event.preventDefault()} onClick={() => selectDirective({ value: fileQuery.query, label: fileQuery.query })}><Icon name="file" size={12}/><span>Usar {fileQuery.query}</span></button>}</ComposerDirectiveMenuLayer>}
        {fileQuery && fileQuery.kind !== 'attach' && <ComposerDirectiveMenuLayer anchorRef={editorShellRef} className={fileQuery.kind} ariaLabel={fileQuery.kind === 'ref' ? 'Referenciar outro projeto' : fileQuery.kind === 'see' ? 'Escolher fonte para destacar ficheiro ou diretório' : fileQuery.kind === 'todo' ? 'Referenciar TODO do projeto' : 'Localizar ficheiro do projeto'}><header><span>@{fileQuery.kind}</span><small>{directiveMenuHint(fileQuery, fileSuggestions.length, referenceableProjects.length)}</small></header>{fileSuggestions.map((suggestion, index) => <button type="button" role="option" aria-selected={index === selectedSuggestionIndex} key={`${suggestion.value}:${suggestion.label}`} onMouseDown={(event) => event.preventDefault()} onClick={() => selectDirective(suggestion)}><Icon name={suggestion.sourceIcon || (suggestion.continues ? 'workspace' : 'file')} size={12}/><span>{suggestion.label}</span>{suggestion.detail && <em>{suggestion.detail}</em>}{suggestion.continues && suggestion.attached === false && <small className="unattached">ainda não anexado</small>}{index === selectedSuggestionIndex && <kbd>Enter</kbd>}</button>)}</ComposerDirectiveMenuLayer>}
      </div>
      {openDirective && <ComposerDirectiveConfigPopover
        directive={openDirective.directive} anchor={openDirective.anchor}
        referenceAttached={isProjectAttached} seeTargetAvailable={isSeeTargetAvailable}
        onEdit={editDirective} onRemove={removeDirectiveChip} onClose={() => setOpenDirective(undefined)}
      />}
      </div>
      <div className="composer-footer">
        <div className="composer-toolbar-row"><div className="composer-action-row" aria-label="Opções da próxima iteração">
          {!compactComposer && <>
          <ArtifactToggle kind="context" label="Contexto ZIP" selected={selectedArtifacts.context} required={artifactRequired?.context} onToggle={onToggleArtifact} onInspect={setInspectedArtifact} inspectable={Boolean(artifactContent?.context)} />
          <ArtifactToggle kind="prompt" label="Prompt" selected={selectedArtifacts.prompt} required onToggle={onToggleArtifact} onInspect={setInspectedArtifact} inspectable={Boolean(artifactContent?.prompt)} />
          <ArtifactToggle kind="result" label="Resultado" selected={selectedArtifacts.result} disabled={!session.last_execution && !session.last_bundle} onToggle={onToggleArtifact} onInspect={setInspectedArtifact} inspectable={Boolean(artifactContent?.result)} />
          <ArtifactToggle kind="error" label="Erro" selected={selectedArtifacts.error} required={artifactRequired?.error} disabled={!session.last_repair_error && session.last_execution?.success !== false && !artifactRequired?.error} onToggle={onToggleArtifact} onInspect={setInspectedArtifact} inspectable={Boolean(artifactContent?.error)} />
          </>}
          <input ref={fileInputRef} type="file" multiple hidden onChange={(event) => addFiles(Array.from(event.target.files || []))}/>
          <button type="button" className={attachments.length ? 'composer-round-action selected' : 'composer-round-action'} disabled={!attachmentsEnabled || Boolean(preparedAttachmentCount)} onClick={() => fileInputRef.current?.click()} title={attachmentsEnabled ? `Ficheiros do utilizador${attachments.length ? ` · ${attachments.length} selecionado(s)` : ''}` : 'Anexos diretos requerem o Desktop com planner manual'} aria-label="Anexar ficheiros"><Icon name="file" size={12}/>{attachments.length > 0 && <b>{attachments.length}</b>}</button>
          {attachedPaths.length > 0 && <button type="button" className={attachmentsPanelOpen ? 'composer-round-action selected' : 'composer-round-action'} aria-pressed={attachmentsPanelOpen} onClick={() => { setAttachmentsPanelPath(undefined); setAttachmentsPanelKind('attach'); setAttachmentsPanelOpen((open) => !open) }} title="Escolher o que é enviado de cada caminho anexado" aria-label="Conteúdo dos caminhos anexados"><Icon name="folder" size={12}/><b>{attachedPaths.length}</b></button>}
          {!compactComposer && <>
          <span className="composer-action-divider" />
          <span className="context-channel-picker"><button type="button" className={`composer-round-action ${contextChannelOpen || effectiveTransport.disabledTunnelIds.length ? 'selected' : ''}`} aria-expanded={contextChannelOpen} aria-haspopup="menu" aria-label="Túneis do ChatGPT" title="Ligar ou desligar túneis; o bundle ZIP é sempre enviado" onClick={() => setContextChannelOpen((open) => !open)}><Icon name="network" size={12}/></button>{contextChannelOpen && <span className="context-channel-menu" role="menu" data-chatgpt-overlay-blocker="true"><strong>Canais remotos</strong><span className="transport-protocol-note"><Icon name="file" size={13}/><span>Bundle ZIP<small>Sempre incluído em qualquer requisição</small></span><Icon name="check" size={13}/></span><TransportChoices value={effectiveTransport} tunnels={tunnelInstances} onChoose={(next) => onChatTransport?.(next)}/>{chatTransport && <button type="button" className="transport-use-default" onClick={() => onChatTransport?.(undefined)}><Icon name="refresh" size={13}/><span>Usar padrão global<small>Repõe a seleção global dos túneis</small></span></button>}</span>}</span>
          <button type="button" className={`composer-round-action ${knowledgeSharingEnabled ? 'selected' : ''}`} disabled={busy || !onKnowledgeSharing} aria-pressed={knowledgeSharingEnabled} aria-label="Conhecimento do projeto" title={knowledgeSharingEnabled ? 'Conhecimento ligado · enviar e atualizar conhecimento incremental nesta requisição' : 'Conhecimento desligado · não enviar catálogo existente; novas aprendizagens continuam a ser recolhidas'} onClick={() => onKnowledgeSharing?.(!knowledgeSharingEnabled)}><Icon name="knowledge" size={12}/>{knowledgeSharingEnabled && <span className="artifact-dot" aria-hidden="true"/>}</button>
          <button type="button" className={`composer-round-action debug-mode ${session.debug_enabled ? 'selected' : ''}`} disabled={busy || !onDebugMode} aria-pressed={Boolean(session.debug_enabled)} aria-label="Modo interativo" title={session.debug_enabled ? 'Interativo ligado · observações seguras podem continuar automaticamente' : 'Interativo desligado · a primeira observação de cada pedido pedirá autorização'} onClick={() => onDebugMode?.(!session.debug_enabled)}><Icon name="code" size={12}/>{session.debug_enabled && <span className="artifact-dot" aria-hidden="true"/>}</button>
          <span className="composer-mode-group" role="group" aria-label="Proteção de execução">
            <button type="button" className={`composer-round-action mode-protected ${currentExecutionMode === 'protected' ? 'selected' : ''}`} disabled={busy || !onExecutionMode} aria-pressed={currentExecutionMode === 'protected'} aria-label="Protected" title="Protected · executar e verificar primeiro na sandbox" onClick={() => onExecutionMode?.('protected')}><Icon name="shield" size={12}/></button>
            <button type="button" className={`composer-round-action mode-unprotected ${currentExecutionMode === 'unprotected' ? 'selected' : ''}`} disabled={busy || !onExecutionMode || Boolean(session.self_evolution)} aria-pressed={currentExecutionMode === 'unprotected'} aria-label="Unprotected" title={session.self_evolution ? 'Unprotected indisponível · auto-evolução do Wharnex é sempre Protected' : 'Unprotected · executar diretamente no projeto real'} onClick={() => onExecutionMode?.('unprotected')}><Icon name="external" size={12}/></button>
          </span>
          <span className="composer-mode-group" role="group" aria-label="Automação de execução">
            <button type="button" className={`composer-round-action mode-manual ${currentAutomationMode === 'manual' ? 'selected' : ''}`} disabled={busy || !onAutomationMode} aria-pressed={currentAutomationMode === 'manual'} aria-label="Manual" title="Manual · executar e aplicar mudanças apenas por ação explícita" onClick={() => onAutomationMode?.('manual')}><Icon name="plan" size={12}/></button>
            <button type="button" className={`composer-round-action mode-auto ${currentAutomationMode === 'auto' ? 'selected' : ''}`} disabled={busy || !onAutomationMode} aria-pressed={currentAutomationMode === 'auto'} aria-label="Auto" title="Auto · mudanças válidas seguem Protected e são aplicadas após verificação" onClick={() => onAutomationMode?.('auto')}><Icon name="agent" size={12}/></button>
          </span>
          <label className="composer-effort-picker" title="Nível de esforço · limita tentativas automáticas e, a partir de Extra High, ativa melhoria contínua pós-sucesso">
            <span>Esforço</span>
            <select aria-label="Nível de esforço" value={currentEffortLevel} disabled={busy || !onEffortLevel} onChange={(event) => onEffortLevel?.(event.target.value as EffortLevel)}>
              <option value="low">Low · 1</option>
              <option value="medium">Medium · 3</option>
              <option value="high">High · 6</option>
              <option value="extra_high">Extra High · 10</option>
              <option value="max">Max · 15</option>
              <option value="ultra">Ultra · 30</option>
              <option value="loop">Loop · ∞</option>
            </select>
          </label>
          <label className="composer-effort-picker composer-reasoning-picker" title="Inteligência · define o esforço de raciocínio aplicado pelo ChatGPT antes de enviar este chat">
            <span>Inteligência</span>
            <select aria-label="Esforço de raciocínio" value={currentReasoningEffort} disabled={busy || !onReasoningEffort} onChange={(event) => onReasoningEffort?.(event.target.value as ReasoningEffort)}>
              <option value="instant">Instantâneo</option>
              <option value="medium">Médio</option>
              <option value="high">Elevado</option>
            </select>
          </label>
          <span className="composer-mode-group" role="group" aria-label="Transporte com o ChatGPT">
            <button type="button" className={`composer-round-action mode-scraper ${currentChatTransportMode === 'scraper' ? 'selected' : ''}`} disabled={busy || !onChatTransportMode} aria-pressed={currentChatTransportMode === 'scraper'} aria-label="Scraper" title="Scraper · o Wharnex interage diretamente com o ChatGPT" onClick={() => onChatTransportMode?.('scraper')}><Icon name="chatgpt" size={12}/></button>
            <button type="button" className={`composer-round-action mode-manual-transport ${currentChatTransportMode === 'manual' ? 'selected' : ''}`} disabled={busy || !onChatTransportMode} aria-pressed={currentChatTransportMode === 'manual'} aria-label="Manual (transporte)" title="Manual · copie o prompt e entregue o bundle de resposta manualmente" onClick={() => onChatTransportMode?.('manual')}><Icon name="clipboard" size={12}/></button>
          </span>
          <span className="composer-action-divider" />
          <button type="button" className={`composer-round-action ${bundlePreview ? 'selected' : ''}`} disabled={Boolean(planAdjustment) || !onPreviewBundle || bundlePreviewBusy || commentBusy || Boolean(preparedAttachmentCount) || (!message.trim() && !attachments.length)} aria-label="Pré-visualizar próximo bundle" title="Montar e explorar o próximo bundle sem enviar a request" onClick={() => void previewMainBundle()}><Icon name={bundlePreviewBusy ? 'refresh' : 'package'} size={12}/></button>
          <button type="button" className={`composer-round-action plan-first ${requestMode === 'plan_first' ? 'selected' : ''}`} disabled={Boolean(planAdjustment)} aria-pressed={requestMode === 'plan_first'} aria-label="Planificar antes de alterar" title={requestMode === 'plan_first' ? 'Plan first ativo · o Wharnex pedirá uma proposta e aguardará aprovação' : 'Planificar antes de alterar'} onClick={() => onRequestMode?.(requestMode === 'plan_first' ? 'direct' : 'plan_first')}><Icon name="plan" size={12}/></button>
          <button type="button" className={`composer-round-action ${queueOpen ? 'selected' : ''}`} aria-label="Fila de espera" title="Fila de requests principais" onClick={() => setQueueOpen((current) => !current)}><Icon name="clipboard" size={12}/>{queuedRequests.length > 0 && <b>{queuedRequests.length}</b>}</button>
          <button type="button" className={`composer-round-action ${todoOpen ? 'selected' : ''}`} aria-label="Tarefas TODO" title="Tarefas da iteração" disabled={!todos.length} onClick={() => setTodoOpen((current) => !current)}><Icon name="check" size={12}/>{todos.length > 0 && <b>{todos.filter((todo) => !todo.done).length}</b>}</button>
          {planAdjustment ? <span className="composer-comment-state plan-adjustment-state"><Icon name="edit" size={12}/> Ajuste do plano · use @see para referenciar a miniatura</span> : taskInFlight && <span className="composer-comment-state"><span className="comment-pulse"/><Icon name="chatgpt" size={12}/> Request ativa · Ctrl+Enter comenta</span>}
          </>}
        </div><button className="send-button" disabled={commentBusy || (planAdjustment ? !message.trim() : (!message.trim() && !attachments.length)) || Boolean(preparedAttachmentCount)} aria-label={planAdjustment ? 'Enviar ajuste do plano' : composerSendLabel || (taskInFlight ? 'Adicionar request à fila' : 'Enviar ao agente')} title={planAdjustment ? 'Enviar ajuste do plano' : composerSendLabel || (taskInFlight ? 'Adicionar à fila' : 'Enviar')}><Icon name="send" size={15}/></button></div>
        <div className="composer-hint">{planAdjustment ? 'Descreva o ajuste · @see pode referenciar o plano atual · Shift+Enter cria linha' : composerHint || (taskInFlight ? 'Enter adiciona à fila · Ctrl+Enter envia comentário · Shift+Enter cria linha' : requestMode === 'plan_first' ? 'Enter inicia a próxima request · Plan first aguarda aprovação' : 'Enter inicia a próxima request · Shift+Enter cria linha')}</div>
      </div>
    </form>

    {bundlePreview && <ComposerBundlePreviewExplorer sessionId={session.id} bundle={bundlePreview} onClose={closeBundlePreview} />}
    {inspectedArtifact && <ArtifactInspector kind={inspectedArtifact} content={artifactContent?.[inspectedArtifact] || 'Conteúdo ainda não disponível para esta iteração.'} onClose={() => setInspectedArtifact('')} />}
    {inspectedChangeFile && <DiffInspector sessionId={session.id} file={inspectedChangeFile} onOpenFile={onOpenFile} onClose={() => setInspectedChangeFile(undefined)} />}
  </section>
})

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

function ChatItemView({ item, copied, onCopy, onApprovePlan, onCorrectPlan, onRejectPlan, onInspectArtifact, onInspectChange, onOpenFile, onRevertChange, onReprocessPolicyBlock, canReprocessPolicyBlock, onRepairWithGPT, canRepairWithGPT, requiresOperatorGuidance, onRetryDependencyNetwork, canRetryDependencyNetwork, onRetryTransportFailure, onResendPendingRequest, onCancelPendingRequest, busy, taskInFlight, artifactContent, onInterviewChoice }: { item: ChatItem; copied: boolean; onCopy: (item: ChatItem) => Promise<void>; onApprovePlan?: (item: ChatItem) => Promise<void>; onCorrectPlan?: (item: ChatItem, guidance: string) => Promise<void>; onRejectPlan?: (item: ChatItem) => void; onInspectArtifact: (kind: ChatArtifactKind) => void; onInspectChange: (file: ChatChangeFile) => void; onOpenFile?: (path: string) => void; onRevertChange?: (item: ChatItem) => Promise<void>; onReprocessPolicyBlock?: () => Promise<void>; canReprocessPolicyBlock: boolean; onRepairWithGPT?: (detail: string) => Promise<void>; canRepairWithGPT: boolean; requiresOperatorGuidance: boolean; onRetryDependencyNetwork?: () => Promise<void>; canRetryDependencyNetwork: boolean; onRetryTransportFailure?: (requestId: string) => Promise<void>; onResendPendingRequest?: (requestId: string) => Promise<void>; onCancelPendingRequest?: (requestId: string) => Promise<void>; busy: boolean; taskInFlight: boolean; artifactContent?: Partial<Record<ChatArtifactKind, string>>; onInterviewChoice?: (interview: Interview, question: InterviewQuestion, option: { id: string; label: string }) => void }) {
  const [noticeBodyHydrated, setNoticeBodyHydrated] = useState(false)
  const source = chatItemSource(item)
  const presentation = item.presentation || 'message'
  const visibleText = item.role === 'harness' ? stripTodoSection(item.text) : item.text
  if (presentation === 'change' && item.change) return <ChangeSummaryCard item={item} onInspect={onInspectChange} onOpenFile={onOpenFile} onRevert={onRevertChange} />
  if (presentation === 'notice') return <details id={`chat-item-${item.id}`} className={`chat-notice notice-${source} notice-${item.turnKind || 'status'}`} onToggle={(event) => { if (event.currentTarget.open) setNoticeBodyHydrated(true) }}><summary onClick={() => setNoticeBodyHydrated(true)}><span className="notice-mark"><Icon name={noticeIcon(item)} size={12}/></span><strong>{source === 'chatgpt' ? 'ChatGPT' : 'WHX'}</strong><span className="notice-kind">{item.meta || item.turnKind || 'estado'}</span><span className="notice-summary">{compactNoticeText(visibleText)}</span><time dateTime={item.createdAt || ''}>{formatMessageTime(item.createdAt)}</time><Icon name="chevron-right" size={11}/></summary><div className="notice-content">{noticeBodyHydrated && <ExpandableMarkdown markdown={visibleText || 'Atualização da execução.'}/>}<div className="notice-actions">{canRepairWithGPT && onRepairWithGPT && isFailureNotice(item) && <button type="button" className="text-button" disabled={busy || taskInFlight} onClick={() => void requestGPTRepair(onRepairWithGPT, requiresOperatorGuidance)}><Icon name="agent" size={12}/> Corrigir com GPT</button>}{canRetryDependencyNetwork && onRetryDependencyNetwork && isFailureNotice(item) && <button type="button" className="text-button" disabled={busy} onClick={() => void onRetryDependencyNetwork()}><Icon name="network" size={12}/> Permitir rede e repetir</button>}{isPolicyBlockedNotice(item) && canReprocessPolicyBlock && onReprocessPolicyBlock && <button type="button" className="text-button" disabled={busy} onClick={() => void onReprocessPolicyBlock()}><Icon name="refresh" size={12}/> Reprocessar</button>}{isTransportFailureNotice(item) && item.iteration && onRetryTransportFailure && !requiresOperatorGuidance && <button type="button" className="text-button" disabled={busy || taskInFlight} title={taskInFlight ? 'Existe um pedido mais recente em processamento' : undefined} onClick={() => void onRetryTransportFailure(item.iteration!.requestId)}><Icon name="refresh" size={12}/> Retomar pedido</button>}{item.iteration && onResendPendingRequest && <button type="button" className="text-button" disabled={busy || taskInFlight} title={taskInFlight ? 'Existe um pedido mais recente em processamento' : 'Reenvia o mesmo pedido ao ChatGPT, caso o envio automático não tenha sido entregue'} onClick={() => void onResendPendingRequest(item.iteration!.requestId)}><Icon name="refresh" size={12}/> Reenviar request</button>}{item.iteration && onCancelPendingRequest && <button type="button" className="text-button danger" disabled={busy} onClick={() => void onCancelPendingRequest(item.iteration!.requestId)}><Icon name="close" size={12}/> Cancelar pedido</button>}</div>{item.iteration && <IterationReference item={item} onInspectArtifact={onInspectArtifact} artifactContent={artifactContent}/>}</div></details>
  if (presentation === 'thought') return <div className="chat-thought"><span className="thought-mark"><Icon name="agent" size={13}/></span><div><strong>Raciocínio visível do ChatGPT</strong><MarkdownContent markdown={visibleText}/>{item.meta && <span>{item.meta}</span>}</div></div>

  const label = source === 'user' ? 'Você' : source === 'chatgpt' ? 'ChatGPT' : 'Wharnex'
  return <article id={`chat-item-${item.id}`} tabIndex={-1} className={`message message-${source} ${presentation === 'plan' ? 'message-plan' : ''}`}>
    <div className="message-heading"><div className="message-label">{label}</div><div className="message-tools"><time dateTime={item.createdAt || ''}>{formatMessageTime(item.createdAt)}</time><button type="button" onClick={() => void onCopy(item)} title="Copiar mensagem" aria-label="Copiar mensagem"><Icon name={copied ? 'check' : 'copy'} size={12}/></button></div></div>
    <div className="message-body">{item.role === 'harness' ? <ExpandableMarkdown markdown={visibleText || 'Atualização de tarefas.'} /> : <ExpandableUserPrompt text={visibleText} />}</div>
    {item.interview && <InterviewCard interview={item.interview} disabled={busy || taskInFlight} onChoose={onInterviewChoice}/>}
    {item.attachments?.length ? <div className="message-attachments">{item.attachments.map((file, index) => <MessageAttachmentCard key={file.storageRef || `${file.name}-${file.size}-${index}`} attachment={file}/>)}</div> : null}
    {item.iteration && <IterationReference item={item} onInspectArtifact={onInspectArtifact} artifactContent={artifactContent} />}
    {(item.meta || (isPolicyBlockedNotice(item) && canReprocessPolicyBlock && onReprocessPolicyBlock)) && <div className="message-meta">{item.meta}{isPolicyBlockedNotice(item) && canReprocessPolicyBlock && onReprocessPolicyBlock && <button type="button" className="text-button" disabled={busy} onClick={() => void onReprocessPolicyBlock()}><Icon name="refresh" size={12}/> Reprocessar</button>}</div>}
    {item.approval && <div className={`plan-approval plan-${item.approval.status}`}>
      {item.approval.status === 'pending' ? <><div><Icon name="plan" size={13}/><span>Plano proposto · nenhuma alteração foi executada.</span></div><div><button type="button" className="text-button" onClick={() => onRejectPlan?.(item)}>Rejeitar</button><button type="button" className="text-button" onClick={() => void requestPlanCorrection(item, onCorrectPlan)}><Icon name="refresh" size={13}/> Solicitar correção</button><button type="button" className="apply-button" onClick={() => void onApprovePlan?.(item)}><Icon name="check" size={13}/> Aprovar e implementar</button></div></> : <span>{item.approval.status === 'approved' ? 'Plano aprovado para implementação.' : item.approval.status === 'superseded' ? 'Correção solicitada. Este plano foi substituído por uma nova proposta.' : 'Plano rejeitado. Nenhuma alteração foi iniciada.'}</span>}
    </div>}
  </article>
}

function InterviewCard({ interview, disabled, onChoose }: { interview: Interview; disabled: boolean; onChoose?: (interview: Interview, question: InterviewQuestion, option: { id: string; label: string }) => void }) {
  return <section className="plan-approval plan-pending" aria-label="Entrevista do Wharnex"><div><Icon name="chatgpt" size={13}/><span>Entrevista · escolha uma opção para preparar a resposta no compositor.</span></div>{interview.questions.map((question) => <div key={question.id}><strong>{question.prompt}</strong><div>{question.options.map((option) => <button type="button" className="text-button" key={option.id} disabled={disabled} onClick={() => onChoose?.(interview, question, option)}>{option.label}</button>)}</div></div>)}</section>
}

function ExpandableUserPrompt({ text }: { text: string }) {
  const [expanded, setExpanded] = useState(false)
  const collapsible = text.length > LONG_USER_PROMPT_CHARS || text.split('\n', LONG_USER_PROMPT_LINES + 1).length > LONG_USER_PROMPT_LINES
  const visibleText = collapsible && !expanded ? collapsedUserPromptPreview(text) : text
  return <div className={`chat-prompt-disclosure${collapsible ? ' collapsible' : ''}${expanded ? ' expanded' : ''}`}>
    <div className="chat-prompt-window">{visibleText}</div>
    {collapsible && <button type="button" className="chat-markdown-toggle chat-prompt-toggle" aria-expanded={expanded} onClick={() => setExpanded((current) => !current)}>
      <span aria-hidden="true">{expanded ? '−' : '···'}</span>{expanded ? 'Mostrar menos' : 'Expandir prompt'}
    </button>}
  </div>
}

function collapsedUserPromptPreview(text: string) {
  const firstLines = text.split('\n', LONG_USER_PROMPT_LINES + 1)
  const lineBounded = firstLines.length > LONG_USER_PROMPT_LINES ? firstLines.slice(0, LONG_USER_PROMPT_LINES).join('\n') : text
  const preview = lineBounded.slice(0, LONG_USER_PROMPT_CHARS).trimEnd()
  return `${preview}\n\n…`
}

function ExpandableMarkdown({ markdown }: { markdown: string }) {
  const [expanded, setExpanded] = useState(false)
  const collapsible = markdown.length > LONG_CHAT_MARKDOWN_CHARS || markdown.split('\n', LONG_CHAT_MARKDOWN_LINES + 1).length > LONG_CHAT_MARKDOWN_LINES
  const visibleMarkdown = collapsible && !expanded ? collapsedMarkdownPreview(markdown) : markdown
  return <div className={`chat-markdown-disclosure${collapsible ? ' collapsible' : ''}${expanded ? ' expanded' : ''}`}>
    <div className="chat-markdown-window"><MarkdownContent markdown={visibleMarkdown}/></div>
    {collapsible && <button type="button" className="chat-markdown-toggle" aria-expanded={expanded} onClick={() => setExpanded((current) => !current)}>
      <span aria-hidden="true">{expanded ? '−' : '···'}</span>{expanded ? 'Mostrar menos' : 'Expandir conteúdo'}
    </button>}
  </div>
}

function collapsedMarkdownPreview(markdown: string) {
  const firstLines = markdown.split('\n', LONG_CHAT_MARKDOWN_LINES + 1)
  const lineBounded = firstLines.length > LONG_CHAT_MARKDOWN_LINES ? firstLines.slice(0, LONG_CHAT_MARKDOWN_LINES).join('\n') : markdown
  const preview = lineBounded.slice(0, LONG_CHAT_MARKDOWN_CHARS).trimEnd()
  return `${preview}\n\n…`
}

function compactNoticeText(value: string) {
  const plain = value.replace(/```[\s\S]*?```/g, ' código ').replace(/\[([^\]]+)\]\([^)]+\)/g, '$1').replace(/[*_#>`~]/g, '').replace(/\s+/g, ' ').trim()
  if (!plain) return 'Atualização da execução.'
  return plain.length > 150 ? `${plain.slice(0, 147)}…` : plain
}

function isFailureNotice(item: ChatItem) {
  return item.iteration?.phase === 'failed' || item.iteration?.artifacts.includes('error') || /falh|erro|bloquead/i.test(item.meta || '')
}

async function requestPlanCorrection(item: ChatItem, onCorrectPlan?: (item: ChatItem, guidance: string) => Promise<void>) {
  if (!onCorrectPlan) return
  const guidance = await promptDialog({
    title: 'Solicitar correção do plano',
    message: 'Indique o que deve ser corrigido. O Wharnex manterá a mesma Main Request e pedirá apenas uma nova proposta de plano, sem executar alterações.',
    inputLabel: 'Correção pretendida',
    placeholder: 'Ex.: dividir a migração em duas fases e incluir rollback',
    confirmLabel: 'Solicitar correção',
    validate: (value) => value.trim() ? undefined : 'Descreva a correção pretendida.',
  })
  if (guidance === undefined) return
  await onCorrectPlan(item, guidance.trim())
}

async function requestGPTRepair(onRepairWithGPT: (detail: string) => Promise<void>, requiresOperatorGuidance: boolean) {
  const detail = await promptGPTRepairDetail(requiresOperatorGuidance)
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
    <header><div><span className="change-summary-icon"><Icon name="apply" size={14}/></span><div><strong>{change.reverted ? 'Alterações revertidas' : 'Alterações aplicadas'}</strong><span>{change.files.length} ficheiro(s) · {formatMessageTime(change.appliedAt)}</span></div></div><code>+{additions} <i>−{deletions}</i></code></header>
    {prioritizedFiles.length > 0 && <div className={`change-file-disclosure${hiddenCount ? ' collapsed' : ''}`}>
      <div className="change-file-list">{visibleFiles.map((file) => <div className={`change-file-row${isNormativeChangePath(file.path) ? ' normative' : ''}`} key={file.path}><button type="button" className="change-file-name" onClick={() => onOpenFile?.(file.path)} title="Abrir no Editor"><Icon name="file" size={12}/><span>{file.path}</span>{isNormativeChangePath(file.path) && <em>Normativo</em>}</button><button type="button" className="change-file-diff" onClick={() => onInspect(file)} title="Ver diff"><b>+{file.additions}</b><i>−{file.deletions}</i></button></div>)}</div>
      {prioritizedFiles.length > CHANGE_DIFF_PREVIEW_COUNT && <button type="button" className="change-file-toggle" aria-expanded={expanded} onClick={() => setExpanded((current) => !current)}><span aria-hidden="true">{expanded ? '−' : '···'}</span>{expanded ? 'Mostrar menos diffs' : `Mostrar mais ${hiddenCount} diff${hiddenCount === 1 ? '' : 's'}`}</button>}
    </div>}
    {hostCommands.length > 0 && <div className="change-host-commands"><strong>Comandos no host</strong>{hostCommands.map((command, index) => <div className="change-host-command" key={`${command.argv.join(' ')}-${index}`}><code>{command.argv.join(' ')}</code><span>{command.cwd || '.'} · exit {command.exit_code} · {command.duration_ms} ms</span></div>)}</div>}
    <footer><span>Plano {change.planId}</span>{change.canRevert && <button type="button" className="text-button change-revert" onClick={() => void onRevert?.(item)}><Icon name="refresh" size={12}/> {change.reverted ? 'Repor alteração' : 'Reverter alteração'}</button>}</footer>
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

// What the directive menu says when it has nothing to offer.
//
// "Nothing found" is the wrong answer to "@ref: in a workspace with one bound
// project": the operator has not made a mistake, there is simply nothing else
// bound yet, and saying so points at the action that fixes it.
function directiveMenuHint(query: DirectiveQuery, results: number, knownProjects: number) {
  if (results) {
    if (query.kind === 'ref') return 'Escolha um projeto já trabalhado ou um ficheiro dele'
    if (query.kind === 'see') return query.query.includes('|') ? 'Escolha o ficheiro ou diretório dentro desta fonte' : 'Primeiro escolha a fonte do caminho'
    if (query.kind === 'todo') return 'Escolha um TODO do projeto; pode referenciar vários no mesmo pedido'
    return 'Escolha um ficheiro do contexto'
  }
  if (query.kind === 'file') return 'Nenhum ficheiro elegível encontrado'
  if (query.kind === 'todo') return 'Nenhum TODO corresponde'
  if (query.kind === 'see') return query.query.includes('|') ? 'Nenhum ficheiro ou diretório desta fonte corresponde' : 'Nenhuma fonte com caminhos disponíveis neste pedido'
  if (!knownProjects) return 'Nenhum outro projeto conhecido por este Wharnex'
  return 'Nenhum projeto ou ficheiro corresponde'
}

/** Icon used for each directive kind in the insertion menu. */
function directiveKindIcon(kind: ComposerDirective['kind']) {
  if (kind === 'attach') return 'folder'
  if (kind === 'todo') return 'check'
  if (kind === 'file') return 'file'
  if (kind === 'see') return 'link'
  return 'workspace'
}
