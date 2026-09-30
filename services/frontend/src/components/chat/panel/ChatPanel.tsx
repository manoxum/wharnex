import { ChatNavigation } from './chatNavigation'
import { ChatTranscript } from './chatTranscript'
import { Fragment, forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState, type ForwardedRef, type FormEvent, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react'
import type { ArtifactRecord, ChatArtifactKind, ChatArtifactSelection, ChatChangeFile, ChatItem, ExecutionPlan, Interview, InterviewQuestion, ManagedArtifact, ChatFileRecord, ProjectTodo, Session } from '../../../types'
import { COMPOSER_MAX_HEIGHT, COMPOSER_MIN_HEIGHT, clearComposerDraft, flushComposerDraftSave, loadComposerDraft, loadComposerFileDraft, loadComposerStoredFileDraft, saveComposerFileDraft, saveComposerStoredFileDraft, scheduleComposerDraftSave, type ComposerStoredAttachmentDraft } from '../../../lib/chat/history/workspaceMemory'
import { Icon } from '../../presentation/chrome/Icon'
import { ExecutionModeControls } from '../../execution/controls/ExecutionModeControls'
import { ComposerPlanFirstControl, ComposerRequestControls } from '../composer/ComposerRequestControls'
import { ChatItemBoundary } from './ChatItemBoundary'
import { addChatAttachments, encodeChatAttachments, pastedTextChatFile, uniquifyPastedChatFiles } from '../../../lib/chat/attachments/chatAttachments'
import { ComposerAttachmentChip } from '../attachments/ChatAttachmentCard'
import { applyDirectiveKindSuggestion, applyDirectiveSuggestion, canonicalDirective, directiveKindQuery, directiveKindSuggestions, directiveQuery, directiveSuggestions, parseDirectives, removeDirective, seeDirectiveAvailable, type ComposerDirective, type DirectiveKindSuggestion, type DirectiveQuery, type ReferenceableProject } from '../../../lib/chat/composer/composerDirectives'
import { ComposerDirectiveConfigPopover, type DirectivePopoverAnchor } from '../composer/ComposerDirectiveConfigPopover'
import { ComposerRichEditor, type CaretRequest, type ComposerRichEditorHandle } from '../composer/ComposerRichEditor'
import { ComposerAttachmentPanel } from '../attachments/ComposerAttachmentPanel'
import { ComposerDirectiveMenuLayer, ComposerDirectiveOptionRows } from '../composer/ComposerDirectiveMenuLayer'
import { ComposerReferenceThumbnail } from '../attachments/ComposerReferenceThumbnail'
import { desktopBridge } from '../../../lib/desktop/bridge/desktop'
import { api } from '../../../lib/transport/http/api'
import { ComposerBundlePreviewExplorer, ReturnedArtifactGallery } from '../../artifacts/explorer/BundleExplorer'
import { useProgressiveChatHistory } from './useProgressiveChatHistory'
import { plannerDeclaredNonRetryable } from '../../../lib/execution/recovery/plannerRecovery'
import { ARTIFACT_INDEX_EVENT, artifactIndexMarker, type ArtifactIndexRequest } from '../../../lib/artifacts/bundles/artifactIndexing'
import { projectTodoPrePlanAttachment, storedAttachmentFile } from '../../../lib/project/context/projectTodoForwarding'
import { loadUIPreferences } from '../../../lib/workspace/preferences/uiPreferences'
import { composerDirectiveState } from '../../../lib/chat/composer/composerDirectiveIndex'
import { useComposerTaskDirectiveSuggestions } from '../../../lib/chat/composer/composerTaskDirectives'
import type { ChatPanelHandle } from './panelTypes'
import type { ChatPanelProps } from './panelTypes'
import { indexWhxNoticeRuns } from './noticePresentation'
import { isFailureNotice } from './noticePresentation'
import { canResendPreparedRequest } from './noticePresentation'
import { isLivePendingRequest } from './noticePresentation'
import { DiffInspector } from './changePresentation'
import { QueuePanel } from './auxiliaryPanels'
import { TodoPanel } from './auxiliaryPanels'
import { ArtifactInspector } from './auxiliaryPanels'
import { ChatItemView } from './chatItemView'
import { ArtifactToggle } from './artifactControls'
import { latestTodoSnapshot } from './todoSnapshot'
import { directiveMenuHint } from './directiveMenu'
import { directiveKindIcon } from './directiveMenu'

export type { ChatPanelHandle, ChatPanelProps } from './panelTypes'
const COMPOSER_TYPING_ATTENTION_MS = 1600
function clampComposerHeight(height: number) {
  return Math.min(COMPOSER_MAX_HEIGHT, Math.max(COMPOSER_MIN_HEIGHT, Math.round(height)))
}

// A identidade que o operador copia tem de nomear o contexto realmente
// transportado. Um workspace com projetos relacionados gera um hash proprio,
// por isso o hash do manifesto primario deixaria de identificar o que o planner leu.
function contextIdentityHash(session: Session) {
  return session.context.workspace_sha256 || session.context.manifest.sha256
}

export const ChatPanel = forwardRef<ChatPanelHandle, ChatPanelProps>(function ChatPanel({ session, items, chats, archivedChats, activeChatId, busy, embedded = false, hideSwitcher = false, composerOnly = false, compactComposer = false, composerPlaceholder, composerSendLabel, composerHint, historyViewportStore, executionMode, automationMode, effortLevel, reasoningEffort, chatTransportMode, attachmentsEnabled, preparedAttachmentCount, failedPromptDelivery, artifactSelection, artifactRequired, artifactContent, requestMode = 'direct', taskInFlight = false, queuedRequests = [], transportProgress = '', transportRequestId = '', onExecutionMode, onAutomationMode, onDebugMode, onEffortLevel, onReasoningEffort, onContextMode, onChatTransportMode, onKnowledgeSharing, onToggleArtifact, onRequestMode, onComposerTyping, onSend, onAdjustExecutionPlan, onPreviewBundle, onComment, onQueueEdit, onQueueMove, onQueueRemove, onQueueMerge, onQueuePromote, onApprovePlan, onCorrectPlan, onRejectPlan, onConfirmPrepared, onDismissPrepared, onRetryPreparedDelivery, onOpenFile, onRevertChange, onReprocessPolicyBlock, canReprocessPolicyBlock = false, onRepairWithGPT, canRepairWithGPT = false, onRetryDependencyNetwork, canRetryDependencyNetwork = false, onRetryTransportFailure, onResendPendingRequest, onCancelPendingRequest, onExportChat, onNewChat, onSelectChat, onSaveChat, onArchiveChat, onRestoreChat, onDeleteArchivedChat }, forwardedRef: ForwardedRef<ChatPanelHandle>) {
  const [initialDraft] = useState(() => loadComposerDraft(session.project_path, activeChatId))
  const [initialFileDraft] = useState(() => loadComposerFileDraft(session.project_path, activeChatId))
  const [message, setMessage] = useState(initialDraft.message)
  const [composerHeight, setComposerHeight] = useState(initialDraft.height)
  const [composerTypingAttention, setComposerTypingAttention] = useState(false)
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
  const [referenceInspectionCache, setReferenceInspectionCache] = useState<{ key: string; files: Record<string, string[]> }>({ key: '', files: {} })
  const [browsableProjectFiles, setBrowsableProjectFiles] = useState<string[]>([])
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
  const currentEffortLevel = effortLevel || session.effort_level || 'high'
  const currentReasoningEffort = reasoningEffort || session.reasoning_effort || 'high'
  const currentChatTransportMode = chatTransportMode || session.chat_transport_mode || 'scraper'
  const knowledgeSharingEnabled = session.knowledge_sharing_enabled !== false
  const composerProjectName = session.project_path.replace(/\\/g, '/').split('/').filter(Boolean).at(-1) || session.project_path
  const composerRef = useRef<HTMLFormElement>(null)
  const composerResizeRef = useRef<{ pointerId: number; startY: number; startHeight: number } | null>(null)
  const copiedResetTimerRef = useRef<number | null>(null)
  const composerTypingTimerRef = useRef<number | null>(null)
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
  const projectFileCandidates = browsableProjectFiles.length ? browsableProjectFiles : eligibleProjectFiles
  const directiveState = useMemo(() => composerDirectiveState(message), [message])
  const parsedDirectives = directiveState.parsed
  const canonicalReferenceDirectives = directiveState.indexed
  const indexedReferenceKey = useMemo(() => canonicalReferenceDirectives.filter((directive) => directive.kind === 'ref').map(canonicalDirective).join('\n'), [canonicalReferenceDirectives])
  const inspectedReferenceFiles = useMemo(() => referenceInspectionCache.key === indexedReferenceKey ? referenceInspectionCache.files : {}, [indexedReferenceKey, referenceInspectionCache])
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
    const withInspectedFiles = (project: ReferenceableProject) => {
      const inspected = inspectedReferenceFiles[project.name.toLowerCase()] || []
      if (!inspected.length) return project
      return { ...project, files: [...new Set([...project.files, ...inspected])] }
    }
    const attachedPaths = new Set(attachedProjects.map((project) => project.projectPath))
    const unattached = knownProjects
      .filter((project) => !attachedPaths.has(project.projectPath))
      .map((project) => withInspectedFiles({ name: project.name, projectPath: project.projectPath, files: [], attached: false }))
    const projects = [...attachedProjects.map(withInspectedFiles), ...unattached]
    const indexedNames = new Set(projects.map((project) => project.name.toLowerCase()))
    for (const directive of canonicalReferenceDirectives.filter((item) => item.kind === 'ref')) {
      const key = directive.project.toLowerCase()
      if (indexedNames.has(key)) continue
      projects.push(withInspectedFiles({ name: directive.project, projectPath: '', files: [], attached: false }))
      indexedNames.add(key)
    }
    return projects
  }, [attachedProjects, canonicalReferenceDirectives, inspectedReferenceFiles, knownProjects])
  useEffect(() => {
    let alive = true
    void api.knownProjects(session.id)
      .then((result) => { if (alive) setKnownProjects((result.projects || []).map((project) => ({ name: project.name, projectPath: project.project_path }))) })
      .catch(() => { if (alive) setKnownProjects([]) })
    return () => { alive = false }
  }, [session.id])
  const referenceExplorerNeeded = fileQuery?.kind === 'see' && Boolean(indexedReferenceKey)
  useEffect(() => {
    let alive = true
    if (!referenceExplorerNeeded) return () => { alive = false }
    // `@ref` can name a project Wharnex knows even before that project is
    // attached to this session. While @see is choosing a target, inspect the
    // already-indexed reference exactly as the request builder would so the
    // picker can drill into its admitted files and directories just like
    // @attach does, without making @see transport anything itself.
    const directives = parseDirectives(indexedReferenceKey).filter((directive) => directive.kind === 'ref')
    void Promise.all(directives.map(async (directive) => {
      try {
        const inspection = await api.referenceInspection(session.id, canonicalDirective(directive))
        return {
          project: directive.project.toLowerCase(),
          files: inspection.entries
            .filter((entry) => entry.status === 'included' && entry.kind === 'file' && entry.path !== 'EXPORTS.md')
            .map((entry) => entry.path),
        }
      } catch {
        return { project: directive.project.toLowerCase(), files: [] as string[] }
      }
    })).then((results) => {
      if (!alive) return
      const next: Record<string, string[]> = {}
      for (const result of results) next[result.project] = [...new Set([...(next[result.project] || []), ...result.files])]
      setReferenceInspectionCache({ key: indexedReferenceKey, files: next })
    })
    return () => { alive = false }
  }, [indexedReferenceKey, referenceExplorerNeeded, session.id])
  const projectExplorerNeeded = fileQuery?.kind === 'file' || (fileQuery?.kind === 'see' && canonicalReferenceDirectives.some((directive) => directive.kind === 'file'))
  useEffect(() => {
    if (!projectExplorerNeeded) return
    let alive = true
    // Browsing the whole safe tree is comparatively expensive and can trigger
    // unrelated async churn in the composer. Resolve it for @file, or for @see
    // only when an already-indexed @file source needs its scoped descendants;
    // the context manifest remains the fallback
    // everywhere else. listFiles already enforces project containment rules.
    void api.listFiles(session.id)
      .then((result) => { if (alive) setBrowsableProjectFiles((result.files || []).filter((entry) => entry.kind === 'file' && entry.path !== 'EXPORTS.md').map((entry) => entry.path)) })
      .catch(() => { if (alive) setBrowsableProjectFiles([]) })
    return () => { alive = false }
  }, [projectExplorerNeeded, session.id, session.context.manifest.sha256])
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
  const promptIndexByRequest = useMemo(() => {
    const index = new Map<string, number>()
    let prompt = 0
    for (const item of items) {
      if (item.role !== 'user') continue
      prompt += 1
      if (item.iteration?.requestId) index.set(item.iteration.requestId, prompt)
    }
    return index
  }, [items])
  const chatFileCandidates = useMemo(() => chatFiles.map((file) => {
    const promptIndex = file.request_id ? promptIndexByRequest.get(file.request_id) : undefined
    const promptPrefix = promptIndex ? `Prompt ${String(promptIndex).padStart(2, '0')} · ` : ''
    return {
      value: file.direct ? `artifact|${file.artifact_id}` : `entry|${file.artifact_id}|${file.path || ''}`,
      label: `${promptPrefix}${file.name}`,
      detail: file.source === 'attachment' ? 'Anexo enviado' : file.source === 'returned' ? 'Ficheiro devolvido' : file.direction,
    }
  }), [chatFiles, promptIndexByRequest])
  const libraryFileCandidates = useMemo(() => libraryArtifacts.map((item) => ({ value: `session|${item.session_id}|${item.artifact.id}`, label: item.artifact.name, detail: `${item.project_path} · ${item.artifact.kind}` })), [libraryArtifacts])
  const todoCandidates = useMemo(() => projectTodos.filter((todo) => todo.status === 'open').map((todo) => ({ value: todo.id, label: todo.body.slice(0, 90), detail: todo.execution_status === 'processing' ? 'Em execução' : todo.id })), [projectTodos])
  const taskSearch = useComposerTaskDirectiveSuggestions(session.id, fileQuery?.kind === 'task' ? fileQuery.query : undefined)
  const fileSuggestions = useMemo(() => fileQuery ? directiveSuggestions(fileQuery, projectFileCandidates, referenceableProjects, attachmentNames, attachedPathFiles, chatFileCandidates, libraryFileCandidates, todoCandidates, taskSearch.suggestions, canonicalReferenceDirectives) : [], [projectFileCandidates, fileQuery, referenceableProjects, attachmentNames, attachedPathFiles, chatFileCandidates, libraryFileCandidates, todoCandidates, taskSearch.suggestions, canonicalReferenceDirectives])
  const kindSuggestions = useMemo(() => kindQuery ? directiveKindSuggestions(kindQuery.query) : [], [kindQuery])
  const activeSuggestionCount = kindQuery
    ? kindSuggestions.length
    : fileQuery?.kind === 'attach'
      ? (fileQuery.query.startsWith('/') ? 2 : 1)
      : fileSuggestions.length
  const selectedSuggestionIndex = activeSuggestionCount ? Math.min(activeSuggestionIndex, activeSuggestionCount - 1) : 0
  useEffect(() => { setActiveSuggestionIndex(0) }, [fileQuery?.kind, fileQuery?.start, fileQuery?.end, fileQuery?.query, kindQuery?.start, kindQuery?.end, kindQuery?.query])
  const nextPromptIndex = useMemo(() => items.filter((item) => item.role === 'user').length + 1, [items])
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
  const isSeeTargetAvailable = (directive: ComposerDirective) => seeDirectiveAvailable(directive, projectFileCandidates, referenceableProjects, attachmentNames, attachedPathFiles, chatFileCandidates, libraryFileCandidates, todoCandidates, canonicalReferenceDirectives)
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
    setComposerTypingAttention(false)
    if (composerTypingTimerRef.current !== null) { window.clearTimeout(composerTypingTimerRef.current); composerTypingTimerRef.current = null }
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
    if (composerTypingTimerRef.current !== null) window.clearTimeout(composerTypingTimerRef.current)
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
    const indexedDirectives = [...new Map(parseDirectives(text).flatMap((item) => {
      if (item.kind === 'chat' || item.kind === 'lib' || item.kind === 'todo') return [item]
      if (item.kind !== 'see') return []
      if (item.value.startsWith('chat|')) {
        const [target] = parseDirectives(canonicalDirective({ kind: 'chat', value: item.value.slice('chat|'.length) }))
        return target ? [target] : []
      }
      if (item.value.startsWith('lib|')) {
        const [target] = parseDirectives(canonicalDirective({ kind: 'lib', value: item.value.slice('lib|'.length) }))
        return target ? [target] : []
      }
      return []
    }).map((item) => [`${item.kind}:${item.value}`, item] as const)).values()]
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
    addFiles(uniquifyPastedChatFiles(attachments, files, nextPromptIndex))
  }

  function pasteText(text: string) {
    if (!attachmentsEnabled) return false
    if (text.length < loadUIPreferences().largePasteThresholdChars) return false
    addFiles([pastedTextChatFile(attachments, text, nextPromptIndex)])
    return true
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
    if (textChanged) {
      setComposerTypingAttention(true)
      if (composerTypingTimerRef.current !== null) window.clearTimeout(composerTypingTimerRef.current)
      composerTypingTimerRef.current = window.setTimeout(() => {
        setComposerTypingAttention(false)
        composerTypingTimerRef.current = null
      }, COMPOSER_TYPING_ATTENTION_MS)
      onComposerTyping?.()
    }
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

  function focusComposerFromSurface(event: ReactPointerEvent<HTMLDivElement>) {
    if (event.button > 0 || preparedAttachmentCount) return
    const target = event.target
    if (!(target instanceof Element)) return
    if (target.closest('button, a, input, select, textarea, [contenteditable="true"], [data-directive-chip]')) return
    event.preventDefault()
    richEditorRef.current?.getEditor()?.focus()
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
    <ChatNavigation session={session} embedded={embedded} hideSwitcher={hideSwitcher} composerOnly={composerOnly} busy={busy} chats={chats} archivedChats={archivedChats} activeChatId={activeChatId} onExportChat={onExportChat} onNewChat={onNewChat} onRestoreChat={onRestoreChat} onSelectChat={onSelectChat} onSaveChat={onSaveChat} onArchiveChat={onArchiveChat} onDeleteArchivedChat={onDeleteArchivedChat} contextLabel={contextLabel} contextStateTone={contextStateTone} contextIdentityCopied={contextIdentityCopied} copyContextIdentity={copyContextIdentity} archiveOpen={archiveOpen} setArchiveOpen={setArchiveOpen} />
    <ChatTranscript composerOnly={composerOnly} busy={busy} taskInFlight={taskInFlight} whxNoticeRuns={whxNoticeRuns} expandedWhxNoticeRunId={expandedWhxNoticeRunId} setExpandedWhxNoticeRunId={setExpandedWhxNoticeRunId} renderChatEntry={renderChatEntry} afterHeight={afterHeight} beforeHeight={beforeHeight} endRef={endRef} hasOlder={hasOlder} hasNewer={hasNewer} hiddenItemCount={hiddenItemCount} hiddenNewerItemCount={hiddenNewerItemCount} loadOlder={loadOlder} loadNewer={loadNewer} onScroll={onHistoryScroll} streamRef={streamRef} visibleItems={visibleItems} />

    {!composerOnly && <>
      {failedPromptDelivery ? <div className="prepared-draft" role="status"><div><strong>{failedPromptDelivery.kind === 'storage' ? 'Armazenamento local sem espaço' : failedPromptDelivery.kind === 'attention' ? 'Ação necessária no ChatGPT' : 'Entrega ao ChatGPT pendente'}</strong><span>{failedPromptDelivery.kind === 'storage' ? 'O bundle foi preservado, mas o backend não consegue guardá-lo. Liberte espaço no disco e tente a ingestão novamente.' : failedPromptDelivery.kind === 'attention' ? 'A página abriu, mas o campo de escrita ainda não está disponível. Verifique login, verificação anti-robô ou avisos na aba ChatGPT.' : 'O mesmo prompt, contexto e anexos continuam disponíveis para uma nova tentativa.'}</span></div><button type="button" className="apply-button" disabled={busy} onClick={() => void onRetryPreparedDelivery?.(failedPromptDelivery.requestId)}><Icon name="refresh" size={14}/> {failedPromptDelivery.kind === 'storage' ? 'Tentar após liberar espaço' : failedPromptDelivery.kind === 'attention' ? 'Tentar depois de resolver' : 'Tentar entregar novamente'}</button></div> : null}
      {preparedAttachmentCount ? <div className="prepared-draft" role="status"><div><strong>Preparação enviada ao ChatGPT</strong><span>{preparedAttachmentCount} item(ns) de entrada preparados. O contexto é incluído automaticamente apenas quando necessário.</span></div><div><button type="button" className="text-button" onClick={onDismissPrepared}>Já enviei</button><button type="button" className="apply-button" disabled={busy} onClick={() => void onConfirmPrepared?.()}><Icon name="send" size={14}/> Confirmar e enviar</button></div></div> : null}
    </>}

    {queueOpen && queuedRequests.length > 0 && <QueuePanel requests={queuedRequests} editingId={editingQueueId} editingText={editingQueueText} onEditing={(id, text) => { setEditingQueueId(id); setEditingQueueText(text) }} onEditingText={setEditingQueueText} onSave={() => { if (editingQueueId && editingQueueText.trim()) onQueueEdit?.(editingQueueId, editingQueueText.trim()); setEditingQueueId('') }} onCancel={() => setEditingQueueId('')} onMove={onQueueMove} onRemove={onQueueRemove} onMerge={onQueueMerge} onPromote={onQueuePromote} onClose={() => setQueueOpen(false)} />}
    {todoOpen && todos.length > 0 && <TodoPanel todos={todos} onClose={() => setTodoOpen(false)} />}

    {transportProgress && <div className="context-publication-progress" role="status"><span className="publication-orbit"><i/><i/><i/></span><div className="context-publication-copy"><strong>A preparar rotas remotas</strong><small>{transportProgress}</small></div>{transportRequestId && onCancelPendingRequest ? <button type="button" className="text-button danger context-publication-cancel" aria-label="Cancelar preparação do bundle" onClick={() => void onCancelPendingRequest(transportRequestId)}><Icon name="close" size={12}/> Cancelar</button> : null}</div>}

    <form ref={composerRef} className={`composer ${composerTypingAttention ? 'composer-typing-attention' : ''} ${taskInFlight ? 'comment-mode' : ''} ${planAdjustment ? 'plan-adjustment-mode' : ''}`} style={{ height: composerHeight }} onSubmit={submitMain}>
      {composerTypingAttention && <span className="composer-project-attention" role="status" aria-live="polite" aria-label={`Projeto ativo: ${composerProjectName}`}><Icon name="workspace" size={11}/><span>A escrever em</span><strong title={session.project_path}>{composerProjectName}</strong></span>}
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
      {(attachments.length || canonicalReferenceDirectives.length) ? <div className="composer-attachments composer-reference-tray" aria-label="Conteúdo e referências da próxima iteração">
        {attachments.map((file) => <ComposerAttachmentChip key={`${file.name}-${file.size}-${file.lastModified}`} file={file} onRemove={() => persistAttachments(attachments.filter((item) => item !== file))}/>)}
        {canonicalReferenceDirectives.map((directive) => <ComposerReferenceThumbnail key={`${directive.kind}-${directive.start}-${directive.end}-${directive.value}`} session={session} directive={directive} attachments={attachments} chatFiles={chatFiles} libraryArtifacts={libraryArtifacts} projectTodos={projectTodos} orchestratorTasks={taskSearch.knownTasks} onRemove={() => removeDirectiveChip(directive)}/>)}
      </div> : null}
      {attachmentError && <div className="composer-error" role="alert">{attachmentError}</div>}
      {bundlePreviewError && <div className="composer-error" role="alert">{bundlePreviewError}</div>}
      {attachmentsPanelOpen && <ComposerAttachmentPanel sessionId={session.id} message={message} onMessage={(value) => { composerMessageRef.current = value; setMessage(value) }} initialPath={attachmentsPanelPath} initialKind={attachmentsPanelKind} onClose={() => { setAttachmentsPanelOpen(false); setAttachmentsPanelPath(undefined) }}/>}
      <div ref={editorShellRef} className="composer-editor-shell" onPointerDown={focusComposerFromSurface}>
        <ComposerRichEditor
          ref={richEditorRef} value={message} caret={pendingCaret} onChange={updateMessage}
          onClickDirective={openDirectivePopover} onConfigureDirective={configureDirective} onRemoveDirective={removeDirectiveChip}
          onPasteFiles={pasteFiles} onPasteText={pasteText} disabled={Boolean(preparedAttachmentCount)} lang="pt-PT"
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
        {fileQuery && fileQuery.kind !== 'attach' && <ComposerDirectiveMenuLayer anchorRef={editorShellRef} className={fileQuery.kind} ariaLabel={fileQuery.kind === 'ref' ? 'Referenciar outro projeto' : fileQuery.kind === 'see' ? 'Escolher fonte para destacar ficheiro ou diretório' : fileQuery.kind === 'todo' ? 'Referenciar TODO do projeto' : fileQuery.kind === 'task' ? 'Referenciar task concluída do Orchestrator' : 'Localizar ficheiro do projeto'}><header><span>@{fileQuery.kind}</span><small>{directiveMenuHint(fileQuery, fileSuggestions.length, referenceableProjects.length)}</small></header><ComposerDirectiveOptionRows suggestions={fileSuggestions} selectedIndex={selectedSuggestionIndex} onSelect={selectDirective} loading={fileQuery.kind === 'task' && taskSearch.loading} hasMore={fileQuery.kind === 'task' && taskSearch.hasMore} onLoadMore={() => void taskSearch.loadMore()}/></ComposerDirectiveMenuLayer>}
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
          <button type="button" className={`composer-round-action ${knowledgeSharingEnabled ? 'selected' : ''}`} disabled={busy || !onKnowledgeSharing} aria-pressed={knowledgeSharingEnabled} aria-label="Conhecimento do projeto" title={knowledgeSharingEnabled ? 'Conhecimento ligado · enviar e atualizar conhecimento incremental nesta requisição' : 'Conhecimento desligado · não enviar catálogo existente; novas aprendizagens continuam a ser recolhidas'} onClick={() => onKnowledgeSharing?.(!knowledgeSharingEnabled)}><Icon name="knowledge" size={12}/>{knowledgeSharingEnabled && <span className="artifact-dot" aria-hidden="true"/>}</button>
          <button type="button" className={`composer-round-action debug-mode ${session.debug_enabled ? 'selected' : ''}`} disabled={busy || !onDebugMode} aria-pressed={Boolean(session.debug_enabled)} aria-label="Modo interativo" title={session.debug_enabled ? 'Interativo ligado · observações seguras podem continuar automaticamente' : 'Interativo desligado · a primeira observação de cada pedido pedirá autorização'} onClick={() => onDebugMode?.(!session.debug_enabled)}><Icon name="code" size={12}/>{session.debug_enabled && <span className="artifact-dot" aria-hidden="true"/>}</button>
          <ExecutionModeControls mode={currentExecutionMode} busy={busy} selfEvolution={Boolean(session.self_evolution)} onChange={onExecutionMode} />
          <ComposerRequestControls
            automationMode={currentAutomationMode}
            effortLevel={currentEffortLevel}
            reasoningEffort={currentReasoningEffort}
            contextMode={session.context_mode || 'full'}
            chatTransportMode={currentChatTransportMode}
            busy={busy}
            onAutomationMode={onAutomationMode}
            onEffortLevel={onEffortLevel}
            onReasoningEffort={onReasoningEffort}
            onContextMode={onContextMode}
            onChatTransportMode={onChatTransportMode}
          />
          <span className="composer-action-divider" />
          <button type="button" className={`composer-round-action ${bundlePreview ? 'selected' : ''}`} disabled={Boolean(planAdjustment) || !onPreviewBundle || bundlePreviewBusy || commentBusy || Boolean(preparedAttachmentCount) || (!message.trim() && !attachments.length)} aria-label="Pré-visualizar próximo bundle" title="Montar e explorar o próximo bundle sem enviar a request" onClick={() => void previewMainBundle()}><Icon name={bundlePreviewBusy ? 'refresh' : 'package'} size={12}/></button>
          <ComposerPlanFirstControl requestMode={requestMode} disabled={Boolean(planAdjustment)} onRequestMode={onRequestMode} />
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
