import { createCodexComposerControls, dispatchNativeCodex, useNativeActivity, preparePlannerPrompt, transportPlannerContinuation as dispatchPlannerContinuation, useCodexInbox, recoverCodexContinuation, validatePlannerBundle, type ValidatedBundleSubmit } from '../../lib/codex'
import { WorkspaceSurfaceTabs } from '../../components/workspace/surfaces'
import { createChatSessionActions } from '../settings'
import { createRestartActions, useEventStreamConnection, canRetryDependencyNetwork, canRepairFailureWithGPT, recoveryHumanAction } from '../execution'
import { useWorkspaceAttention } from '../attention'
import { createBundleInboxDelivery, deferBundleRouting } from '../transport'
import { createTranscriptMutator, createTranscriptAppender, createActiveChatLifecycleActions, createChatCatalogActions, createQueueActions, createPlanProposalActions, hydrateChatTranscript, hydrateWorkspaceMemory, selectedArtifactKinds, continuationArtifactSelection, contextArtifact, sessionContextSHA, pendingBundleRequestIDs, iterationRef, turnMeta, welcomeItem, truncateRepairCause, chatGPTProjectName } from '../chat'
import { api, APIError, type LiveEventStream, type EventStreamCoalescer } from '../../lib/transport'
import { exportTraceChatItem, resolveExportTraceMetadata, BundleRoutingError, bundleFailureKind, isNonTerminalBundleRoutingError, expectedResponseBundleName } from '../../lib/artifacts'
import { isAutomaticAutomationMode, isAutoApproveAutomationMode, knowledgeConsolidationPending, requestChainActive, activePendingRequestId, pendingRequestRecoveryPrompt, sessionHasPendingRequest, sessionOwnsRequest, hasRecordedRequest, pendingDeliveryResumeOutcome } from '../../lib/agent'
import { Bootstrap, WorkspaceSideRail, type Drawer, WorkspaceTopbar, WorkbenchStatusBar, WorkspaceShell } from '../../components/workspace'
import { AgentWorkspace } from '../../components/agent'
import { ChatPanel } from '../../components/chat'
import { TerminalWorkspace } from '../../components/terminal'
import { executionQueueActiveCount, executionQueueIsActive, finishExecutionQueueItem, upsertExecutionQueueItem, visibleExecutionQueueItems, type ExecutionFIFOItem, appliedChangePresentationItems, mergeAppliedChangePresentationItems, plannerDeclaredNonRetryable, promptGPTRepairDetail, errorArtifact, executionArtifact, isRestartPending, type RestartReport, executionNeedsAttention, sessionNeedsExecutionConsent, clearSelfEvolutionBlockForRetry } from '../../lib/execution'
import { collectAttentionItems, summarizeAttention, type AttentionItem, type AttentionTarget, mergeAttentionItems, useAttentionNavigation, acknowledgeCompletedAttention, filterActiveAttentionItems, loadCompletedAttentionHistory } from '../../lib/attention'
import { orchestratorConclusionAttentionItems, shouldPublishNativeAttentionAfterBaseline } from '../../lib/orchestrator'
import { InterruptedExecutionRecovery, type InterruptedExecutionTarget, RestartConfirmation } from '../../components/execution'
import { DeferredEditorWorkspace } from '../../components/editor'
import { OrchestratorWorkspace } from '../../components/orchestrator'
import { AttentionPopover, ErrorToast } from '../../components/attention'
import { ProjectSettings } from '../../components/project'
import { Icon } from '../../components/presentation'
import { clearActiveWorkspace, deriveChatTitle, plannerChatTitle, loadActiveWorkspace, loadArchivedWorkspaceChats, loadSavedWorkspaceChats, loadChat, loadLegacyChat, loadAutomationMode, loadEffortLevel, loadRecentWorkspaces, loadWorkspaceChats, loadPendingProjectLaunch, loadPendingProjectPrompt, newWorkspaceChat, rememberRecent, reorderWorkspaceChats, restoreArchivedChat as restoreStoredChat, restoreSavedChat as restoreStoredSavedChat, saveActiveWorkspace, saveComposerDraft, saveComposerFileDraft, BOOTSTRAP_PROMPT_PREFIX, clearPendingProjectLaunch, clearPendingProjectPrompt, durableWorkspaceChat, saveAutomationMode, saveChat, saveEffortLevel, saveExecutionMode, saveWorkspaceChats, type ChatNaming, type WorkspaceChat, attachmentPromptSuffix, encodeChatAttachments, canonicalizeDirectives, projectFileReferenceSuffix, requiresProjectContextTransport, promptDeliveryFailureKind, type PromptDeliveryFailureKind, mergeDurableChatItems, activeChatBusy, contextIncrementMeta, contextIncrementNotice } from '../../lib/chat'
import { chatgptConversationURL, desktopBridge, isDesktop, sameChatGPTConversation, confirmDialog, subscribeHeaderPopover, buildDesktopTrayProjectState, dispatchDesktopTrayProjectAction } from '../../lib/desktop'
import { conflictAutoDispatchable, gitConflictChatTitle } from '../../lib/git'
import { embeddedProjectInitiallyActive, embeddedProjectPath, persistOperationalEvidence, storedAttachmentFile, withProjectTodoPrePlan, reconcileTunnelConfig } from '../../lib/project'
import { errorMessage as messageOf, loadWorkspaceRailLayout, moveWorkspaceTool, saveWorkspaceRailLayout, subscribeWorkspaceRailLayout, type WorkspaceRailSide, type WorkspaceTool, loadWorkbenchState, saveWorkbenchState, workspaceSurfaceKey, workspaceSurfaceRequest, workspaceSurfaceTarget as createWorkspaceSurfaceTarget, workspaceSurfaceURL, type WorkspaceSplitDirection, type WorkspaceSurfaceTarget } from '../../lib/workspace'
import { effortAttemptLimit } from '../agent'
import { useEmbeddedProjectBridge } from './useEmbeddedProjectBridge'
import { createSurfaceTransferActions } from './surfaces'
import { type ComponentProps, type PointerEvent as ReactPointerEvent, useCallback, useEffect, useRef, useState } from 'react'
import type { AppConfig, AutomationMode, EffortLevel, ChatArtifactKind, ChatArtifactSelection, ChatGPTActivity, ChatItem, ChatRequestMode, ChatTransportMode, QueuedChatRequest, ProjectTodo, ExecutionMode, EvolutionKnowledgeRef, HarnessEvent, Session, TerminalRunInput, TerminalRunRequest, WorkspaceMode } from '../../types'


type FrontendExecutionQueueItem = ExecutionFIFOItem

function requestAlreadyRecorded(projectPath: string, chatId: string, requestId: string, phases?: Parameters<typeof hasRecordedRequest>[2]) {
  return hasRecordedRequest(loadChat(projectPath, chatId), requestId, phases)
}

export default function App() {
  const embeddedProject = embeddedProjectPath()
  if (embeddedProject) return <ProjectApp embeddedProject={embeddedProject} />
  if (isDesktop()) return <WorkspaceShell />
  return <ProjectApp />
}

function ProjectApp({ embeddedProject = '' }: { embeddedProject?: string }) {
  const surfaceRequest = useRef(workspaceSurfaceRequest()).current
  const initialSurfaceTarget = useRef(surfaceRequest && embeddedProject ? createWorkspaceSurfaceTarget(embeddedProject, surfaceRequest) : undefined).current
  const activeAtLoad = embeddedProject ? undefined : loadActiveWorkspace()
  const [config, setConfig] = useState<AppConfig>()
  const [session, setSession] = useState<Session>()
  const [chats, setChats] = useState<WorkspaceChat[]>([])
  const [savedChats, setSavedChats] = useState<WorkspaceChat[]>([])
  const [archivedChats, setArchivedChats] = useState<WorkspaceChat[]>([])
  const [activeChatId, setActiveChatId] = useState(activeAtLoad?.chatId || '')
  const [items, setItems] = useState<ChatItem[]>([])
  const [events, setEvents] = useState<HarnessEvent[]>([])
  const [manualPrompt, setManualPrompt] = useState('')
  const [mode, setMode] = useState<WorkspaceMode>(surfaceRequest?.kind === 'editor' ? 'editor' : 'agent')
  const [executionMode, setExecutionMode] = useState<ExecutionMode>('protected')
  const [automationMode, setAutomationMode] = useState<AutomationMode>('auto')
  const [effortLevel, setEffortLevel] = useState<EffortLevel>('high')
  const [chatTransportMode, setChatTransportMode] = useState<ChatTransportMode>('scraper')
  const [recent, setRecent] = useState<string[]>(loadRecentWorkspaces())
  const [restoring, setRestoring] = useState(Boolean(activeAtLoad || embeddedProject))
  const [busy, setBusyState] = useState(false)
  const [busyOwnerChatId, setBusyOwnerChatId] = useState('')
  const [busyChats, setBusyChats] = useState<Record<string, boolean>>({})
  // Last known Session per chat. Switching chats is a local navigation — the
  // transcript, the draft and the tab state all live in localStorage — but it
  // used to block on a backend round trip (plus up to three mode PATCHes)
  // before the active chat id even changed, so a click on a tab did nothing
  // visible until the network answered. A cached session lets the switch land
  // immediately and revalidate in the background.
  const sessionCacheRef = useRef<Record<string, Session>>({})
  const [transportProgress, setTransportProgress] = useState('')
  const [chatgptHumanActions, setChatgptHumanActions] = useState<Record<string, DesktopChatGPTHumanAction>>({})
  const [chatgptAttentionNonce, setChatgptAttentionNonce] = useState(0)
  const [inspectorAttention, setInspectorAttention] = useState<{ tab: AttentionTarget; nonce: number }>({ tab: 'terminal', nonce: 0 })
  const [attentionPreviewOpen, setAttentionPreviewOpen] = useState(false)
  const [attentionHistoryState, setAttentionHistoryState] = useState<{ projectPath: string; items: AttentionItem[] }>({ projectPath: '', items: [] })
  // Bumped whenever a runtime task's "Ver orquestração" action lands the
  // operator in Orchestrator, so it always opens on the planning queue that
  // sent them there instead of whichever section was last left open.
  const [orchestratorFocusNonce, setOrchestratorFocusNonce] = useState(0)
  // Drawer geometry remains project-scoped, but the activity-rail ordering is
  // shared across projects so the IDE chrome stays structurally consistent.
  const initialWorkbench = useRef(loadWorkbenchState(embeddedProject)).current
  const [sideDrawer, setSideDrawer] = useState<Drawer>(() => initialWorkbench.left.open ? (initialWorkbench.left.tool as Drawer) : '')
  const [rightDrawer, setRightDrawer] = useState<Drawer>(() => initialWorkbench.right.open ? (initialWorkbench.right.tool as Drawer) : '')
  const [leftDrawerWidth, setLeftDrawerWidth] = useState(initialWorkbench.left.size)
  const [rightDrawerWidth, setRightDrawerWidth] = useState(initialWorkbench.right.size)
  const [railLayout, setRailLayout] = useState(() => loadWorkspaceRailLayout(embeddedProject))
  const workbenchProjectRef = useRef(embeddedProject)
  // The interactive terminal is the bottom tool window, so its visibility and
  // height participate in the same persisted workbench state.
  const [terminalOpen, setTerminalOpen] = useState(surfaceRequest?.kind === 'terminal' ? true : initialWorkbench.bottom.open)
  const [terminalHeight, setTerminalHeight] = useState(initialWorkbench.bottom.size)
  const [terminalRunRequest, setTerminalRunRequest] = useState<TerminalRunRequest>()
  const terminalRunNonceRef = useRef(0)
  const [error, setError] = useState<string>()
  const [errorChatRef, setErrorChatRef] = useState<{ chatId: string; itemId: string; message: string }>()
  const [preparedDrafts, setPreparedDrafts] = useState<Record<string, number>>({})
  const [failedPromptDeliveries, setFailedPromptDeliveries] = useState<Record<string, { kind: PromptDeliveryFailureKind; requestId: string }>>({})
  const [queuedRequestsByChat, setQueuedRequestsByChat] = useState<Record<string, QueuedChatRequest[]>>({})
  const queueDrainRef = useRef(false)
  const [projectSettingsOpen, setProjectSettingsOpen] = useState(false)
  const [restartModalOpen, setRestartModalOpen] = useState(false)
  const [restartReports, setRestartReports] = useState<RestartReport[]>([])
  // Orchestrator task sessions awaiting self-evolution activation, projected as chats.
  const [orchestratorRestart, setOrchestratorRestart] = useState<{ chats: WorkspaceChat[]; sessions: Record<string, Session> }>({ chats: [], sessions: {} })
  // A task that changed Wharnex itself reaches REVIEW with its restart pending
  // and has no chat on screen to offer it: its modal opens once per session.
  const announcedOrchestratorRestartsRef = useRef(new Set<string>())
  const [interruptedExecutions, setInterruptedExecutions] = useState<Array<{ chat: WorkspaceChat; session: Session }>>([])
  const [executionFIFO, setExecutionFIFO] = useState<FrontendExecutionQueueItem[]>([])
  const [editorOpenPath, setEditorOpenPath] = useState<string | undefined>(surfaceRequest?.kind === 'editor' ? surfaceRequest.path : undefined)
  const [editorOpenNonce, setEditorOpenNonce] = useState(surfaceRequest?.kind === 'editor' && surfaceRequest.path ? 1 : 0)
  const [explorerReveal, setExplorerReveal] = useState<{ path?: string; nonce: number }>({ nonce: 0 })
  const [splitSurface, setSplitSurface] = useState<{ direction: WorkspaceSplitDirection; target: WorkspaceSurfaceTarget; ratio: number }>()
  const [surfaceTabs, setSurfaceTabs] = useState<WorkspaceSurfaceTarget[]>(() => initialSurfaceTarget ? [initialSurfaceTarget] : [])
  const [activeSurfaceKey, setActiveSurfaceKey] = useState(() => initialSurfaceTarget ? workspaceSurfaceKey(initialSurfaceTarget) : '')
  const [hiddenSurfaceKeys, setHiddenSurfaceKeys] = useState<string[]>([])
  const [surfaceTabMenu, setSurfaceTabMenu] = useState<{ target: WorkspaceSurfaceTarget; x: number; y: number }>()
  const sourceRef = useRef<LiveEventStream | null>(null)
  // Owns the event stream's deduplication, retained window and flush/persist
  // cadence, so a catch-up burst costs a handful of renders instead of one
  // render (and one persisted window) per frame - see lib/eventStream.
  const coalescerRef = useRef<EventStreamCoalescer | undefined>(undefined)
  const [hostAppliedPresentation, setHostAppliedPresentation] = useState<{ eventId: string; sessionId: string; projectPath: string; chatId: string }>()
  const presentedHostAppliedEventsRef = useRef(new Set<string>())
  const activeChatIdRef = useRef(activeChatId)
  const baselineSeenRef = useRef(new Set<string>())
  const repairDispatchRef = useRef(new Set<string>())
  const chatIdBackfillRef = useRef(new Set<string>())
  const creatingChatRef = useRef(false)
  // Mirrors `busy` for the background maintenance interval, whose closure would
  // otherwise keep reading the value captured when the interval was installed.
  const busyRef = useRef(false)
  // Keep strict typecheck stable when a concurrent restage temporarily separates this ref from its consumer.
  void chatIdBackfillRef
  const resumedBundleKeysRef = useRef(new Set<string>())
  const livePromptDeliveryKeysRef = useRef(new Set<string>())
  const failedPromptDeliveryKeysRef = useRef(new Set<string>())
  const cancelledPromptDeliveryIdsRef = useRef(new Set<string>())
  const submitBundleFileRef = useRef<ValidatedBundleSubmit>(async () => '')
  const nativeCompletionBaselineRef = useRef(Date.now())
  const nativeNotificationIdsRef = useRef(new Set<string>())
  const bootstrapPromptInFlightRef = useRef(new Set<string>())
  const [bootstrapPromptRevision, setBootstrapPromptRevision] = useState(0)
  const [shellActive, setShellActive] = useState(() => embeddedProject ? embeddedProjectInitiallyActive() : true)
  const [boundProjects, setBoundProjects] = useState<string[]>(() => embeddedProject ? [embeddedProject] : [])
  const relatedProjectsSyncRef = useRef('')
  // A chat may be painted from its small synchronous cache while its durable
  // transcript is loading. Never let that cache overwrite the longer backend
  // history during this window.
  const transcriptReadyRef = useRef(new Set<string>())
  const transcriptMutationQueuesRef = useRef(new Map<string, Promise<void>>())
  const runInTerminal = useCallback((input: TerminalRunInput) => {
    terminalRunNonceRef.current += 1
    setTerminalOpen(true)
    setTerminalRunRequest({ ...input, id: terminalRunNonceRef.current, target: 'host', openNew: true })
  }, [])

  const resizeTerminal = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    event.preventDefault()
    const startY = event.clientY
    const startHeight = terminalHeight
    const maximum = Math.round(window.innerHeight * .78)
    const move = (pointer: PointerEvent) => setTerminalHeight(Math.max(185, Math.min(maximum, startHeight + startY - pointer.clientY)))
    const finish = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', finish)
      document.body.classList.remove('terminal-resizing')
    }
    document.body.classList.add('terminal-resizing')
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', finish, { once: true })
  }, [terminalHeight])

  useEffect(() => { setTerminalRunRequest(undefined) }, [session?.id])

  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key?.startsWith(BOOTSTRAP_PROMPT_PREFIX)) {
        bootstrapPromptInFlightRef.current.delete(event.key.slice(BOOTSTRAP_PROMPT_PREFIX.length))
        setBootstrapPromptRevision((value) => value + 1)
      }
    }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [])

  useEffect(() => {
    const projectPath = session?.project_path || ''
    setAttentionHistoryState({ projectPath, items: projectPath ? loadCompletedAttentionHistory(projectPath) : [] })
  }, [session?.project_path])

  useEffect(() => {
    if (!session || surfaceRequest) return
    workbenchProjectRef.current = ''
    const workbench = loadWorkbenchState(session.project_path)
    setSideDrawer(workbench.left.open ? (workbench.left.tool as Drawer) : '')
    setRightDrawer(workbench.right.open ? (workbench.right.tool as Drawer) : '')
    setLeftDrawerWidth(workbench.left.size)
    setRightDrawerWidth(workbench.right.size)
    setTerminalOpen(workbench.bottom.open)
    setTerminalHeight(workbench.bottom.size)
    setRailLayout(loadWorkspaceRailLayout(session.project_path))
    window.queueMicrotask(() => { workbenchProjectRef.current = session.project_path })
  }, [session?.project_path])

  useEffect(() => {
    if (!session || surfaceRequest || workbenchProjectRef.current !== session.project_path) return
    saveWorkbenchState(session.project_path, {
      version: 1,
      left: { open: Boolean(sideDrawer), collapsed: !sideDrawer, size: leftDrawerWidth, tool: sideDrawer || '' },
      right: { open: Boolean(rightDrawer), collapsed: !rightDrawer, size: rightDrawerWidth, tool: rightDrawer || 'database' },
      bottom: { open: terminalOpen, collapsed: !terminalOpen, size: terminalHeight },
    })
  }, [session?.project_path, sideDrawer, rightDrawer, leftDrawerWidth, rightDrawerWidth, terminalOpen, terminalHeight])


  const activeChatRecord = chats.find((chat) => chat.id === activeChatId)
  const activeChatOwnsSession = Boolean(activeChatRecord && session && activeChatRecord.sessionId === session.id)
  // Bundle delivery belongs to the workspace, not to whichever surface is
  // visible. Orchestrator/Editor can own the current session while Agent
  // workers finish in the background; disabling this listener in that state
  // leaves valid downloads stranded in Desktop's durable inbox until Agent is
  // opened again.
  const bundleRoutingReadyKey = session && chats.length > 0 ? `${session.project_path}:${chats.map((chat) => `${chat.id}:${chat.sessionId}`).join(',')}` : ''
  const chatgptHumanAction = chatgptHumanActions[activeChatId]
  const activeBusy = activeChatBusy({ activeChatId, busyChats, globalBusy: busy, globalBusyOwnerChatId: busyOwnerChatId })
  const pendingBootstrapLaunch = session ? loadPendingProjectLaunch(session.project_path) : undefined
  const pendingBootstrapPrompt = session ? loadPendingProjectPrompt(session.project_path) : ''
  const orchestratorBootstrapObjective = pendingBootstrapLaunch?.entryMode === 'orchestrator' ? pendingBootstrapPrompt.trim() : ''
  const acceptOrchestratorBootstrap = useCallback(() => {
    const projectPath = session?.project_path || ''
    if (!projectPath) return
    clearPendingProjectPrompt(projectPath)
    clearPendingProjectLaunch(projectPath)
    setBootstrapPromptRevision((value) => value + 1)
  }, [session?.project_path])

  function setBusy(value: boolean) {
    setBusyState(value)
    setBusyOwnerChatId(value ? activeChatIdRef.current : '')
  }

  useEffect(() => { activeChatIdRef.current = activeChatId }, [activeChatId])
  useEffect(() => {
    const bridge = desktopBridge()
    if (!bridge) return
    return bridge.windows.onSurfaceReceived(({ surface }) => {
      if (!session || surface.projectPath !== session.project_path) { setError('Não é possível mover tabs entre janelas de projetos diferentes.'); return }
      const target: WorkspaceSurfaceTarget = { projectPath: surface.projectPath, kind: surface.kind, ...(surface.chatId ? { chatId: surface.chatId } : {}), ...(surface.path ? { path: surface.path } : {}) }
      const key = workspaceSurfaceKey(target)
      setHiddenSurfaceKeys((current) => current.filter((item) => item !== key))
      if (surfaceRequest?.host === 'window') {
        setSurfaceTabs((current) => current.some((item) => workspaceSurfaceKey(item) === key) ? current : [...current, target])
        setActiveSurfaceKey(key)
      }
      void activateWorkspaceSurface(target)
    })
  }, [session?.project_path, session?.id, surfaceRequest?.host, activeChatId, chats])
  useEffect(() => {
    if (!surfaceTabMenu) return
    const close = () => setSurfaceTabMenu(undefined)
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') close() }
    document.addEventListener('pointerdown', close)
    document.addEventListener('keydown', escape)
    return () => { document.removeEventListener('pointerdown', close); document.removeEventListener('keydown', escape) }
  }, [surfaceTabMenu])
  useEffect(() => { busyRef.current = busy }, [busy])
  // Mirror whatever session is on screen into the per-chat cache, so every path
  // that establishes a session (open, restore, new chat, archive, an update
  // arriving mid-request) keeps the next switch to that chat instant, without
  // each of those call sites having to remember to populate it.
  useEffect(() => { if (activeChatOwnsSession && session && activeChatId) sessionCacheRef.current[activeChatId] = session }, [activeChatOwnsSession, session, activeChatId])

  const { attentionSessions, orchestratorConclusionState } = useWorkspaceAttention({ session, chats, activeChatId, activeChatOwnsSession, setOrchestratorRestart })

  useEffect(() => {
    if (!restartModalOpen || !session) return
    void refreshRestartReports().catch((reason) => setError(messageOf(reason)))
  }, [restartModalOpen, attentionSessions, activeChatId, chats, session?.id])

  useEffect(() => {
    const fresh = orchestratorRestart.chats.filter((chat) => !announcedOrchestratorRestartsRef.current.has(chat.sessionId))
    fresh.forEach((chat) => announcedOrchestratorRestartsRef.current.add(chat.sessionId))
    if (fresh.length && !restartModalOpen) void openRestartConfirmation(fresh[0].id)
  }, [orchestratorRestart])

  function setChatBusy(chatId: string, value: boolean) {
    setBusyChats((current) => {
      const next = { ...current }
      if (value) next[chatId] = true
      else delete next[chatId]
      return next
    })
  }

  const mutateChatItems = createTranscriptMutator({
    activeChat: () => activeChatIdRef.current, setItems,
    queueMutation: queueInactiveChatMutation,
  })

  const nativeThreads = useNativeActivity(session?.project_path || '', chats, mutateChatItems)
  const activeNativeThread = nativeThreads.find((thread) => thread.chatId === activeChatId)
  const nativeRequestActive = Boolean(activeNativeThread && ['submitting', 'running', 'waiting', 'attention'].includes(activeNativeThread.status))

  function queueInactiveChatMutation(chatId: string, projectPath: string, mutate: (current: ChatItem[]) => ChatItem[]) {
    const previous = transcriptMutationQueuesRef.current.get(chatId) || Promise.resolve()
    const queued = previous.then(async () => {
      const current = await hydrateChatTranscript(projectPath, chatId)
      const transcript = mutate(current)
      saveChat(projectPath, chatId, transcript)
      await api.replaceWorkspaceChatItems(chatId, transcript)
    }).catch(() => undefined).finally(() => {
      if (transcriptMutationQueuesRef.current.get(chatId) === queued) transcriptMutationQueuesRef.current.delete(chatId)
    })
    transcriptMutationQueuesRef.current.set(chatId, queued)
  }

  // Async work remains owned by the chat that started it. A self-evolution
  // Apply can take several minutes, during which the operator is free to
  // select another chat. Updating the screen's undifferentiated Session state
  // after that switch makes the new chat look like it owns the completed
  // request and was the root cause of a real cross-chat result delivery.
  function acceptSessionForChat(targetChat: WorkspaceChat, updated: Session) {
    sessionCacheRef.current[targetChat.id] = updated
    if (activeChatIdRef.current === targetChat.id) setSession(updated)
  }

  // Opening the stream replays the session's whole catch-up at once. Handling
  // one frame at a time made every frame its own React state update, and the
  // `setEvents` updater additionally persisted the entire 500-event window -
  // from inside the updater, which React is free to re-run for every queued
  // update on every render pass, so the cost was quadratic in the size of the
  // burst. One ordinary session's 3159-frame catch-up (4.7 MB) therefore
  // became thousands of 500-event JSON.stringify + localStorage writes: the
  // renderer's main thread never yielded (nothing could paint, no input was
  // handled) and its heap passed the V8 limit in ~25 s, which is the
  // `render-process-gone reason=crashed exitCode=133` restart loop. Frames are
  // coalesced into one batch per flush, the state update is a plain value, and
  // persistence is debounced and happens outside React's update queue.
  const appendChatItem = createTranscriptAppender({
    activeChat: () => activeChatIdRef.current, setItems, setChats,
    queueMutation: queueInactiveChatMutation,
  })

  const connectEvents = useEventStreamConnection({ sourceRef, coalescerRef, sessionCacheRef, activeChatIdRef, setEvents, setSession, setHostAppliedPresentation, setExecutionFIFO, appendChatItem })

  const persistChats = useCallback((projectPath: string, next: WorkspaceChat[]) => {
    const bounded = next.slice(0, 30)
    setChats(bounded)
    saveWorkspaceChats(projectPath, bounded)
    // The backend is the durable identity ledger. localStorage remains the
    // instant UI cache, but a renderer restart must never be able to strand a
    // Worker with a chat id the backend has never heard of.
    void Promise.allSettled(bounded.map((chat) => api.saveWorkspaceChat(durableWorkspaceChat(projectPath, chat))))
  }, [])


  useEffect(() => {
    let alive = true
    async function initialize() {
      // Nothing below this point reads `config` - it only feeds Bootstrap and
      // the main workspace props, both of which already treat it as optional
      // async state (it starts undefined on the very first render, before
      // this effect even runs). Awaiting it here served only to serialize a
      // network round-trip in front of the much slower workspace/session/
      // transcript hydration that follows; let it resolve in parallel.
      void api.config().then((value) => { if (alive) setConfig(value) }).catch((e) => { if (alive) setError(messageOf(e)) })

      if (embeddedProject) {
        try {
          await start(embeddedProject)
        } catch (e) { if (alive) setError(`Não foi possível abrir o workspace vinculado: ${messageOf(e)}`) }
        finally { if (alive) setRestoring(false) }
        return
      }
      const active = loadActiveWorkspace()
      if (!active) { if (alive) setRestoring(false); return }
      try {
        const hydrated = await hydrateWorkspaceMemory(active.projectPath)
        const known = hydrated.active
        const selected = known.find((chat) => chat.id === active.chatId) || known[0]
        const projectExecutionMode: ExecutionMode = 'protected'
        const projectAutomationMode: AutomationMode = loadAutomationMode(active.projectPath)
        const projectEffortLevel: EffortLevel = loadEffortLevel(active.projectPath)
        let restored: Session
        try {
          restored = await api.getSession(selected?.sessionId || active.sessionId)
          restored = await syncSessionModes(restored, projectExecutionMode, projectAutomationMode, projectEffortLevel)
        } catch (error) {
          if (!(error instanceof APIError) || error.status !== 404) throw error
          restored = await api.createSession(active.projectPath, projectExecutionMode, projectAutomationMode, undefined, projectEffortLevel)
        }
        if (!alive) return

        let nextChats = restored.project_path === active.projectPath ? hydrated.active : (await hydrateWorkspaceMemory(restored.project_path)).active
        if (!nextChats.length && known.length) nextChats = known
        let nextChat = nextChats.find((chat) => chat.id === selected?.id) || nextChats[0]
        if (!nextChat) {
          nextChat = newWorkspaceChat(restored.id, 'Chat principal')
          nextChats = [nextChat]
          const legacy = loadLegacyChat(restored.project_path)
          if (legacy.length) saveChat(restored.project_path, nextChat.id, legacy)
        } else if (nextChat.sessionId !== restored.id) {
          nextChat = { ...nextChat, sessionId: restored.id }
          nextChats = nextChats.map((chat) => chat.id === nextChat!.id ? nextChat! : chat)
        }
        const chatItems = await hydrateChatTranscript(restored.project_path, nextChat.id)
        transcriptReadyRef.current.add(nextChat.id)
        saveWorkspaceChats(restored.project_path, nextChats)
        setChats(nextChats); setSavedChats(restored.project_path === active.projectPath ? hydrated.saved : loadSavedWorkspaceChats(restored.project_path)); setArchivedChats(restored.project_path === active.projectPath ? hydrated.archived : loadArchivedWorkspaceChats(restored.project_path)); activeChatIdRef.current = nextChat.id; setActiveChatId(nextChat.id); setSession(restored)
        setMode('agent'); setExecutionMode(projectExecutionMode); setAutomationMode(projectAutomationMode); setEffortLevel(restored.effort_level || loadEffortLevel(restored.project_path)); setChatTransportMode(restored.chat_transport_mode || 'scraper'); setManualPrompt(restored.last_manual_prompt || '')
        setItems(chatItems.length ? chatItems : [welcomeItem(restored)])
        connectEvents(restored.id, restored.project_path, nextChat.id)
        saveActiveWorkspace({ sessionId: restored.id, projectPath: restored.project_path, mode: 'agent', chatId: nextChat.id, executionMode: projectExecutionMode, automationMode: projectAutomationMode, effortLevel: projectEffortLevel })
      } catch (e) {
		if (alive) setError(`Não foi possível reabrir o workspace: ${messageOf(e)} A sessão local foi preservada e será tentada novamente no próximo arranque.`)
      } finally { if (alive) setRestoring(false) }
    }
    void initialize()
    return () => { alive = false }
  }, [connectEvents, embeddedProject])

  useEffect(() => () => {
    sourceRef.current?.close(); sourceRef.current = null
    coalescerRef.current?.dispose(); coalescerRef.current = undefined
  }, [])

  useEffect(() => {
    if (!session || !activeChatOwnsSession) return
    if (!embeddedProject) saveActiveWorkspace({ sessionId: session.id, projectPath: session.project_path, mode, chatId: activeChatId || undefined, executionMode, automationMode, effortLevel })
    setRecent(loadRecentWorkspaces())
  }, [session, activeChatOwnsSession, mode, activeChatId, executionMode, automationMode, effortLevel, embeddedProject])


  useEffect(() => subscribeWorkspaceRailLayout(setRailLayout), [])

  useEffect(() => subscribeHeaderPopover((source) => {
    if (source !== 'attention') setAttentionPreviewOpen(false)
  }), [])

  useEmbeddedProjectBridge({ embeddedProject, shellActive, boundProjects, session, mode, relatedProjectsSyncRef, setShellActive, setBoundProjects, setMode, setProjectSettingsOpen, setAttentionPreviewOpen, setSession, setError })

  useEffect(() => {
    if (!session || !activeChatOwnsSession || !activeChatId || !items.length || !transcriptReadyRef.current.has(activeChatId)) return
    saveChat(session.project_path, activeChatId, items)
    void api.replaceWorkspaceChatItems(activeChatId, items).catch(() => undefined)
  }, [session, activeChatOwnsSession, activeChatId, items])

  useEffect(() => {
    // A session created before chat-id propagation existed (or one whose
    // creation call failed to attach it) permanently generates
    // "system"-scoped bundle filenames for every derived request, which can
    // never match this chat's real id and deterministically fails bundle
    // validation forever. Backfill it once the mismatch is noticed instead
    // of leaving that session stuck in an unrecoverable repair loop.
    if (!session || !activeChatId || session.chat_id === activeChatId) return
    // While a chat switch is in flight the active chat id has already changed
    // but the incoming session has not arrived yet, so `session` is still the
    // previous chat's. That is an expected transient, not an inconsistency:
    // only judge a session that is actually the one this chat points at.
    const owner = chats.find((chat) => chat.id === activeChatId)
    if (owner && owner.sessionId !== session.id) return
    if (session.chat_id) {
      setError(`Associação de chat inconsistente: esta sessão pertence ao chat ${session.chat_id} e não será reatribuída a ${activeChatId}. Reabra o chat original ou crie uma conversa nova.`)
      return
    }
    if (chatIdBackfillRef.current.has(session.id)) return
    chatIdBackfillRef.current.add(session.id)
    void api.setChatId(session.id, activeChatId).then((updated) => {
      if (activeChatIdRef.current === activeChatId) setSession(updated)
    }).catch(() => { chatIdBackfillRef.current.delete(session.id) })
  }, [session, activeChatId, chats])

  useEffect(() => {
	if (!session || !activeChatOwnsSession || !['repair_pending', 'baseline_update_pending', 'conflict_resolution_pending'].includes(session.state) || !isAutomaticAutomationMode(session.automation_mode) || !session.last_manual_prompt || !activeChatId) return
    const targetChat = chats.find((chat) => chat.id === activeChatId)
    if (!targetChat) return
	if (session.state === 'conflict_resolution_pending') { if (conflictAutoDispatchable(session)) void submitConflictPrompt(session, targetChat) }
	else if (session.state === 'repair_pending') void submitRepairPrompt(session, targetChat)
	else {
		const dispatchKey = `dispatch:${targetChat.id}:${session.last_request_id || session.id}`
		if (baselineSeenRef.current.has(dispatchKey)) return
		baselineSeenRef.current.add(dispatchKey)
		void transportPlannerContinuation(session, targetChat).catch((sendError) => {
			baselineSeenRef.current.delete(dispatchKey)
			setError(messageOf(sendError))
		})
	}
  }, [session, activeChatOwnsSession, activeChatId, chats])

  useEffect(() => {
    // The post-apply knowledge_review round is independent of session.state
    // on purpose (see PendingKnowledgeReviewRequestID in the backend): the
    // apply that triggered it already succeeded and state already reflects
    // that, so this is keyed on its own field instead of joining the
    // repair/conflict/baseline dispatch above, which would either compete
    // with those states or require "restoring" state afterward.
    if (!session || !activeChatOwnsSession || !session.pending_knowledge_review_request_id || !isAutomaticAutomationMode(session.automation_mode) || !session.last_manual_prompt || !activeChatId) return
    const targetChat = chats.find((chat) => chat.id === activeChatId)
    if (!targetChat) return
    const dispatchKey = `knowledge:${targetChat.id}:${session.pending_knowledge_review_request_id}`
    if (baselineSeenRef.current.has(dispatchKey)) return
    baselineSeenRef.current.add(dispatchKey)
    void transportPlannerContinuation(session, targetChat).catch((sendError) => {
      baselineSeenRef.current.delete(dispatchKey)
      setError(messageOf(sendError))
    })
  }, [session, activeChatOwnsSession, activeChatId, chats])

  async function syncSessionModes(value: Session, nextExecution: ExecutionMode, nextAutomation: AutomationMode, nextEffort: EffortLevel = effortLevel) {
    let current = value
    const currentAutomation = current.automation_mode || 'manual'
    if (isAutomaticAutomationMode(currentAutomation) && nextAutomation === 'manual') current = await api.setAutomationMode(current.id, 'manual')
    if (current.execution_mode !== nextExecution) current = await api.setExecutionMode(current.id, nextExecution)
    if ((current.automation_mode || 'manual') !== nextAutomation) current = await api.setAutomationMode(current.id, nextAutomation)
    if ((current.effort_level || 'medium') !== nextEffort) current = await api.setEffortLevel(current.id, nextEffort)
    return current
  }

  async function start(projectPath: string) {
    setBusy(true); setError(undefined)
    try {
      const projectExecutionMode: ExecutionMode = 'protected'
      const pendingLaunch = loadPendingProjectLaunch(projectPath)
      const projectAutomationMode: AutomationMode = pendingLaunch?.automationMode || loadAutomationMode(projectPath)
      const projectEffortLevel: EffortLevel = pendingLaunch?.effortLevel || loadEffortLevel(projectPath)
      const created = await api.createSession(projectPath, projectExecutionMode, projectAutomationMode, undefined, projectEffortLevel, pendingLaunch?.reasoningEffort || 'high')
      rememberRecent(created.project_path); setRecent(loadRecentWorkspaces())
      const hydrated = await hydrateWorkspaceMemory(created.project_path)
      let nextChats = hydrated.active
      let selected = (surfaceRequest?.kind === 'chat' && surfaceRequest.chatId ? nextChats.find((chat) => chat.id === surfaceRequest.chatId) : undefined) || nextChats[0]
      let selectedSession = created
      if (selected) {
        try {
          selectedSession = await api.getSession(selected.sessionId)
          selectedSession = await syncSessionModes(selectedSession, projectExecutionMode, projectAutomationMode, projectEffortLevel)
        }
        catch (error) {
          if (!(error instanceof APIError) || error.status !== 404) throw error
          selected = { ...selected, sessionId: created.id }
          nextChats = nextChats.map((chat) => chat.id === selected!.id ? selected! : chat)
        }
      } else {
        selected = newWorkspaceChat(created.id, 'Chat principal')
        nextChats = [selected]
        const legacy = loadLegacyChat(created.project_path)
        if (legacy.length) saveChat(created.project_path, selected.id, legacy)
      }
      if (pendingLaunch?.reasoningEffort && selectedSession.reasoning_effort !== pendingLaunch.reasoningEffort) {
        selectedSession = await api.setReasoningEffort(selectedSession.id, pendingLaunch.reasoningEffort)
      }
      if (pendingLaunch?.contextMode && selectedSession.context_mode !== pendingLaunch.contextMode) {
        selectedSession = await api.setContextMode(selectedSession.id, pendingLaunch.contextMode)
      }
      if (pendingLaunch?.chatTransportMode && selectedSession.chat_transport_mode !== pendingLaunch.chatTransportMode) {
        selectedSession = await api.setChatTransportMode(selectedSession.id, pendingLaunch.chatTransportMode)
      }
      const chatItems = await hydrateChatTranscript(created.project_path, selected.id)
      transcriptReadyRef.current.add(selected.id)
      persistChats(created.project_path, nextChats)
      setSavedChats(hydrated.saved); setArchivedChats(hydrated.archived); setSession(selectedSession); activeChatIdRef.current = selected.id; setActiveChatId(selected.id)
      setItems(chatItems.length ? chatItems : [welcomeItem(selectedSession)])
      setManualPrompt(selectedSession.last_manual_prompt || ''); setEvents([]); setMode(surfaceRequest?.kind === 'editor' ? 'editor' : (pendingLaunch?.entryMode === 'orchestrator' ? 'orchestrator' : 'agent')); setTerminalOpen(surfaceRequest?.kind === 'terminal' ? true : initialWorkbench.bottom.open); setExecutionMode(projectExecutionMode); setAutomationMode(projectAutomationMode); setEffortLevel(projectEffortLevel); setChatTransportMode(selectedSession.chat_transport_mode || 'scraper')
      connectEvents(selectedSession.id, selectedSession.project_path, selected.id)
    } catch (e) { setError(messageOf(e)) } finally { setBusy(false); setRestoring(false) }
  }

  async function createProject(parentPath: string, name: string) {
    setBusy(true); setError(undefined)
    try {
      const created = await api.createProject(parentPath, name)
      await start(created.project_path)
    } catch (e) { setError(messageOf(e)) } finally { setBusy(false) }
  }

  async function cloneProject(repositoryURL: string, parentPath: string, directory: string) {
    setBusy(true); setError(undefined)
    try {
      const cloned = await api.cloneProject(repositoryURL, parentPath, directory)
      await start(cloned.project_path)
    } catch (e) { setError(messageOf(e)) } finally { setBusy(false) }
  }

  // Bring another project to the front.
  //
  // Only the shell knows the window's project bindings and which window owns a
  // project, so this is a request to the shell rather than a decision taken
  // here. A non-embedded renderer has no shell to ask and no second project to
  // switch to, so it reports that rather than silently doing nothing.
  function focusProject(projectPath: string) {
    const target = String(projectPath || '').trim()
    if (!target || target === session?.project_path) return
    if (!embeddedProject) {
      setError('Trazer outro projeto para foco requer a janela do Wharnex Desktop.')
      return
    }
    window.parent.postMessage({ type: 'wharness:focus-project', projectPath: target }, window.location.origin)
  }

  function closeWorkspace() {
    if (embeddedProject) {
      window.parent.postMessage({ type: 'wharness:unbind-project', projectPath: session?.project_path || embeddedProject }, window.location.origin)
      return
    }
    sourceRef.current?.close(); sourceRef.current = null
    clearActiveWorkspace(); setSession(undefined); setChats([]); setArchivedChats([]); activeChatIdRef.current = ''; setActiveChatId(''); setProjectSettingsOpen(false)
    setEvents([]); setManualPrompt(''); setItems([]); setPreparedDrafts({}); setFailedPromptDeliveries({}); setError(undefined); setRecent(loadRecentWorkspaces())
  }

  async function newChat(initialMessage = '') {
    // Deliberately does not gate on the shared `busy` flag: that flag also
    // covers unrelated in-flight work in OTHER chats (send, apply, retry,
    // ...), and blocking new-chat creation on those left "Novo chat"
    // silently doing nothing while any other chat was merely processing.
    // Each chat owns an independent backend session, so creating one has no
    // actual conflict with another chat's in-flight request. A dedicated
    // ref still debounces a genuine double-click of this same action.
    if (!session || creatingChatRef.current) return
    creatingChatRef.current = true
    setError(undefined)
    // Hide the outgoing native surface at click time, before the backend
    // round-trip that creates the next Session. Otherwise a transport already
    // preparing this chat can keep painting over the local UI after the user
    // has expressed the switch, making correctly-owned input look as though it
    // were being typed into the new chat.
    hideChatGPTSurfaces(chats.find((chat) => chat.id === activeChatIdRef.current))
    try {
      const chatId = crypto.randomUUID()
      const created = await api.createSession(session.project_path, executionMode, automationMode, chatId, effortLevel)
      const chat = newWorkspaceChat(created.id, 'Novo chat', chatId)
      await api.saveWorkspaceChat(durableWorkspaceChat(created.project_path, chat))
      if (initialMessage.trim()) saveComposerDraft(created.project_path, chat.id, { message: initialMessage.trim(), height: 156 })
      const next = [chat, ...chats]
      persistChats(created.project_path, next)
      transcriptReadyRef.current.add(chat.id)
      activeChatIdRef.current = chat.id; setActiveChatId(chat.id); setSession(created); setItems([welcomeItem(created)])
      setEvents([]); setManualPrompt(''); setChatTransportMode(created.chat_transport_mode || 'scraper'); if (initialMessage.trim()) setMode('agent'); connectEvents(created.id, created.project_path, chat.id)
    } catch (e) { setError(messageOf(e)) } finally { creatingChatRef.current = false }
  }

  async function promoteTodoToChat(todo: ProjectTodo) {
    if (!session || creatingChatRef.current) return
    creatingChatRef.current = true
    setError(undefined)
    try {
      const bridge = desktopBridge()
      const files: File[] = []
      for (const attachment of todo.attachments || []) {
        if (!bridge) throw new Error('Recuperar anexos do TODO requer o Wharnex Desktop.')
        const stored = await bridge.attachments.read({ storageRef: attachment.storage_ref })
        files.push(storedAttachmentFile(stored, attachment.mime || 'application/octet-stream'))
      }
      const forwardedFiles = withProjectTodoPrePlan(todo, files)
      const chatId = crypto.randomUUID()
      const created = await api.createSession(session.project_path, executionMode, automationMode, chatId, effortLevel)
      const title = `TODO · ${deriveChatTitle(todo.body)}`
      const chat = newWorkspaceChat(created.id, title, chatId)
      await api.saveWorkspaceChat(durableWorkspaceChat(created.project_path, chat))
      saveComposerDraft(created.project_path, chat.id, { message: `@{[todo]${todo.id}} ${todo.body}`, height: 156 })
      saveComposerFileDraft(created.project_path, chat.id, { attachments: forwardedFiles, projectFiles: todo.project_files || [] })
      const next = [chat, ...chats]
      persistChats(created.project_path, next)
      transcriptReadyRef.current.add(chat.id)
      activeChatIdRef.current = chat.id; setActiveChatId(chat.id); setSession(created); setItems([welcomeItem(created)])
      setEvents([]); setManualPrompt(''); setChatTransportMode(created.chat_transport_mode || 'scraper'); setMode('agent'); connectEvents(created.id, created.project_path, chat.id)
    } catch (reason) { setError(messageOf(reason)) } finally { creatingChatRef.current = false }
  }

  async function promoteTodoToCurrentChat(todo: ProjectTodo) {
    if (!session || !activeChatId) return
    const marker = `@{[todo]${todo.id}} ${todo.body}`
    window.dispatchEvent(new CustomEvent('wharnex:todo-insert', { detail: { chatId: activeChatId, text: marker } }))
  }

  async function locateTodoChat(chatId: string) {
    setMode('agent')
    if (chatId === activeChatId) return
    if (chats.some((chat) => chat.id === chatId)) {
      await selectChat(chatId)
      return
    }
    if (savedChats.some((chat) => chat.id === chatId)) {
      await restoreSavedChat(chatId)
      return
    }
    if (archivedChats.some((chat) => chat.id === chatId)) {
      await restoreArchivedChat(chatId)
      return
    }
    setError('O chat associado a este TODO já não está disponível.')
  }

  async function exportActiveChat() {
    if (!session || !activeChatId || activeBusy) return
    const target = chats.find((chat) => chat.id === activeChatId)
    if (!target || target.sessionId !== session.id) return
    setChatBusy(target.id, true); setError(undefined)
    try {
      const metadata = await resolveExportTraceMetadata(session, { kind: 'chat' })
      const exported = await api.exportChat(session.id, {
        chat_id: target.id,
        title: target.title,
        chatgpt_url: target.chatgptUrl,
        chat_items: [exportTraceChatItem(metadata), ...items],
        frontend_events: events,
      })
      const url = URL.createObjectURL(exported.blob)
      const link = document.createElement('a')
      link.href = url; link.download = exported.filename; link.style.display = 'none'
      document.body.appendChild(link); link.click(); link.remove()
      window.setTimeout(() => URL.revokeObjectURL(url), 0)
    } catch (e) { setError(messageOf(e)) } finally { setChatBusy(target.id, false) }
  }

  const { archiveChat, saveChatForLater } = createActiveChatLifecycleActions({ session, busy, chats, activeChatId, executionMode, automationMode, effortLevel, resumedBundleKeysRef, sessionCacheRef, activeChatIdRef, transcriptReadyRef, sourceRef, setBusy, setError, setArchivedChats, setSavedChats, setChats, setExecutionFIFO, setPreparedDrafts, setFailedPromptDeliveries, persistChats, setActiveChatId, setEvents, setItems, setManualPrompt, setSession, syncSessionModes, connectEvents })

  async function restoreSavedChat(chatId: string) {
    if (!session || busy) return
    const target = savedChats.find((chat) => chat.id === chatId)
    if (!target) return
    setBusy(true); setError(undefined)
    try {
      const projectPath = session.project_path
      await api.setWorkspaceChatSaved(chatId, false)
      const moved = restoreStoredSavedChat(projectPath, chatId)
      let selected = moved.active.find((chat) => chat.id === chatId) || target
      let restored: Session
      try {
        restored = await api.getSession(selected.sessionId)
        restored = await syncSessionModes(restored, executionMode, automationMode)
      } catch (error) {
        if (!(error instanceof APIError) || error.status !== 404) throw error
        restored = await api.createSession(projectPath, executionMode, automationMode, undefined, effortLevel)
        selected = { ...selected, sessionId: restored.id, updatedAt: new Date().toISOString(), savedAt: undefined }
        moved.active = moved.active.map((chat) => chat.id === selected.id ? selected : chat)
        saveWorkspaceChats(projectPath, moved.active)
      }
      sourceRef.current?.close(); sourceRef.current = null
      const chatItems = await hydrateChatTranscript(projectPath, selected.id)
      transcriptReadyRef.current.add(selected.id)
      setChats(moved.active); setSavedChats(moved.saved); activeChatIdRef.current = selected.id; setActiveChatId(selected.id); setSession(restored); setEvents([])
      setManualPrompt(restored.last_manual_prompt || '')
      setItems(chatItems.length ? chatItems : [welcomeItem(restored)])
      connectEvents(restored.id, restored.project_path, selected.id)
    } catch (e) { setError(messageOf(e)) } finally { setBusy(false) }
  }

  const { archiveSavedChat, deleteArchivedChat, renameWorkspaceChat, generateWorkspaceChatTitle } = createChatCatalogActions({ session, busy, chats, savedChats, archivedChats, setBusy, setError, setChats, setSavedChats, setArchivedChats })

  async function restoreArchivedChat(chatId: string) {
    if (!session || busy) return
    const target = archivedChats.find((chat) => chat.id === chatId)
    if (!target) return
    setBusy(true); setError(undefined)
    try {
      const projectPath = session.project_path
      const moved = restoreStoredChat(projectPath, chatId)
      // Clearing the durable archive flag is the counterpart of setting it: a
      // generic save can no longer do it, so restoring has to say so explicitly.
      try { await api.setWorkspaceChatArchived(chatId, false) } catch { /* retried on the next archive/restore */ }
      let selected = moved.active.find((chat) => chat.id === chatId) || target
      let restored: Session
      try {
        // Not best-effort here, unlike archiveChat: once the session has
        // been compacted (ADR-0031) this is the call that actually extracts
        // its artifacts/logs back into place, so a failure means real data
        // didn't come back and must surface to the user.
        restored = await api.restoreChat(selected.sessionId)
        restored = await syncSessionModes(restored, executionMode, automationMode)
      } catch (error) {
        if (!(error instanceof APIError) || error.status !== 404) throw error
        restored = await api.createSession(projectPath, executionMode, automationMode, undefined, effortLevel)
        selected = { ...selected, sessionId: restored.id, updatedAt: new Date().toISOString() }
        moved.active = moved.active.map((chat) => chat.id === selected.id ? selected : chat)
        saveWorkspaceChats(projectPath, moved.active)
      }
      sourceRef.current?.close(); sourceRef.current = null
      const chatItems = await hydrateChatTranscript(projectPath, selected.id)
      transcriptReadyRef.current.add(selected.id)
      setChats(moved.active); setArchivedChats(moved.archived); activeChatIdRef.current = selected.id; setActiveChatId(selected.id); setSession(restored); setEvents([])
      setManualPrompt(restored.last_manual_prompt || '')
      setItems(chatItems.length ? chatItems : [welcomeItem(restored)])
      connectEvents(restored.id, restored.project_path, selected.id)
    } catch (e) { setError(messageOf(e)) } finally { setBusy(false) }
  }

  // Applies a restored session to the visible workspace, but only while the
  // chat it belongs to is still the one on screen. A slow round trip for a chat
  // the user has already switched away from must never overwrite the chat they
  // are now looking at.
  const applyRestoredSession = useCallback((chatId: string, restored: Session) => {
    sessionCacheRef.current[chatId] = restored
    if (activeChatIdRef.current !== chatId) return
    setSession(restored)
    setManualPrompt(restored.last_manual_prompt || '')
    setChatTransportMode(restored.chat_transport_mode || 'scraper')
    setItems((current) => current.length ? current : [welcomeItem(restored)])
  }, [])

  async function selectChat(chatId: string) {
    if (!session || chatId === activeChatIdRef.current) return
    const projectPath = session.project_path
    const availableChats = chats.some((chat) => chat.id === chatId) ? chats : loadWorkspaceChats(projectPath)
    const selected = availableChats.find((chat) => chat.id === chatId)
    if (!selected) return
    if (availableChats !== chats) setChats(availableChats)
    setError(undefined)

    // A WebContentsView is native and sits above React. Hide the outgoing
    // owner before changing the local tab, so a still-running upload/write can
    // continue only in its hidden, correctly-owned surface while the selected
    // chat gets its own Supervisor slot.
    hideChatGPTSurfaces(availableChats.find((chat) => chat.id === activeChatIdRef.current))

    // Land the visual switch first, from local state only. Everything the user
    // perceives on a chat switch — the active tab, the transcript, the composer
    // draft — is already on this machine.
    sourceRef.current?.close(); sourceRef.current = null
    transcriptReadyRef.current.delete(chatId)
    activeChatIdRef.current = chatId
    setActiveChatId(chatId)
    setEvents([])
    setItems(loadChat(projectPath, chatId))
    const transcriptPromise = hydrateChatTranscript(projectPath, chatId)

    const cached = sessionCacheRef.current[chatId]
    if (cached && cached.id === selected.sessionId) {
      // Known session: show it now and revalidate behind the switch.
      setSession(cached)
      setManualPrompt(cached.last_manual_prompt || '')
      setChatTransportMode(cached.chat_transport_mode || 'scraper')
      setItems((current) => current.length ? current : [welcomeItem(cached)])
      connectEvents(cached.id, projectPath, chatId)
    } else {
      setChatBusy(chatId, true)
    }

    try {
      let restored: Session
      try {
        restored = await api.getSession(selected.sessionId)
        restored = await syncSessionModes(restored, executionMode, automationMode)
      } catch (error) {
        if (!(error instanceof APIError) || error.status !== 404) throw error
        restored = await api.createSession(projectPath, executionMode, automationMode, undefined, effortLevel)
        // The backend canonicalizes the project path, so persist under the path
        // the replacement session actually reports.
        const next = availableChats.map((chat) => chat.id === chatId ? { ...chat, sessionId: restored.id } : chat)
        persistChats(restored.project_path, next)
        setChats(next)
      }
      const wasCached = Boolean(cached && cached.id === selected.sessionId)
      applyRestoredSession(chatId, restored)
      const hydratedItems = await transcriptPromise
      transcriptReadyRef.current.add(chatId)
      if (activeChatIdRef.current === chatId) setItems((current) => {
        const merged = mergeDurableChatItems(current, hydratedItems)
        return merged.length ? merged : [welcomeItem(restored)]
      })
      // A cached switch already opened its stream against the same session id;
      // reopening it would drop and recreate a healthy connection. connectEvents
      // closes and replaces any stream it finds, so it is the only thing that
      // needs to run here.
      if (activeChatIdRef.current === chatId && (!wasCached || restored.id !== cached?.id)) {
        connectEvents(restored.id, projectPath, chatId)
      }
    } catch (e) { setError(messageOf(e)) } finally { setChatBusy(chatId, false) }
  }

  function hideChatGPTSurfaces(chat?: WorkspaceChat) {
    const bridge = isDesktop() ? desktopBridge() : undefined
    if (!bridge || !chat) return
    const keys = [chat.id]
    for (const key of keys) void bridge.chatgpt.hide(key).catch(() => undefined)
  }

  const updateWorkspaceChat = useCallback((chatId: string, projectPath: string, patch: Partial<WorkspaceChat>) => {
    setChats((current) => {
      const next = current.map((chat) => chat.id === chatId ? { ...chat, ...patch, updatedAt: new Date().toISOString() } : chat)
      saveWorkspaceChats(projectPath, next)
      const updated = next.find((chat) => chat.id === chatId)
      if (updated) void api.saveWorkspaceChat(durableWorkspaceChat(projectPath, updated)).catch(() => undefined)
      return next
    })
  }, [])

  function updateChat(patch: Partial<WorkspaceChat>) {
    if (!session || !activeChatId) return
    updateWorkspaceChat(activeChatId, session.project_path, patch)
  }

  function reorderChat(sourceChatId: string, targetChatId: string) {
    if (!session) return
    setChats((current) => {
      const next = reorderWorkspaceChats(current, sourceChatId, targetChatId)
      if (next === current) return current
      saveWorkspaceChats(session.project_path, next)
      return next
    })
  }

  function markContextDirtyForOtherChats(projectPath: string, sourceChatId: string) {
    setChats((current) => {
      const next = current.map((chat) => chat.id === sourceChatId ? chat : { ...chat, artifactSelection: { ...chat.artifactSelection, context: true } })
      saveWorkspaceChats(projectPath, next)
      return next
    })
  }

  async function syncPeerBaselineUpdates(projectPath: string, sourceChatId: string) {
    const targets = chats.filter((chat) => chat.id !== sourceChatId)
    await Promise.all(targets.map(async (target) => {
      try {
        const peer = await api.getSession(target.sessionId)
        const notices = (peer.baseline_notices || []).filter((notice) => notice.new_sha256 === peer.context.manifest.sha256)
        const notice = notices[notices.length - 1]
        if (!notice) return
        const noticeKey = `${target.id}:${notice.id}`
        if (!baselineSeenRef.current.has(noticeKey)) {
          baselineSeenRef.current.add(noticeKey)
          const changed = notice.changed_files.slice(0, 12).map((path) => `- ${path}`).join('\n') || '- alterações fora do inventário textual'
          const overlap = (notice.overlap_files || []).slice(0, 12).map((path) => `- ${path}`).join('\n')
          appendChatItem(target, projectPath, {
            id: `baseline-${notice.id}`, role: 'harness', source: 'wharness', presentation: 'notice', createdAt: notice.created_at,
            text: `Baseline do projeto atualizado por outro chat.\n\nAnterior: \`${notice.previous_sha256.slice(0, 12)}…\`\nNovo: \`${notice.new_sha256.slice(0, 12)}…\`\n\nFicheiros alterados:\n${changed}${overlap ? `\n\nInterseção provável com este trabalho:\n${overlap}` : ''}`,
            meta: notice.relevant ? 'Concorrência · revisão necessária' : 'Concorrência · sem interseção conhecida',
          })
        }
        if (notice.relevant && peer.state === 'baseline_update_pending' && peer.last_manual_prompt && isAutomaticAutomationMode(peer.automation_mode)) {
          const dispatchKey = `dispatch:${target.id}:${peer.last_request_id || notice.id}`
          if (baselineSeenRef.current.has(dispatchKey)) return
          baselineSeenRef.current.add(dispatchKey)
          const prepared = await transportPlannerContinuation(peer, target)
          appendChatItem(target, projectPath, {
            id: `baseline-dispatch-${peer.last_request_id || notice.id}`, role: 'harness', source: 'wharness', presentation: 'notice', createdAt: new Date().toISOString(),
            text: prepared.submitted ? 'Atualização de baseline enviada automaticamente ao ChatGPT deste chat em background para rever e adaptar o trabalho em curso.' : 'Atualização de baseline preparada para este chat.',
            meta: prepared.submitted ? 'Baseline sincronizado · ChatGPT acionado' : 'Baseline sincronizado · envio pendente',
          })
        }
      } catch (error) {
        console.warn('peer baseline synchronization failed', target.id, messageOf(error))
      }
    }))
  }

  function toggleComposerArtifact(kind: ChatArtifactKind) {
    if (!session || !activeChatId || kind === 'prompt') return
    const active = chats.find((chat) => chat.id === activeChatId)
    if (!active) return
    const contextRequired = !active.lastContextSha256 || active.lastContextSha256 !== sessionContextSHA(session) || Boolean(active.chatgptUrl && active.lastContextChatgptUrl && !sameChatGPTConversation(active.chatgptUrl, active.lastContextChatgptUrl))
    const errorRequired = session.state === 'repair_pending' || session.last_execution?.success === false || Boolean(session.last_repair_error)
    if ((kind === 'context' && contextRequired) || (kind === 'error' && errorRequired)) return
    const current = Boolean(active.artifactSelection?.[kind])
    updateWorkspaceChat(active.id, session.project_path, { artifactSelection: { ...active.artifactSelection, [kind]: !current } })
  }


  function presentAppliedSession(targetChat: WorkspaceChat, updated: Session) {
    const projected = appliedChangePresentationItems(updated)
    if (!projected.length) return
    mutateChatItems(targetChat, updated.project_path, (current) => mergeAppliedChangePresentationItems(current, projected))
  }

  useEffect(() => {
    if (!session?.last_host_applied_at || !session.last_applied_changes?.length) return
    const target = chats.find((chat) => chat.id === activeChatId && chat.sessionId === session.id)
    if (target) presentAppliedSession(target, session)
  }, [activeChatId, chats, session?.id, session?.last_host_applied_at])

  useEffect(() => {
    if (!hostAppliedPresentation || presentedHostAppliedEventsRef.current.has(hostAppliedPresentation.eventId)) return
    presentedHostAppliedEventsRef.current.add(hostAppliedPresentation.eventId)
    let cancelled = false
    void api.getSession(hostAppliedPresentation.sessionId).then((updated) => {
      if (cancelled) return
      const target = chats.find((chat) => chat.id === hostAppliedPresentation.chatId && chat.sessionId === updated.id)
      if (!target) {
        presentedHostAppliedEventsRef.current.delete(hostAppliedPresentation.eventId)
        return
      }
      acceptSessionForChat(target, updated)
      presentAppliedSession(target, updated)
    }).catch((cause) => {
      presentedHostAppliedEventsRef.current.delete(hostAppliedPresentation.eventId)
      console.warn('host applied chat presentation recovery failed', messageOf(cause))
    })
    return () => { cancelled = true }
  }, [chats, hostAppliedPresentation])

  function reportChatError(message: string, meta = 'Erro', targetChat?: WorkspaceChat, projectPath?: string) {
    const target = targetChat || chats.find((chat) => chat.id === activeChatId)
    const path = projectPath || session?.project_path
    setError(message)
    if (!target || !path) { setErrorChatRef(undefined); return }
    const itemId = `error-${crypto.randomUUID()}`
    appendChatItem(target, path, {
      id: itemId, role: 'harness', source: 'wharness', presentation: 'notice', createdAt: new Date().toISOString(),
      text: `### Erro\n\n${message}`, meta, iteration: session?.last_request_id ? iterationRef(session.last_request_id, 'failed', ['error'], target.chatgptUrl) : undefined,
    })
    setErrorChatRef({ chatId: target.id, itemId, message })
  }

  async function showErrorInChat() {
    const ref = errorChatRef
    if (!ref) return
    if (ref.chatId !== activeChatId) await selectChat(ref.chatId)
    setMode('agent')
    setError(undefined)
    window.requestAnimationFrame(() => window.requestAnimationFrame(() => {
      const element = document.getElementById(`chat-item-${ref.itemId}`)
      element?.scrollIntoView({ behavior: 'smooth', block: 'center' })
      element?.focus({ preventScroll: true })
    }))
  }

  const bindChatGPTURLForChat = useCallback((chatId: string, projectPath: string, url: string) => {
    const conversation = chatgptConversationURL(url)
    if (!conversation) return false
    const conflict = [...chats, ...archivedChats].find((chat) => chat.id !== chatId && sameChatGPTConversation(chat.chatgptUrl, conversation))
    if (conflict) {
      setError(`A conversa ChatGPT já está vinculada ao Harness Chat ${conflict.title}. Abra outra conversa ou reabra esse chat para continuar nela.`)
      void desktopBridge()?.chatgpt.rejectAffinity(chatId, conversation)
      return false
    }
    const target = chats.find((chat) => chat.id === chatId)
    if (!target) return false
    if (target.chatgptUrl && !sameChatGPTConversation(target.chatgptUrl, conversation)) {
      setError('Este Harness Chat já possui uma conversa ChatGPT permanente. A conversa vinculada será mantida.')
      void desktopBridge()?.chatgpt.rejectAffinity(chatId, conversation)
      return false
    }
    if (!sameChatGPTConversation(target.chatgptUrl, conversation)) {
      updateWorkspaceChat(chatId, projectPath, {
        chatgptUrl: conversation,
        lastContextChatgptUrl: target.lastContextSha256 && !target.lastContextChatgptUrl ? conversation : target.lastContextChatgptUrl,
      })
    }
    void desktopBridge()?.chatgpt.confirmAffinity(chatId, conversation).catch((error) => setError(messageOf(error)))
    return true
  }, [archivedChats, chats, updateWorkspaceChat])

	const bindChatGPTURLForOwnedKey = useCallback((ownerKey: string, projectPath: string, url: string) => {
		return chats.some((chat) => chat.id === ownerKey) && bindChatGPTURLForChat(ownerKey, projectPath, url)
	}, [bindChatGPTURLForChat, chats])

  const recordChatGPTHumanAction = useCallback((notice?: DesktopChatGPTHumanAction) => {
    if (!notice?.cacheKey) return
    setChatgptHumanActions((current) => {
      const next = { ...current }
      if (notice.active) next[notice.cacheKey] = notice
      else delete next[notice.cacheKey]
      return next
    })
  }, [])

  useEffect(() => {
    if (!session || !isDesktop()) return
    const bridge = desktopBridge()
    if (!bridge) return
    return bridge.chatgpt.onState((next) => {
      if (next?.humanAction) recordChatGPTHumanAction(next.humanAction)
      const ownerKey = String(next?.cacheKey || '').trim()
      const candidate = chatgptConversationURL(next?.bindingCandidate || '')
      if (!ownerKey || !candidate) return
	  bindChatGPTURLForOwnedKey(ownerKey, session.project_path, candidate)
    })
  }, [bindChatGPTURLForOwnedKey, recordChatGPTHumanAction, session])

  useEffect(() => {
    if (!isDesktop()) return
    const bridge = desktopBridge()
    if (!bridge) return
    return bridge.chatgpt.onHumanAction(recordChatGPTHumanAction)
  }, [recordChatGPTHumanAction])

  useCodexInbox(session?.project_path, bundleRoutingReadyKey, submitBundleFileRef, setError)

  useEffect(() => {
    if (!isDesktop() || !bundleRoutingReadyKey) return
    const bridge = desktopBridge()
    if (!bridge) return
    const ingest = createBundleInboxDelivery({
      submit: (bundle) => submitBundleFileRef.current(bundle.contentBase64, bundle.requestId, bundle.filename),
      acknowledge: (bundle) => bridge.chatgpt.ackBundle(bundle.cacheKey || '', bundle.requestId, bundle.filename),
      retain: (bundle) => bridge.chatgpt.nackBundle(bundle.cacheKey || '', bundle.requestId, bundle.filename),
      accepted: (bundle) => {
        for (const key of [...resumedBundleKeysRef.current]) if (key.includes(`:${bundle.requestId}:`)) resumedBundleKeysRef.current.delete(key)
        for (const key of [...failedPromptDeliveryKeysRef.current]) if (key.includes(`:${bundle.requestId}:`)) failedPromptDeliveryKeysRef.current.delete(key)
        if (bundle.cacheKey) {
          setPreparedDrafts((current) => { const next = { ...current }; delete next[bundle.cacheKey!]; return next })
          setFailedPromptDeliveries((current) => { const next = { ...current }; delete next[bundle.cacheKey!]; return next })
        }
      },
      failed: (bundle, bundleError) => {
        if (bundle.cacheKey) setFailedPromptDeliveries((current) => ({ ...current, [bundle.cacheKey!]: { kind: promptDeliveryFailureKind(messageOf(bundleError)), requestId: bundle.requestId } }))
        if (!isNonTerminalBundleRoutingError(bundleError)) setError(messageOf(bundleError))
      },
    })
    const unsubscribe = bridge.chatgpt.onBundleDownloaded((bundle) => { void ingest(bundle) })
    void bridge.chatgpt.pendingBundles().then((bundles) => { for (const bundle of bundles) void ingest(bundle) }).catch((bundleError) => console.warn('pending bundle recovery failed', messageOf(bundleError)))
    return unsubscribe
  }, [bundleRoutingReadyKey])

  useEffect(() => {
    if (!isDesktop() || !session || chats.length === 0) return
    const bridge = desktopBridge()
    if (!bridge) return
    let cancelled = false
	const keys = chats.map((chat) => chat.id)
	void Promise.all(keys.map((key) => bridge.chatgpt.state(key).catch(() => undefined))).then((states) => {
      if (cancelled) return
      for (const state of states) {
        if (state?.humanAction) recordChatGPTHumanAction(state.humanAction)
        const ownerKey = String(state?.cacheKey || '').trim()
        const candidate = chatgptConversationURL(state?.bindingCandidate || '')
		if (ownerKey && candidate) bindChatGPTURLForOwnedKey(ownerKey, session.project_path, candidate)
      }
    })
    return () => { cancelled = true }
  }, [bindChatGPTURLForOwnedKey, chats, recordChatGPTHumanAction, session])

  useEffect(() => {
    if (!isDesktop() || !session || chats.length === 0) return
    const bridge = desktopBridge()
    if (!bridge) return
    let cancelled = false
    let reconciling = false
    const reconcile = async () => {
      if (cancelled || reconciling) return
      reconciling = true
      try {
        const candidates = await Promise.all(chats.map(async (chat) => {
          const candidate = chat.sessionId === session.id ? session : await api.getSession(chat.sessionId)
          // Native recovery uses durable bindings; browser recovery uses the
          // Worker queue. Neither may duplicate an accepted submission.
		  const automaticContinuation = isAutomaticAutomationMode(candidate.automation_mode) && candidate.last_manual_prompt && (
			(['conflict_resolution_pending', 'repair_pending', 'workflow_pending', 'baseline_update_pending'].includes(candidate.state) && (candidate.state !== 'conflict_resolution_pending' || conflictAutoDispatchable(candidate)))
			|| (candidate.state === 'awaiting_plan' && Number(candidate.remote_recovery_attempt || 0) > 0)
		  )
		  const continuationRequestID = candidate.state === 'conflict_resolution_pending' ? candidate.integration_conflict?.request_id : candidate.last_request_id
          if (!cancelled && automaticContinuation && continuationRequestID) await recoverCodexContinuation(bridge, candidate, chat, () => transportPlannerContinuation(candidate, chat))
		  if (chat.engine !== 'codex' && !cancelled && automaticContinuation && continuationRequestID) {
			const delivery = await api.chatAgentTasksForRequest(continuationRequestID)
			// Only a completed write for this immutable chat proves delivery.
			// AWAIT_RESPONSE and synthetic legacy conflict chats cannot suppress recovery.
			const writes = delivery.tasks.filter((task) => ['BOT_WRITE', 'RECOVERY_WRITE'].includes(task.type) && task.chat_id === chat.id)
			const accepted = writes.some((task) => task.status === 'DONE')
			const live = writes.some((task) => ['PENDING', 'LEASED', 'RUNNING', 'WAITING'].includes(task.status))
			const failedWrites = writes.filter((task) => task.type === 'BOT_WRITE' && task.status === 'FAILED').length
			if (!accepted && !live && failedWrites < 3) {
			  if (candidate.state === 'conflict_resolution_pending') await submitConflictPrompt(candidate, chat, true)
			  else if (candidate.state === 'repair_pending') await submitRepairPrompt(candidate, chat, true)
			  else if (candidate.state === 'workflow_pending') await submitWorkflowPrompt(candidate, chat, true)
			  else {
				const dispatchKey = `dispatch:${chat.id}:${continuationRequestID}`
				baselineSeenRef.current.delete(dispatchKey)
				baselineSeenRef.current.add(dispatchKey)
				try { await transportPlannerContinuation(candidate, chat) }
				catch (sendError) { baselineSeenRef.current.delete(dispatchKey); throw sendError }
			  }
			}
		  }
		  const requests = pendingBundleRequestIDs(candidate)
          await Promise.all(requests.map(async (requestId) => {
			const url = chat.chatgptUrl
			const cacheKey = chat.id
            if (chat.engine === 'codex' || !url) return
			const requestDelivery = await api.chatAgentTasksForRequest(requestId)
			const requestWrites = requestDelivery.tasks.filter((task) => ['BOT_WRITE', 'RECOVERY_WRITE'].includes(task.type) && task.chat_id === cacheKey)
			const requestWriteSubmitted = requestWrites.some((task) => task.status === 'DONE')
			// A durable write that has not reached DONE has not established a
			// remote turn. Arming AWAIT_RESPONSE here makes Retomar send only a
			// continuation while the original ZIP/prompt is still unsent.
			if (requestWrites.length && !requestWriteSubmitted) return
            const resumeKey = `${candidate.id}:${requestId}:${cacheKey}`
            if (cancelled || resumedBundleKeysRef.current.has(resumeKey) || livePromptDeliveryKeysRef.current.has(resumeKey) || failedPromptDeliveryKeysRef.current.has(resumeKey)) return
            resumedBundleKeysRef.current.add(resumeKey)
            try {
              const recoveryBootstrap = pendingRequestRecoveryPrompt(candidate, requestId)
              if (!recoveryBootstrap) return
              const resumed = await bridge.chatgpt.resumeExpectedBundle({
                cacheKey, sessionId: candidate.id, requestId, url, recoveryBootstrap,
                expectedFilename: expectedResponseBundleName(recoveryBootstrap, requestId),
                chatTitle: chat.title, chatHash: sessionContextSHA(candidate),
                requestedAt: candidate.request_lineages?.[requestId]?.created_at || candidate.created_at,
              })
              const outcome = pendingDeliveryResumeOutcome(resumed)
              if (outcome === 'wait') resumedBundleKeysRef.current.delete(resumeKey)
              if (outcome === 'resend' && !cancelled) {
                failedPromptDeliveryKeysRef.current.add(resumeKey)
                setFailedPromptDeliveries((current) => ({ ...current, [cacheKey]: { kind: 'retry', requestId } }))
              }
            } catch (resumeError) {
              resumedBundleKeysRef.current.delete(resumeKey)
              console.warn('pending ChatGPT bundle recovery failed', cacheKey, messageOf(resumeError))
            }
          }))
          return { chat, session: candidate }
        }))
        if (!cancelled) setInterruptedExecutions(candidates.filter((candidate) => executionNeedsAttention(candidate.session)))
      } catch (resumeError) {
        console.warn('pending ChatGPT supervision recovery failed', messageOf(resumeError))
      } finally {
        reconciling = false
      }
    }
    void reconcile()
    const timer = window.setInterval(() => { void reconcile() }, 30_000)
    return () => { cancelled = true; window.clearInterval(timer) }
  }, [chats, session])

  useEffect(() => {
    const supervised = interruptedExecutions.filter((candidate) => ['resuming', 'running'].includes(candidate.session.interrupted_execution?.status || ''))
    if (!supervised.length) return
    let cancelled = false
    const timer = window.setTimeout(() => {
      void Promise.all(supervised.map(async (candidate) => {
        try { return { candidate, refreshed: await api.getSession(candidate.session.id) } }
        catch (pollError) { console.warn('execution recovery supervision failed', candidate.session.id, messageOf(pollError)); return undefined }
      })).then((settled) => {
        if (cancelled) return
        const results = settled.filter((result): result is { candidate: { chat: WorkspaceChat; session: Session }; refreshed: Session } => Boolean(result))
        for (const result of results) {
          if (!result.refreshed.interrupted_execution) appendChatItem(result.candidate.chat, result.refreshed.project_path, {
            id: crypto.randomUUID(), role: 'harness', source: 'wharness', presentation: 'notice', createdAt: new Date().toISOString(),
            text: `Recuperação concluída para ${result.candidate.session.interrupted_execution?.plan_id || 'a execução interrompida'}.`,
          })
        }
        setInterruptedExecutions((current) => current.flatMap((candidate) => {
          const match = results.find((result) => result.candidate.session.id === candidate.session.id)
          if (!match) return [candidate]
          return match.refreshed.interrupted_execution ? [{ ...candidate, session: match.refreshed }] : []
        }))
        const activeResult = results.find((result) => result.candidate.chat.id === activeChatIdRef.current)
        if (activeResult) setSession(activeResult.refreshed)
      })
    }, 1200)
    return () => { cancelled = true; window.clearTimeout(timer) }
  }, [interruptedExecutions])

  function bindChatGPTURL(url: string) {
    if (!session || !activeChatId) return false
    return bindChatGPTURLForChat(activeChatId, session.project_path, url)
  }

  async function openChatGPTHumanAction() {
    const notice = chatgptHumanAction
    if (!notice?.active) return
	const owner = chats.find((chat) => chat.id === notice.cacheKey)
	if (owner && owner.id !== activeChatId) {
      if (busy) return
	  await selectChat(owner.id)
    }
    setMode('agent')
    setChatgptAttentionNonce((value) => value + 1)
  }

  function markContextSent(sha256: string, conversationUrl?: string) {
    updateChat({ lastContextSha256: sha256, lastContextChatgptUrl: conversationUrl || chats.find((chat) => chat.id === activeChatId)?.chatgptUrl })
  }

  async function previewComposerBundle(message: string, attachments: File[], projectFiles: string[], artifacts: ChatArtifactSelection, requestMode: ChatRequestMode = 'direct') {
    if (!session) throw new Error('Sessão ativa não encontrada.')
    const encoded = attachments.length ? await encodeChatAttachments(attachments) : []
    const systemArtifacts = await encodeSystemArtifacts(session, artifacts)
    return api.previewComposerBundle(session.id, {
      message: canonicalizeDirectives(message) + attachmentPromptSuffix(attachments) + projectFileReferenceSuffix(projectFiles),
      planningMode: requestMode, attachments: encoded, artifacts: systemArtifacts, projectFiles,
    })
  }

  async function send(message: string, attachments: File[], projectFiles: string[], artifacts: ChatArtifactSelection, requestMode: ChatRequestMode = 'direct', continuation: 'main' | 'execution_plan_adjustment' = 'main', onAccepted?: () => void) {
    if (!session) return
    if (attachments.length && (!isDesktop() || (chats.find((chat) => chat.id === activeChatId)?.engine !== 'codex' && config?.planner !== 'manual'))) {
      setError('Anexos diretos requerem o Wharnex Desktop com o planner manual.')
      throw new Error('Anexos diretos indisponíveis neste modo.')
    }
    const targetSession = session
    const targetChat = chats.find((chat) => chat.id === activeChatId)
    if (!targetChat) throw new Error('Harness Chat ativo não encontrado.')
    if (targetChat.engine !== 'codex' && !await restoreChatGPTConversationAffinity(targetChat)) return
    const projectPath = targetSession.project_path

    setChatBusy(targetChat.id, true); setError(undefined)
    const messageId = crypto.randomUUID()
    let encoded: Awaited<ReturnType<typeof encodeChatAttachments>> = []
    let persistedAttachments: ChatItem['attachments'] = undefined
    const systemArtifacts = targetChat.engine === 'codex' ? [] : await encodeSystemArtifacts(targetSession, artifacts)
    if (attachments.length) {
      try {
        encoded = await encodeChatAttachments(attachments)
        const bridge = desktopBridge()
        if (!bridge) throw new Error('Desktop bridge indisponível')
        const persisted = await bridge.attachments.persist({ cacheKey: targetChat.id, messageId, attachments: encoded })
        persistedAttachments = persisted.attachments.map((file) => ({
          name: file.name, size: file.size, mime: file.mime, storageRef: file.storageRef, previewKind: file.previewKind,
        }))
      } catch (attachmentError) {
        const detail = messageOf(attachmentError)
        setError(`Não foi possível guardar os anexos do chat: ${detail}`)
        setChatBusy(targetChat.id, false)
        throw attachmentError
      }
    }

    const userItem: ChatItem = { id: messageId, role: 'user', source: 'user', text: message, createdAt: new Date().toISOString(), attachments: persistedAttachments }
    appendChatItem(targetChat, projectPath, userItem)
    const firstRequest = targetChat.title === 'Novo chat' || targetChat.title === 'Chat principal'
    const generatedChatTitle = firstRequest ? deriveChatTitle(message) : targetChat.title
    if (firstRequest) updateWorkspaceChat(targetChat.id, projectPath, {
      title: generatedChatTitle,
      naming: { state: 'provisional', attempts: targetChat.naming?.attempts || 0 },
    })
    try {
      if (targetChat.engine === 'codex') {
        const bridge = desktopBridge()
        if (!bridge) throw new Error('Codex Native requer o Wharnex Desktop.')
        await dispatchNativeCodex(bridge, targetSession, { ...targetChat, title: generatedChatTitle }, message, encoded, projectFiles, (selection) => updateWorkspaceChat(targetChat.id, projectPath, selection))
        onAccepted?.()
        return
      }
      const requestText = canonicalizeDirectives(message) + attachmentPromptSuffix(attachments) + projectFileReferenceSuffix(projectFiles)
      const response = continuation === 'execution_plan_adjustment' ? await api.adjustExecutionPlan(targetSession.id, requestText) : await api.message(targetSession.id, requestText, requestMode)
      onAccepted?.()
      const prompt = response.manual_prompt || response.session.last_manual_prompt || ''
      const turn = response.session.last_turn || response.turn
      const requestId = response.session.last_request_id || turn?.request_id || ''
      const immediatePlanProposal = turn?.kind === 'plan'
      const deliveryKey = `${response.session.id}:${requestId}:${targetChat.id}`
      const ownsLiveDelivery = Boolean(prompt && requestId && isDesktop() && response.session.chat_transport_mode !== 'manual')
      if (ownsLiveDelivery) livePromptDeliveryKeysRef.current.add(deliveryKey)
      acceptSessionForChat(targetChat, response.session)
      updateWorkspaceChat(targetChat.id, response.session.project_path, { sessionId: response.session.id })
      if (activeChatIdRef.current === targetChat.id) setManualPrompt(prompt)
      if (requestId) {
        mutateChatItems(targetChat, response.session.project_path, (current) => current.map((item) => item.id === messageId ? { ...item, iteration: iterationRef(requestId, 'outbound', selectedArtifactKinds(artifacts)) } : item))
        updateWorkspaceChat(targetChat.id, response.session.project_path, { requestMode, pendingPlan: requestMode === 'plan_first' || immediatePlanProposal ? { requestId, originalMessage: message } : undefined })
      }
      let draftCount = 0
      let autoSubmitted = false
      let transportFailure = ''
      const manualTransport = response.session.chat_transport_mode === 'manual'
      if (prompt && isDesktop()) {
        try {
          const bridge = desktopBridge()
          if (!bridge) throw new Error('Desktop bridge indisponível')
          if (activeChatIdRef.current === targetChat.id) setTransportProgress(manualTransport ? 'A preparar o bundle para entrega manual no Engine…' : 'A preparar o bundle ZIP…')
          const prepared = await preparePlannerPrompt(bridge, targetChat, {
            cacheKey: targetChat.id, workspaceChatId: targetChat.id, text: prompt, bootstrapText: message, url: targetChat.chatgptUrl, sessionId: response.session.id,
            requestId: response.session.last_request_id || '', attachments: encoded, artifacts: systemArtifacts, autoSubmit: !manualTransport && isAutomaticAutomationMode(automationMode), manualTransport,
            expectedFilename: expectedResponseBundleName(prompt, requestId),
            projectFiles,
            contextSha256: sessionContextSHA(response.session), lastContextSha256: targetChat.lastContextSha256,
            lastContextChatgptUrl: targetChat.lastContextChatgptUrl, includeContext: artifacts.context || projectFiles.length > 0 || requiresProjectContextTransport(message), preferCurrentConversation: false,
            firstRequest, chatTitle: generatedChatTitle, requestedAt: userItem.createdAt, projectName: chatGPTProjectName(projectPath),
            // The owning project of every task this request enqueues. The
            // backend can also resolve it from the chat, but a first request
            // may run before that chat row is durable, and an unattributed
            // task appears in no project's Tarefas panel at all.
            projectPath,
            reasoningEffort: response.session.reasoning_effort || 'high',
          })
          if (requestId && cancelledPromptDeliveryIdsRef.current.has(requestId)) throw new Error('WHARNEX_REQUEST_CANCELLED: preparação do bundle cancelada')
          try {
            const artifactSession = await api.getSession(response.session.id)
            acceptSessionForChat(targetChat, artifactSession)
          } catch { /* artifact metadata refresh is best effort; transport result remains authoritative */ }
          draftCount = prepared.attachmentCount
          autoSubmitted = prepared.submitted
          const bindingAccepted = prepared.conversationUrl ? bindChatGPTURLForChat(targetChat.id, response.session.project_path, prepared.conversationUrl) : true
          if (prepared.includedContext && bindingAccepted) {
            updateWorkspaceChat(targetChat.id, response.session.project_path, {
              lastContextSha256: sessionContextSHA(response.session),
              lastContextChatgptUrl: prepared.conversationUrl || targetChat.chatgptUrl,
            })
          }
          if (requestId) {
            const actualArtifacts = selectedArtifactKinds({ ...artifacts, context: prepared.includedContext, prompt: true })
            mutateChatItems(targetChat, response.session.project_path, (current) => current.map((item) => item.id === messageId ? { ...item, iteration: iterationRef(requestId, prepared.submitted ? 'submitted' : 'prepared', actualArtifacts, prepared.conversationUrl || targetChat.chatgptUrl) } : item))
          }
          updateWorkspaceChat(targetChat.id, response.session.project_path, { artifactSelection: { context: false, result: false, error: false } })
          if (!manualTransport && !prepared.submitted) setPreparedDrafts((current) => ({ ...current, [targetChat.id]: prepared.attachmentCount }))
          setFailedPromptDeliveries((current) => { const next = { ...current }; delete next[targetChat.id]; return next })
          failedPromptDeliveryKeysRef.current.delete(deliveryKey)
        } catch (prepareError) {
          if (!requestId || !cancelledPromptDeliveryIdsRef.current.has(requestId)) {
            transportFailure = messageOf(prepareError)
            const failureKind = promptDeliveryFailureKind(transportFailure)
            setFailedPromptDeliveries((current) => ({ ...current, [targetChat.id]: { kind: failureKind, requestId } }))
            failedPromptDeliveryKeysRef.current.add(deliveryKey)
          }
        } finally {
          livePromptDeliveryKeysRef.current.delete(deliveryKey)
          if (activeChatIdRef.current === targetChat.id) setTransportProgress('')
        }
      }
      if (requestId && cancelledPromptDeliveryIdsRef.current.delete(requestId)) return
      const immediatePlannerFailure = turn?.outcome?.status === 'failed' || turn?.outcome?.status === 'partial'
      const immediateConversationalTurn = Boolean(turn && !immediatePlannerFailure && turn.kind !== 'change' && turn.kind !== 'workflow')
      appendChatItem(targetChat, response.session.project_path, {
        id: crypto.randomUUID(), role: 'harness',
        source: immediateConversationalTurn ? 'chatgpt' : 'wharness',
        presentation: immediatePlanProposal ? 'plan' : (immediateConversationalTurn ? 'message' : 'notice'),
        createdAt: new Date().toISOString(),
        text: immediatePlannerFailure
          ? `${turn?.message || 'O planner não concluiu o pedido.'}\n\n${turn?.outcome?.message || response.session.last_repair_error || ''}\n\nPode corrigir o prompt, acrescentar contexto/anexos, ativar outro transporte ou repetir o pedido.`
          : immediateConversationalTurn
          ? turn!.message
          : response.session.plan
            ? (turn?.message || response.session.plan.summary)
          : transportFailure
            ? promptDeliveryFailureKind(transportFailure) === 'storage'
              ? `O pedido não pôde ser persistido porque o armazenamento local está sem espaço: ${transportFailure}`
              : promptDeliveryFailureKind(transportFailure) === 'attention'
              ? `O ChatGPT está aberto, mas ainda não expõe um campo de escrita utilizável: ${transportFailure}`
              : manualTransport
                ? `O prompt foi preparado, mas não foi possível montar o fallback manual no Engine: ${transportFailure}`
                : `O prompt foi preparado, mas não foi possível montar o rascunho no ChatGPT: ${transportFailure}`
            : autoSubmitted
              ? 'Entrada do planner submetida automaticamente ao ChatGPT em modo Auto. O Wharnex aguarda agora o download validado do bundle.'
            : draftCount
              ? (manualTransport
                ? 'Fallback manual preparado no Engine. Use a toolbar para copiar o prompt e entregar o bundle pendente pelo picker ou pela área de transferência.'
                : 'A preparação foi enviada ao composer do ChatGPT. Verifique visualmente a entrada preparada antes de confirmar o envio.')
              : 'Prompt do planner preparado. No ChatGPT, gere o bundle ZIP solicitado e clique em Download; o Desktop irá importá-lo automaticamente.',
        meta: immediatePlannerFailure ? `Pedido não concluído · ${turn?.outcome?.retryable ? 'pode ser repetido' : 'requer intervenção'}` : (immediateConversationalTurn ? turnMeta(turn!.kind) : (response.session.state === 'applied' ? 'AUTO · Host aplicado' : (response.session.plan ? `Plano ${response.session.plan.plan_id}` : (autoSubmitted ? `${draftCount} item(ns) de entrada transportados · aguardando resultado ZIP` : (draftCount ? (manualTransport ? `${draftCount} bundle(s) manuais preparados · scraper desligado` : `${draftCount} item(ns) de entrada preparados · aguardando confirmação`) : 'Aguardando resultado externo'))))),
        turnKind: turn?.kind,
        approval: immediatePlanProposal && requestId ? { status: 'pending', requestId, originalMessage: message } : undefined,
        iteration: immediatePlannerFailure && requestId ? iterationRef(requestId, 'failed', ['error'], targetChat.chatgptUrl) : undefined,
      })
    } catch (e) {
      const msg = messageOf(e)
      reportChatError(`Falha no planeamento: ${msg}`, 'Falha na request', targetChat, projectPath)
      if (onAccepted) throw e
    } finally {
      if (activeChatIdRef.current === targetChat.id) setTransportProgress('')
      setChatBusy(targetChat.id, false)
    }
  }

  useEffect(() => {
    const projectPath = session?.project_path || ''
    if (!projectPath || !activeChatOwnsSession || !activeChatId || activeBusy || bootstrapPromptInFlightRef.current.has(projectPath)) return
    const prompt = loadPendingProjectPrompt(projectPath)
    if (!prompt) return
    const launch = loadPendingProjectLaunch(projectPath)
    if (launch?.entryMode === 'orchestrator') {
      if (mode !== 'orchestrator') setMode('orchestrator')
      return
    }
    bootstrapPromptInFlightRef.current.add(projectPath)
    void send(
      prompt,
      [],
      [],
      launch?.artifacts || { context: true, prompt: true, result: false, error: false },
      launch?.requestMode || 'direct',
      'main',
      () => {
        clearPendingProjectPrompt(projectPath)
        clearPendingProjectLaunch(projectPath)
        bootstrapPromptInFlightRef.current.delete(projectPath)
      },
    ).catch(() => undefined)
  }, [activeBusy, activeChatId, activeChatOwnsSession, bootstrapPromptRevision, mode, send, session?.project_path])

  async function adjustExecutionPlan(message: string, attachments: File[], projectFiles: string[], artifacts: ChatArtifactSelection) {
    await send(message, attachments, projectFiles, artifacts, 'direct', 'execution_plan_adjustment')
  }

  const { enqueueMainRequest, updateQueuedRequest, moveQueuedRequest, removeQueuedRequest, mergeQueuedRequest } = createQueueActions({ activeChatId, setQueuedRequestsByChat, setError })

  async function promoteQueuedRequest(id: string) {
    if (!session) return
    const queue = queuedRequestsByChat[activeChatId] || []
    const queued = queue.find((item) => item.id === id)
    if (!queued) return
    removeQueuedRequest(id)
    if (!requestChainActive(session)) {
      setQueuedRequestsByChat((current) => ({ ...current, [activeChatId]: [queued, ...(current[activeChatId] || [])] }))
      return
    }
    try { await commentOnActiveTask(canonicalizeDirectives(queued.message) + projectFileReferenceSuffix(queued.projectFiles), queued.attachments) }
    catch (error) {
      setQueuedRequestsByChat((current) => ({ ...current, [activeChatId]: [queued, ...(current[activeChatId] || [])] }))
      setError(messageOf(error))
    }
  }

  useEffect(() => {
    if (!session || !activeChatOwnsSession || !activeChatId || activeBusy || restartModalOpen || queueDrainRef.current || nativeRequestActive || requestChainActive(session) || preparedDrafts[activeChatId]) return
    const next = (queuedRequestsByChat[activeChatId] || [])[0]
    if (!next) return
    queueDrainRef.current = true
    setQueuedRequestsByChat((current) => ({ ...current, [activeChatId]: (current[activeChatId] || []).filter((item) => item.id !== next.id) }))
    void send(next.message, next.attachments, next.projectFiles, next.artifacts, next.requestMode).finally(() => { queueDrainRef.current = false })
    // send intentionally stays outside the dependency array: this effect is a serialized queue dispatcher.
  }, [activeChatId, activeChatOwnsSession, activeBusy, nativeRequestActive, preparedDrafts, queuedRequestsByChat, restartModalOpen, session?.state, session?.pending_manual_request_ids, session?.self_evolution_activation])

  async function confirmPreparedDraft() {
    if (!activeChatId || busyChats[activeChatId]) return
    const targetChat = chats.find((chat) => chat.id === activeChatId)
    if (!targetChat || !session) return
    setChatBusy(targetChat.id, true); setError(undefined)
    try {
      const bridge = desktopBridge()
      if (!bridge) throw new Error('Desktop bridge indisponível')
      const submitted = await bridge.chatgpt.submitPrepared({ cacheKey: activeChatId })
      if (submitted.conversationUrl) bindChatGPTURL(submitted.conversationUrl)
      setPreparedDrafts((current) => { const next = { ...current }; delete next[activeChatId]; return next })
      appendChatItem(targetChat, session.project_path, { id: crypto.randomUUID(), role: 'harness', source: 'wharness', presentation: 'notice', createdAt: new Date().toISOString(), text: 'Prompt e anexos enviados ao ChatGPT após confirmação.', meta: 'Aguardando bundle do ChatGPT' })
    } catch (e) { setError(messageOf(e)) } finally { setChatBusy(targetChat.id, false) }
  }

  function dismissPreparedDraft() {
    setPreparedDrafts((current) => { const next = { ...current }; delete next[activeChatId]; return next })
  }

  async function retryPreparedPromptDelivery(requestId?: string) {
    if (!session || !activeChatId || busyChats[activeChatId]) return
    if (requestId && !sessionHasPendingRequest(session, requestId)) {
      setFailedPromptDeliveries((current) => { const next = { ...current }; delete next[activeChatId]; return next })
      return
    }
    const targetChat = chats.find((chat) => chat.id === activeChatId)
    if (!targetChat) return
    setChatBusy(targetChat.id, true); setError(undefined); setTransportProgress('A repetir a entrega já preparada ao ChatGPT…')
    try {
      const bridge = desktopBridge()
      if (!bridge) throw new Error('Desktop bridge indisponível')
      if (requestId && failedPromptDeliveries[activeChatId]?.kind === 'storage') {
        const bundle = (await bridge.chatgpt.pendingBundles()).find((candidate) => candidate.requestId === requestId)
        if (!bundle) throw new Error('O bundle retido já não está disponível no inbox local.')
        await submitBundleFileRef.current(bundle.contentBase64, bundle.requestId, bundle.filename)
        await bridge.chatgpt.ackBundle(bundle.cacheKey || activeChatId, bundle.requestId, bundle.filename)
        setFailedPromptDeliveries((current) => { const next = { ...current }; delete next[activeChatId]; return next })
        return
      }
      const prepared = targetChat.engine === 'codex' ? await transportPlannerContinuation(session, targetChat, { forceContext: true }) : await bridge.chatgpt.retryPreparedPrompt({ cacheKey: activeChatId, expectedRequestId: requestId, sessionId: session.id, url: targetChat.chatgptUrl, recoveryPrompt: requestId ? pendingRequestRecoveryPrompt(session, requestId) : session.last_manual_prompt, expectedFilename: requestId ? expectedResponseBundleName(session.last_manual_prompt || '', requestId) : '', reasoningEffort: session.reasoning_effort || 'high' })
      if (prepared.alreadyDelivered) {
        setPreparedDrafts((current) => { const next = { ...current }; delete next[activeChatId]; return next })
        setFailedPromptDeliveries((current) => { const next = { ...current }; delete next[activeChatId]; return next })
        appendChatItem(targetChat, session.project_path, { id: crypto.randomUUID(), role: 'harness', source: 'wharness', presentation: 'notice', createdAt: new Date().toISOString(), text: 'O bundle deste pedido já tinha sido recebido; não foi feita uma entrega duplicada.', meta: 'Entrega já concluída' })
        return
      }
      if (prepared.alreadySupervised) {
        setFailedPromptDeliveries((current) => { const next = { ...current }; delete next[activeChatId]; return next })
        for (const key of [...failedPromptDeliveryKeysRef.current]) if (requestId && key.includes(`:${requestId}:`)) failedPromptDeliveryKeysRef.current.delete(key)
        appendChatItem(targetChat, session.project_path, { id: crypto.randomUUID(), role: 'harness', source: 'wharness', presentation: 'notice', createdAt: new Date().toISOString(), text: 'Este pedido já está entregue e sob supervisão no ChatGPT; nenhum reenvio foi feito.', meta: 'Aguardando resposta do ChatGPT' })
        return
      }
      if (prepared.conversationUrl) bindChatGPTURL(prepared.conversationUrl)
      if (!prepared.submitted && prepared.attachmentCount) setPreparedDrafts((current) => ({ ...current, [activeChatId]: prepared.attachmentCount! }))
      setFailedPromptDeliveries((current) => { const next = { ...current }; delete next[activeChatId]; return next })
      const text = requestId ? (prepared.submitted ? 'O mesmo pedido foi reenviado ao ChatGPT.' : 'O mesmo pedido foi montado novamente no ChatGPT; confirme o envio quando estiver pronto.') : (prepared.submitted ? 'O prompt original foi entregue novamente ao ChatGPT.' : 'O prompt original foi montado novamente no ChatGPT; confirme o envio quando estiver pronto.')
      const meta = prepared.submitted ? 'Aguardando bundle do ChatGPT' : 'Confirmação pendente'
      appendChatItem(targetChat, session.project_path, { id: crypto.randomUUID(), role: 'harness', source: 'wharness', presentation: 'notice', createdAt: new Date().toISOString(), text, meta, iteration: requestId ? iterationRef(requestId, prepared.submitted ? 'submitted' : 'prepared', ['context', 'prompt'], prepared.conversationUrl || targetChat.chatgptUrl) : undefined })
    } catch (retryError) {
      const detail = messageOf(retryError)
      if (detail.includes('entrada completa deste pedido não está persistida')) {
        setFailedPromptDeliveries((current) => { const next = { ...current }; delete next[activeChatId]; return next })
        setError('A entrada original deste pedido não está disponível para um reenvio seguro. Cancele este pedido e recrie-o para gerar uma nova base completa.')
      } else {
        setError(`Não foi possível repetir a entrega: ${detail}`)
      }
    } finally {
      if (activeChatIdRef.current === targetChat.id) setTransportProgress('')
      setChatBusy(targetChat.id, false)
    }
  }

  async function submitManualPlan(raw: string) {
    if (!session) return
    const targetSession = session
    const targetChat = chats.find((chat) => chat.id === activeChatId)
    if (!targetChat) return
    setBusy(true); setError(undefined)
    try {
      const updated = await api.manualPlan(targetSession.id, raw)
      acceptSessionForChat(targetChat, updated)
      appendChatItem(targetChat, updated.project_path, { id: crypto.randomUUID(), role: 'harness', source: 'wharness', presentation: 'notice', createdAt: new Date().toISOString(), text: updated.plan?.summary || 'Plano manual validado.', meta: updated.policy?.allowed ? 'Policy validada' : 'Policy bloqueou o plano' })
    } catch (e) { setError(messageOf(e)) } finally { setBusy(false) }
  }

  async function submitPlanFile(raw: string, requestId: string) {
    if (!session) throw new Error('Nenhum workspace ativo.')
    let busyTargetChatId = ''
    setError(undefined)
    try {
      let targetSession = session
      let targetChat = chats.find((chat) => chat.id === activeChatId)

      if (!sessionHasPendingRequest(targetSession, requestId)) {
        targetSession = undefined as unknown as Session
        targetChat = undefined
        for (const chat of chats) {
          if (chat.id === activeChatId) continue
          try {
            const candidate = await api.getSession(chat.sessionId)
            if (sessionHasPendingRequest(candidate, requestId)) { targetSession = candidate; targetChat = chat; break }
          } catch (error) {
            if (!(error instanceof APIError) || error.status !== 404) throw error
          }
        }
      }

      if (!targetChat || !targetSession?.id) {
        throw new Error(`O ficheiro pertence ao pedido ${requestId}, mas esse pedido não está pendente em nenhum Harness Chat deste workspace.`)
      }
      busyTargetChatId = targetChat.id
      setChatBusy(busyTargetChatId, true)

      const planBytes = new TextEncoder().encode(raw)
      const binary = Array.from(planBytes, (byte) => String.fromCharCode(byte)).join('')
      await api.persistArtifact(targetSession.id, { request_id: requestId, direction: 'output', kind: 'plan', filename: `wharness-plan-${requestId}.json`, content_type: 'application/json', content_base64: btoa(binary) })
      const updated = await api.manualPlan(targetSession.id, raw)
      const planItem: ChatItem = {
        id: crypto.randomUUID(), role: 'harness', source: 'wharness', presentation: 'notice', createdAt: new Date().toISOString(),
        text: updated.plan?.summary || 'Plano importado do ficheiro JSON.',
        meta: updated.policy?.allowed ? 'Ficheiro importado · Policy validada' : 'Ficheiro importado · Policy bloqueou o plano',
      }

      acceptSessionForChat(targetChat, updated)
      appendChatItem(targetChat, updated.project_path, planItem)
      return `Plano ${updated.plan?.plan_id || requestId} importado e validado no Harness Chat “${targetChat.title}”.`
    } catch (e) {
      const message = messageOf(e)
      setError(message)
      throw new Error(message)
    } finally { if (busyTargetChatId) setChatBusy(busyTargetChatId, false) }
  }


  async function submitBundleFile(contentBase64: string, requestId: string, filename: string, onValidated?: () => Promise<unknown>) {
    if (!session) throw new Error('Nenhum workspace ativo.')
    let busyTargetChatId = ''
    let targetSession: Session | undefined = session
    let targetChat = chats.find((chat) => chat.id === activeChatId)
    setError(undefined)
    try {
      if (!sessionOwnsRequest(targetSession, requestId)) {
        targetSession = undefined; targetChat = undefined
        for (const chat of chats) {
          if (chat.id === activeChatId) continue
          try {
            const candidate = await api.getSession(chat.sessionId)
            if (sessionOwnsRequest(candidate, requestId)) { targetSession = candidate; targetChat = chat; break }
          } catch (error) {
            if (!(error instanceof APIError) || error.status !== 404) throw error
          }
        }
      }
      if (!targetSession || !targetChat) throw new BundleRoutingError(`O bundle pertence ao pedido ${requestId}, mas esse pedido não pertence a nenhum Harness Chat deste workspace.`)
      busyTargetChatId = targetChat.id
      setChatBusy(busyTargetChatId, true)
      setPreparedDrafts((current) => { const next = { ...current }; delete next[targetChat!.id]; return next })
      setFailedPromptDeliveries((current) => { const next = { ...current }; delete next[targetChat!.id]; return next })

      const knowledgeReviewResult = targetSession.pending_knowledge_review_request_id === requestId
      const submission = await validatePlannerBundle(() => api.executionBundle(targetSession!.id, filename, contentBase64), onValidated)
      const updated = submission.session
      const resultTitle = plannerChatTitle(updated.last_turn?.chat_title)
      if (resultTitle && targetChat.naming?.state !== 'definitive') {
        const updatedAt = new Date().toISOString()
        const naming: ChatNaming = {
          state: 'definitive', attempts: (targetChat.naming?.attempts || 0) + 1,
          lastAttemptAt: updatedAt, projectAssigned: Boolean(targetChat.chatgptUrl),
        }
        updateWorkspaceChat(targetChat.id, updated.project_path, { title: resultTitle, naming })
        targetChat = { ...targetChat, title: resultTitle, naming, updatedAt }
        if (targetChat.engine !== 'codex' && targetChat.chatgptUrl && isDesktop()) {
          try {
            await desktopBridge()?.chatgpt.queueRename({
              cacheKey: targetChat.id, url: targetChat.chatgptUrl, sessionId: updated.id,
              projectId: updated.project_path, projectName: chatGPTProjectName(updated.project_path), title: resultTitle,
            })
          } catch (cause) {
            console.warn(`[chat-title] planner title accepted locally but remote rename was not queued: ${messageOf(cause)}`)
          }
        }
      }
      // A pending-approval pause (network access, high-risk command, an
      // offline Go module cache that needs a restricted-network retry) is not
      // a failure: the commandbar already shows the exact action to take.
      // Keying off structured session state (never auto_error prose) is what
      // tells this apart from a genuine automation failure below.
      const pendingDebugApproval = updated.state === 'debug_approval_required'
      const pendingApproval = Boolean(submission.auto_error && ((updated.policy?.allowed && sessionNeedsExecutionConsent(updated)) || updated.failure_kind === 'offline_go_module_cache' || pendingDebugApproval))
      const plannerFailed = updated.last_turn?.outcome?.status === 'failed' || updated.last_turn?.outcome?.status === 'partial'
      const policyReason = (submission.policy_reasons || updated.policy?.reasons || []).join('; ')
      const workflowRound = submission.workflow_round || updated.workflow_round || 0
      const contextIncrement = submission.context_incremented === true
      const autoText = submission.remote_recovery_prepared
        ? `O resultado remoto terminou como retryable. O WHX registou a causa e preparou automaticamente um único pedido novo com contexto e base imutável atuais.`
        : submission.policy_blocked
        ? `Bundle bloqueado pela Policy antes da execução: ${policyReason || 'plano não permitido'}.${submission.repair_prepared ? ' O Wharnex preparou automaticamente um novo pedido de correção.' : ''}`
		: submission.conflict_prepared
		  ? `O ChangeSet foi verificado, mas encontrou um conflito real. O Wharnex preparou uma janela ChatGPT dedicada para resolver apenas ${updated.integration_conflict?.paths.join(', ') || 'os caminhos conflitantes'}.`
        : contextIncrement
          ? contextIncrementNotice(workflowRound)
        : submission.workflow_prepared
          ? `Passo local ${workflowRound}/6 concluído na sandbox Protected. Os resultados foram incorporados numa continuação para o mesmo ChatGPT; o Wharnex vai submetê-la automaticamente.`
          : submission.workflow_executed
            ? `Passo local ${workflowRound}/6 executado na sandbox Protected. Nenhuma alteração deste passo foi aplicada ao host.`
            : submission.auto_applied
              ? (submission.restart_required ? 'Bundle validado. O plano foi verificado na sandbox, aplicado ao próprio Wharnex e reconstruído no host. O reinício aguarda confirmação.' : 'Bundle validado. O plano foi executado na sandbox e aplicado automaticamente ao host.')
              : pendingApproval
                ? (pendingDebugApproval
                  ? `Bundle de debug validado. O probe seguro para ${updated.plan?.debug?.target === 'host' ? 'o host local' : 'a sandbox isolada'} aguarda a autorização única desta Main Request.`
                  : updated.failure_kind === 'offline_go_module_cache'
                  ? 'Bundle validado. A execução automática pausou porque a verificação Go precisa do cache de módulos, que ainda não está hidratado offline. Abra o resumo de alertas e use "Permitir rede e repetir" para continuar.'
                  : `Bundle validado. A execução automática pausou porque este plano precisa da sua aprovação explícita${policyReason ? ` (${policyReason})` : ''}. Abra o resumo de alertas e use "Aprovar e executar" para continuar.`)
                : submission.auto_executed
                  ? (submission.auto_error ? `Bundle validado e execução automática iniciada, mas falhou: ${submission.auto_error}` : 'Bundle validado e executado automaticamente na sandbox.')
                  : 'Bundle ZIP importado e plano validado.'
      const conversational = updated.last_turn && updated.last_turn.kind !== 'change' && updated.last_turn.kind !== 'workflow'
      const isPlanProposal = updated.last_turn?.kind === 'plan'
      const planRequestId = isPlanProposal ? (updated.last_turn?.request_id || requestId) : ''
      if (isPlanProposal && planRequestId) {
        updateWorkspaceChat(targetChat.id, updated.project_path, { pendingPlan: { requestId: planRequestId, originalMessage: targetChat.pendingPlan?.originalMessage }, requestMode: 'direct' })
      }
      const bundleItem: ChatItem = {
        id: crypto.randomUUID(), role: 'harness', source: plannerFailed || submission.policy_blocked || submission.workflow_executed || pendingApproval ? 'wharness' : 'chatgpt', presentation: plannerFailed ? 'notice' : (isPlanProposal ? 'plan' : (submission.policy_blocked || submission.workflow_executed || pendingApproval ? 'notice' : 'message')), createdAt: new Date().toISOString(), text: plannerFailed ? `${updated.last_turn?.message || 'O ChatGPT não concluiu o pedido.'}\n\n${updated.last_turn?.outcome?.message || updated.last_repair_error || ''}\n\nPode corrigir o prompt, acrescentar contexto/anexos, ativar outro transporte ou repetir o pedido.` : (submission.policy_blocked || pendingApproval ? autoText : (submission.workflow_executed ? `${autoText}${updated.last_turn?.message ? `\n\n${updated.last_turn.message}` : ''}` : (conversational ? updated.last_turn!.message : (updated.last_turn?.message || updated.plan?.summary || autoText)))),
        approval: isPlanProposal && planRequestId ? { status: 'pending', requestId: planRequestId, originalMessage: targetChat.pendingPlan?.originalMessage } : undefined,
        meta: plannerFailed
          ? `Pedido não concluído · ${updated.last_turn?.outcome?.retryable ? 'pode ser repetido' : 'requer intervenção'}`
		  : submission.remote_recovery_prepared
		  ? `Recuperação automática · ${updated.last_request_id || ''}`
		  : submission.policy_blocked
          ? `Policy bloqueada${submission.repair_prepared ? ' · reparação automática preparada' : ''}`
		  : submission.conflict_prepared
		  ? 'Conflito real · GPT dedicado'
          : contextIncrement
            ? contextIncrementMeta(workflowRound, updated.context_paths?.length || 0)
          : submission.workflow_prepared || submission.workflow_executed
            ? `Workflow ${workflowRound}/6 · sandbox Protected`
            : pendingApproval
              ? (pendingDebugApproval ? 'Aguarda autorização · Debug' : updated.failure_kind === 'offline_go_module_cache' ? 'Aguarda aprovação · rede restrita' : 'Aguarda aprovação · Policy')
              : conversational ? turnMeta(updated.last_turn!.kind) : (submission.auto_applied ? (submission.restart_required ? 'AUTO-EVOLUÇÃO · reinício pendente' : 'AUTO · Host aplicado') : (updated.policy?.allowed ? `Bundle ${filename} · Policy validada` : `Bundle ${filename} · Policy bloqueada`)),
        turnKind: updated.last_turn?.kind,
		interview: updated.last_turn?.interview,
        iteration: updated.last_turn?.request_id ? iterationRef(updated.last_turn.request_id, plannerFailed ? 'failed' : 'result', plannerFailed || updated.last_execution?.success === false ? ['error', 'result'] : ['result'], targetChat.chatgptUrl) : undefined,
      }
      acceptSessionForChat(targetChat, updated)
      if (targetChat.id === activeChatIdRef.current) setManualPrompt(updated.last_manual_prompt || '')
      const waitingForKnowledgeReview = submission.auto_applied && Boolean(updated.pending_knowledge_review_request_id)
      if (waitingForKnowledgeReview && isAutomaticAutomationMode(updated.automation_mode) && updated.last_manual_prompt) {
        const dispatchKey = `knowledge:${targetChat.id}:${updated.pending_knowledge_review_request_id}`
        if (!baselineSeenRef.current.has(dispatchKey)) {
          baselineSeenRef.current.add(dispatchKey)
          try {
            await transportPlannerContinuation(updated, targetChat)
          } catch (sendError) {
            baselineSeenRef.current.delete(dispatchKey)
            throw sendError
          }
        }
      }
      const appliedTerminalPackage = knowledgeReviewResult || (submission.auto_applied && !waitingForKnowledgeReview)
      if (waitingForKnowledgeReview) {
        appendChatItem(targetChat, updated.project_path, {
          id: crypto.randomUUID(), role: 'harness', source: 'wharness', presentation: 'notice', createdAt: new Date().toISOString(),
          text: isAutomaticAutomationMode(updated.automation_mode) ? 'Alterações incorporadas no host. A revisão final foi enviada ao ChatGPT antes de apresentar o resultado aplicado.' : 'Alterações incorporadas no host. A revisão final está preparada; envie-a ao ChatGPT para concluir a apresentação.',
          meta: 'Host aplicado · revisão final',
        })
      } else if (appliedTerminalPackage) {
        // `presentAppliedSession` owns the whole terminal package: one
        // cumulative GPT summary followed by the diff card. Appending the
        // transient turn message here produced two GPT answers and left the
        // diff stranded before the final summary.
        presentAppliedSession(targetChat, updated)
      } else {
        const cumulativeSummary = updated.last_main_request_summary?.trim()
        appendChatItem(targetChat, updated.project_path, cumulativeSummary ? {
          ...bundleItem,
          text: cumulativeSummary,
          meta: 'Resumo cumulativo da Main Request',
        } : bundleItem)
      }
      if (submission.auto_error && !pendingApproval) reportChatError(`A execução automática do bundle falhou:\n\n${submission.auto_error}`, 'Execução do bundle falhou', targetChat, updated.project_path)
      if (submission.auto_executed && updated.last_execution) updateWorkspaceChat(targetChat.id, updated.project_path, { artifactSelection: { ...targetChat.artifactSelection, result: true, error: updated.last_execution.success === false } })
      if (submission.auto_applied) {
        markContextDirtyForOtherChats(updated.project_path, targetChat.id)
        void syncPeerBaselineUpdates(updated.project_path, targetChat.id)
      }
      let workflowSubmitted = false
      if (submission.conflict_prepared && updated.state === 'conflict_resolution_pending' && updated.last_manual_prompt) {
		await submitConflictPrompt(updated, targetChat)
	  } else if (submission.remote_recovery_prepared && updated.state === 'awaiting_plan' && updated.last_manual_prompt) {
        const dispatchKey = `auto-terminal-recovery:${targetChat.id}:${updated.last_request_id || requestId}`
        if (!repairDispatchRef.current.has(dispatchKey)) {
          repairDispatchRef.current.add(dispatchKey)
          await transportPlannerContinuation(updated, targetChat)
        }
      } else if (submission.workflow_prepared && updated.state === 'workflow_pending' && updated.last_manual_prompt) {
        workflowSubmitted = await submitWorkflowPrompt(updated, targetChat)
      } else if (updated.state === 'repair_pending' && updated.last_manual_prompt) {
        await submitRepairPrompt(updated, targetChat)
      } else if (updated.state === 'baseline_update_pending' && updated.last_manual_prompt && isAutomaticAutomationMode(updated.automation_mode)) {
        const dispatchKey = `dispatch:${targetChat.id}:${updated.last_request_id || requestId}`
        if (!baselineSeenRef.current.has(dispatchKey)) {
          baselineSeenRef.current.add(dispatchKey)
          await transportPlannerContinuation(updated, targetChat)
        }
      }
      return submission.auto_applied
        ? (submission.restart_required ? `Bundle ${filename} aplicado ao próprio Wharnex; build do host concluído e reinício pendente de confirmação.` : `Bundle ${filename} executado e aplicado automaticamente no Harness Chat “${targetChat.title}”.`)
        : submission.workflow_prepared
          ? workflowSubmitted
            ? contextIncrement
              ? `Contexto incrementado e continuação submetida no Harness Chat “${targetChat.title}”.`
              : `Passo ${workflowRound}/6 executado e continuação submetida no Harness Chat “${targetChat.title}”.`
            : contextIncrement
              ? `Contexto incrementado; a continuação ficou pendente no Harness Chat “${targetChat.title}”.`
              : `Passo ${workflowRound}/6 executado; a continuação ficou pendente no Harness Chat “${targetChat.title}”.`
          : `Bundle ${filename} importado no Harness Chat “${targetChat.title}”.`
    } catch (e) {
		const message = messageOf(e)
		if (isNonTerminalBundleRoutingError(e)) {
			return deferBundleRouting(e, () => setError(undefined))
		}
		// A downloaded bundle can still be rejected by strict protocol
		// validation. It is terminal for this request: do not leave the chat
		// waiting for a bundle that was already received and refused.
		if (targetSession && targetChat && sessionHasPendingRequest(targetSession, requestId)) {
			const failureKind = bundleFailureKind(e)
			const failurePrefix = failureKind === 'submodule_write'
				? 'Alteração rejeitada por visar um submódulo sem checkout utilizável'
				: 'Falha de protocolo ao validar o bundle'
			const recovered = await failRemoteInput(requestId, `${failurePrefix}: ${message}`, failureKind, targetSession, targetChat)
			if (recovered?.last_request_id && recovered.last_request_id !== requestId) return `Bundle recusado; recuperação automática ${recovered.last_request_id} preparada.`
		} else {
			reportChatError(`Falha ao importar o bundle: ${message}`, 'Falha no bundle')
		}
		throw new Error(message)
    } finally { if (busyTargetChatId) setChatBusy(busyTargetChatId, false) }
  }

  async function restoreChatGPTConversationAffinity(targetChat: WorkspaceChat) {
    const bridge = desktopBridge()
    const linked = chatgptConversationURL(targetChat.chatgptUrl || '')
    if (!bridge || !linked) return true
    const current = chatgptConversationURL((await bridge.chatgpt.state(targetChat.id)).url)
    if (!current || sameChatGPTConversation(current, linked)) return true
    try {
      await bridge.chatgpt.navigate(linked, targetChat.id)
      return true
    } catch (error) {
      setError(`Não foi possível restaurar a conversa ChatGPT permanente: ${messageOf(error)}`)
      return false
    }
  }

  async function execute(approved: boolean, sudoPassword = '') {
    if (!session) return
    const targetSession = session
    const targetChat = chats.find((chat) => chat.id === activeChatId)
    if (!targetChat) return
    const direct = targetSession.execution_mode !== 'protected'
    if (targetSession.execution_mode === 'unprotected' && !(await confirmDialog({
      title: 'Executar em Unprotected?',
      message: 'Este plano será executado diretamente no projeto real. As alterações e comandos não passarão pela sandbox e não terão a etapa Apply.',
      tone: 'danger',
      confirmLabel: 'Executar no host',
    }))) return
    const planId = targetSession.plan?.plan_id || 'unknown-plan'
    const queueKey = `${targetSession.id}:${planId}`
    setExecutionFIFO((current) => {
      const existing = current.find((item) => item.key === queueKey)
      if (existing && executionQueueIsActive(existing)) return current
      const activeCount = current.filter(executionQueueIsActive).length
      return upsertExecutionQueueItem(current, { key: queueKey, chatId: targetChat.id, chatTitle: targetChat.title, planId, status: activeCount ? 'queued' : 'submitting', position: activeCount + 1, addedAt: Date.now() })
    })
    let terminalStatus: 'completed' | 'failed' = 'failed'
    setChatBusy(targetChat.id, true); setError(undefined)
    try {
      const response = await api.execute(targetSession.id, targetSession.execution_mode === 'unprotected' ? true : approved, sudoPassword)
      acceptSessionForChat(targetChat, response.session)
      const ok = response.session.last_execution?.success
      const autoApplied = !direct && ok && (response.session.state === 'applied' || response.session.state === 'restart_pending')
      terminalStatus = ok ? 'completed' : 'failed'
      const warnings = response.session.last_execution?.warnings || []
      if (response.session.last_execution) updateWorkspaceChat(targetChat.id, response.session.project_path, { artifactSelection: { ...targetChat.artifactSelection, result: true, error: !ok } })
      if ((direct || autoApplied) && ok) {
        markContextDirtyForOtherChats(response.session.project_path, targetChat.id)
        void syncPeerBaselineUpdates(response.session.project_path, targetChat.id)
      }
      appendChatItem(targetChat, response.session.project_path, {
        id: crypto.randomUUID(), role: 'harness', source: 'wharness', presentation: 'notice', createdAt: new Date().toISOString(),
        text: ok ? (direct ? `Plano executado diretamente no host em modo ${response.session.execution_mode === 'full' ? 'Full' : 'Unprotected'}. Não há etapa Apply.` : autoApplied ? 'A aprovação foi consumida uma única vez: o plano passou pela sandbox Protected e foi aplicado automaticamente ao host.' : (warnings.length ? 'Execução concluída na sandbox. As falhas de verificação já existentes na baseline permaneceram inalteradas; o plano não introduziu novas regressões nesses gates.' : 'Execução e verificações concluídas na sandbox. O host ainda não foi alterado.')) : 'A execução terminou com falha.',
        meta: (direct || autoApplied) && ok ? 'Host atualizado' : (warnings.length ? `${warnings.length} dívida(s) pré-existente(s)` : undefined),
      })
      if (!ok) reportChatError(errorArtifact(response.session) || 'A execução terminou com falha.', 'Execução falhou', targetChat, response.session.project_path)
    } catch (e) {
      const message = messageOf(e)
      const payload = e instanceof APIError ? e.data as { session?: Session } | undefined : undefined
      const failedSession = payload?.session
      if (failedSession) {
        acceptSessionForChat(targetChat, failedSession)
        if (activeChatIdRef.current === targetChat.id) setManualPrompt(failedSession.last_manual_prompt || '')
        updateWorkspaceChat(targetChat.id, failedSession.project_path, { sessionId: failedSession.id, artifactSelection: { ...targetChat.artifactSelection, result: Boolean(failedSession.last_execution), error: true } })
      } else if (activeChatIdRef.current === targetChat.id) {
        try { acceptSessionForChat(targetChat, await api.getSession(targetSession.id)) } catch { /* retain last known target state */ }
      }
      reportChatError(failedSession ? errorArtifact(failedSession) || message : message, 'Execução falhou', targetChat, failedSession?.project_path || targetSession.project_path)
      if (failedSession?.state === 'repair_pending' && failedSession.last_manual_prompt) await submitRepairPrompt(failedSession, targetChat)
    } finally {
      setExecutionFIFO((current) => finishExecutionQueueItem(current, queueKey, terminalStatus))
      setChatBusy(targetChat.id, false)
    }
  }

  async function resolveInterruptedExecution(target: { chat: WorkspaceChat; session: Session }, decision: 'continue' | 'discard', sudoPassword = '') {
    const intent = target.session.interrupted_execution
    if (!intent) return
    setChatBusy(target.chat.id, true); setError(undefined)
    try {
      const updated = decision === 'continue'
        ? (await api.resumeInterruptedExecution(target.session.id, sudoPassword)).session
        : await api.discardInterruptedExecution(target.session.id)
      setInterruptedExecutions((current) => decision === 'discard' || !updated.interrupted_execution
        ? current.filter((candidate) => candidate.session.id !== target.session.id)
        : current.map((candidate) => candidate.session.id === target.session.id ? { ...candidate, session: updated } : candidate))
      acceptSessionForChat(target.chat, updated)
      appendChatItem(target.chat, updated.project_path, {
        id: crypto.randomUUID(), role: 'harness', source: 'wharness', presentation: 'notice', createdAt: new Date().toISOString(),
        text: decision === 'continue' ? `Retomada iniciada em segundo plano: ${intent.plan_id}. Pode continuar a trabalhar enquanto o Wharnex acompanha a execução.` : `Execução pendente descartada: ${intent.plan_id}.`,
      })
    } catch (resolveError) {
      // A session the backend no longer has (e.g. cleared/reset data) can
      // never be recovered or discarded through the normal API calls above —
      // both keep failing identically. Silently retaining the card in that
      // case left it permanently stuck with no way to dismiss it. Only a
      // transient failure (backend unreachable, anything but 404) should
      // retain the card for a later retry.
      if (resolveError instanceof APIError && resolveError.status === 404) {
        setInterruptedExecutions((current) => current.filter((candidate) => candidate.session.id !== target.session.id))
        appendChatItem(target.chat, target.session.project_path, {
          id: crypto.randomUUID(), role: 'harness', source: 'wharness', presentation: 'notice', createdAt: new Date().toISOString(),
          text: `Esta execução pendente (${intent.plan_id}) já não existe no backend e foi removida da recuperação.`,
        })
        return
      }
      setError(messageOf(resolveError))
      try {
        const refreshed = await api.getSession(target.session.id)
        setInterruptedExecutions((current) => current.map((candidate) => candidate.session.id === refreshed.id ? { ...candidate, session: refreshed } : candidate).filter((candidate) => Boolean(candidate.session.interrupted_execution)))
        acceptSessionForChat(target.chat, refreshed)
      } catch (refreshError) {
        if (refreshError instanceof APIError && refreshError.status === 404) {
          setInterruptedExecutions((current) => current.filter((candidate) => candidate.session.id !== target.session.id))
        }
        /* otherwise retain the recovery choice until the backend is reachable */
      }
    } finally { setChatBusy(target.chat.id, false) }
  }


  async function focusRecoveryTarget(target: InterruptedExecutionTarget, tab?: 'terminal' | 'chatgpt') {
    if (target.chat.id !== activeChatIdRef.current) await selectChat(target.chat.id)
    setMode('agent')
    if (tab) setInspectorAttention((current) => ({ tab, nonce: current.nonce + 1 }))
  }

  async function transportPlannerContinuation(promptSession: Session, targetChat: WorkspaceChat, options?: { forceContext?: boolean }) {
    const text = promptSession.last_manual_prompt || ''
    if (!text) throw new Error('Continuação do planner vazia.')
    const continuationArtifacts = continuationArtifactSelection(promptSession)
    const continuationRequestId = activePendingRequestId(promptSession)
    if (!isDesktop()) throw new Error('O loop automático com ChatGPT requer Wharnex Desktop.')
    await new Promise<void>((resolve) => window.setTimeout(resolve, 220))
    const bridge = desktopBridge()
    if (!bridge) throw new Error('Desktop bridge indisponível')
    const artifacts = await encodeSystemArtifacts(promptSession, continuationArtifacts)
    const prepared = await dispatchPlannerContinuation({ bridge, session: promptSession, chat: targetChat, artifacts, includeContext: options?.forceContext ?? continuationArtifacts.context, request: { cacheKey: targetChat.id, background: true, workspaceChatId: targetChat.id, requestId: continuationRequestId, reasoningEffort: promptSession.reasoning_effort || 'high' } })
	const bindingAccepted = prepared.conversationUrl ? bindChatGPTURLForOwnedKey(targetChat.id, promptSession.project_path, prepared.conversationUrl) : true
    const patch: Partial<WorkspaceChat> = {}
	if (!prepared.queued && prepared.includedContext && bindingAccepted) {
      patch.lastContextSha256 = sessionContextSHA(promptSession)
      patch.lastContextChatgptUrl = prepared.conversationUrl || targetChat.chatgptUrl
    }
    if (Object.keys(patch).length) updateWorkspaceChat(targetChat.id, promptSession.project_path, patch)
    return prepared
  }

	async function submitConflictPrompt(conflictedSession: Session, targetChat: WorkspaceChat, force = false) {
		const conflict = conflictedSession.integration_conflict
		if (!conflict || !conflictedSession.last_manual_prompt) return
		const dispatchKey = `conflict:${conflictedSession.id}:${conflict.request_id}`
		if (force) repairDispatchRef.current.delete(dispatchKey)
		if (!force && (repairDispatchRef.current.has(dispatchKey) || requestAlreadyRecorded(conflictedSession.project_path, targetChat.id, conflict.request_id, ['prepared', 'submitted']))) return
		repairDispatchRef.current.add(dispatchKey)
		appendChatItem(targetChat, conflictedSession.project_path, {
			id: `conflict-${conflict.request_id}`, role: 'harness', source: 'wharness', presentation: 'notice', createdAt: new Date().toISOString(),
			text: `Foi detetado um conflito real em ${conflict.paths.join(', ')}. A resolução GPT continuará na conversa ChatGPT já vinculada a este chat.`,
			meta: `Conflito ${conflict.id} · mesma conversa`,
			iteration: iterationRef(conflict.request_id, 'conflict', selectedArtifactKinds(continuationArtifactSelection(conflictedSession)), targetChat.chatgptUrl),
		})
		try {
			const prepared = await transportPlannerContinuation(conflictedSession, targetChat, { forceContext: true })
			appendChatItem(targetChat, conflictedSession.project_path, {
				id: `conflict-dispatch-${conflict.request_id}`, role: 'harness', source: 'wharness', presentation: 'notice', createdAt: new Date().toISOString(),
				text: prepared.submitted ? 'Capsule de conflito enviado automaticamente na conversa ChatGPT vinculada.' : 'Capsule preparado na conversa vinculada; confirme o envio para continuar.',
				meta: prepared.submitted ? 'Resolução de conflito em curso' : 'Resolução aguarda confirmação',
				iteration: iterationRef(conflict.request_id, prepared.submitted ? 'submitted' : 'prepared', selectedArtifactKinds(continuationArtifactSelection(conflictedSession)), prepared.conversationUrl || targetChat.chatgptUrl),
			})
		} catch (error) {
			repairDispatchRef.current.delete(dispatchKey)
			setError(`Falha ao preparar a conversa vinculada para resolver o conflito: ${messageOf(error)}`)
		}
	}

	async function resolveConflictWithGPT(conflictedSession: Session) {
		const ownerChatId = conflictedSession.chat_id || activeChatId
		const targetChat = chats.find((chat) => chat.id === ownerChatId)
		if (!targetChat) throw new Error('Não foi possível localizar o chat deste conflito.')
		await submitConflictPrompt(conflictedSession, targetChat)
	}

	// GPT-only Git conflicts are resolved in their own chat and ChatGPT
	// conversation, never inside the chat whose Git surface detected them.
	async function openGitConflictChat(source: Session) {
		hideChatGPTSurfaces(chats.find((chat) => chat.id === activeChatIdRef.current))
		const chatId = crypto.randomUUID()
		const created = await api.createSession(source.project_path, executionMode, automationMode, chatId, effortLevel)
		const dedicated = await api.handoffGitConflict(source.id, created.id)
		const chat = newWorkspaceChat(dedicated.id, gitConflictChatTitle(dedicated), chatId)
		await api.saveWorkspaceChat(durableWorkspaceChat(dedicated.project_path, chat))
		persistChats(dedicated.project_path, [chat, ...chats])
		transcriptReadyRef.current.add(chat.id)
		activeChatIdRef.current = chat.id; setActiveChatId(chat.id); setSession(dedicated); setItems([welcomeItem(dedicated)])
		setEvents([]); setManualPrompt(dedicated.last_manual_prompt || ''); setChatTransportMode(dedicated.chat_transport_mode || 'scraper'); setMode('agent'); connectEvents(dedicated.id, dedicated.project_path, chat.id)
		await submitConflictPrompt(dedicated, chat)
	}

  async function submitWorkflowPrompt(workflowSession: Session, targetChat: WorkspaceChat, force = false): Promise<boolean> {
    const round = workflowSession.workflow_round || 1
    const requestId = workflowSession.last_request_id || ''
    if (!force && requestAlreadyRecorded(workflowSession.project_path, targetChat.id, requestId, ['workflow'])) return false
    appendChatItem(targetChat, workflowSession.project_path, {
      id: `workflow-${requestId || round}`, role: 'harness', source: 'wharness', presentation: 'notice', createdAt: new Date().toISOString(),
      text: `O Wharnex terminou o passo local ${round}/6 e vai devolver stdout, stderr e códigos de saída ao mesmo ChatGPT para decidir o próximo passo.`,
      meta: workflowSession.last_request_id ? `Workflow ${round}/6 · ${workflowSession.last_request_id}` : `Workflow ${round}/6`,
      turnKind: 'workflow',
      iteration: workflowSession.last_request_id ? iterationRef(workflowSession.last_request_id, 'workflow', selectedArtifactKinds(continuationArtifactSelection(workflowSession)), targetChat.chatgptUrl) : undefined,
    })
    try {
      const prepared = await transportPlannerContinuation(workflowSession, targetChat)
      appendChatItem(targetChat, workflowSession.project_path, {
        id: `workflow-dispatch-${requestId || round}`, role: 'harness', source: 'wharness', presentation: 'notice', createdAt: new Date().toISOString(),
        text: prepared.submitted
          ? 'Resultados locais submetidos automaticamente ao ChatGPT. O Wharnex aguarda a próxima decisão ou o encerramento do fluxo.'
          : 'A continuação foi preparada no ChatGPT, mas ainda precisa de confirmação manual.',
        meta: prepared.submitted ? `Workflow ${round}/6 · ChatGPT acionado` : `Workflow ${round}/6 · confirmação pendente`,
        turnKind: 'workflow',
        iteration: workflowSession.last_request_id ? iterationRef(workflowSession.last_request_id, prepared.submitted ? 'submitted' : 'prepared', selectedArtifactKinds({ ...continuationArtifactSelection(workflowSession), context: prepared.includedContext }), prepared.conversationUrl || targetChat.chatgptUrl) : undefined,
      })
      return prepared.submitted
    } catch (sendError) {
      appendChatItem(targetChat, workflowSession.project_path, {
        id: crypto.randomUUID(), role: 'harness', source: 'wharness', presentation: 'notice', createdAt: new Date().toISOString(),
        text: `O passo local terminou, mas não foi possível devolver os resultados automaticamente ao ChatGPT: ${messageOf(sendError)}`,
        meta: `Workflow ${round}/6 · abra a aba ChatGPT`,
        turnKind: 'workflow',
      })
      setError(messageOf(sendError))
      return false
    }
  }

  async function submitRepairPrompt(failedSession: Session, targetChat: WorkspaceChat, force = false) {
    const repairPrompt = failedSession.last_manual_prompt || ''
    if (!repairPrompt) return
    const repairAttempt = failedSession.repair_attempt || 1
    const attempt = failedSession.automation_attempt || repairAttempt + 1
    const limit = effortAttemptLimit(failedSession.effort_level || 'medium')
    const attemptLabel = limit ? `${attempt}/${limit}` : `${attempt}/∞`
    const improvement = Boolean(failedSession.improvement_attempt) && !failedSession.last_repair_error
    const requestId = failedSession.last_request_id || ''
    const restoringRevert = failedSession.request_lineages?.[requestId]?.kind === 'revert_restore'
    const dispatchKey = `${failedSession.id}:${requestId || attempt}`
    if (force) repairDispatchRef.current.delete(dispatchKey)
    if (!force && (repairDispatchRef.current.has(dispatchKey) || requestAlreadyRecorded(failedSession.project_path, targetChat.id, requestId, ['repair', 'prepared', 'submitted']))) {
      repairDispatchRef.current.add(dispatchKey)
      return
    }
    repairDispatchRef.current.add(dispatchKey)
    const cause = truncateRepairCause(failedSession.last_repair_error || failedSession.last_execution?.error)
    appendChatItem(targetChat, failedSession.project_path, {
      id: `repair-${requestId || attempt}`, role: 'harness', source: 'wharness', presentation: 'notice', createdAt: new Date().toISOString(),
      text: improvement ? `O Wharnex preparou a ronda de melhoria contínua ${attemptLabel} e vai enviá-la ao mesmo ChatGPT vinculado. O ChatGPT deve parar se já não houver melhoria material com bom custo/benefício.` : restoringRevert ? `A reposição direta da alteração revertida encontrou um conflito. O Wharnex preparou um pedido de conciliação ${attemptLabel} e vai enviá-lo automaticamente ao mesmo ChatGPT vinculado.${cause ? `\n\n**O que falhou:**\n\n${cause}` : ''}` : `O Wharnex preparou a requisição de correção ${attemptLabel} e vai enviá-la ao mesmo ChatGPT vinculado.${cause ? `\n\n**O que falhou:**\n\n${cause}` : ''}`,
      meta: improvement ? `Melhoria contínua ${failedSession.last_request_id || ''}`.trim() : restoringRevert ? `Reposição ${failedSession.last_request_id || ''}`.trim() : (failedSession.last_request_id ? `Repair ${failedSession.last_request_id}` : 'Repair automático'),
      iteration: failedSession.last_request_id ? iterationRef(failedSession.last_request_id, 'repair', selectedArtifactKinds(continuationArtifactSelection(failedSession)), targetChat.chatgptUrl) : undefined,
    })
    try {
      const prepared = await transportPlannerContinuation(failedSession, targetChat)
      appendChatItem(targetChat, failedSession.project_path, { id: `repair-dispatch-${requestId || attempt}`, role: 'harness', source: 'wharness', presentation: 'notice', createdAt: new Date().toISOString(), text: improvement ? (prepared.submitted ? 'Ronda de melhoria contínua enviada automaticamente ao ChatGPT. O Wharnex aguarda o novo bundle ou a indicação de que não há mais melhorias materiais.' : 'Ronda de melhoria contínua preparada no ChatGPT; confirme o envio para continuar.') : (prepared.submitted ? 'Requisição de correção enviada automaticamente ao ChatGPT em background. O Wharnex vigia agora o download do novo bundle ZIP.' : 'Requisição de correção preparada no ChatGPT; confirme o envio para continuar.'), meta: prepared.submitted ? 'ChatGPT acionado automaticamente' : 'Confirmação pendente', iteration: requestId ? iterationRef(requestId, prepared.submitted ? 'submitted' : 'prepared', selectedArtifactKinds({ ...continuationArtifactSelection(failedSession), context: prepared.includedContext }), prepared.conversationUrl || targetChat.chatgptUrl) : undefined })
    } catch (sendError) {
      repairDispatchRef.current.delete(dispatchKey)
      appendChatItem(targetChat, failedSession.project_path, { id: `repair-failed-${requestId || attempt}`, role: 'harness', source: 'wharness', presentation: 'notice', createdAt: new Date().toISOString(), text: `A requisição de correção foi preparada, mas o envio automático ao ChatGPT falhou: ${messageOf(sendError)}`, meta: 'Abra a aba ChatGPT para retomar', iteration: requestId ? iterationRef(requestId, 'failed', selectedArtifactKinds(continuationArtifactSelection(failedSession)), targetChat.chatgptUrl) : undefined })
      setError(messageOf(sendError))
    }
  }

  async function reprocessPolicyBlock() {
    if (!session || !activeChatId) return
    const targetSession = session
    const targetChat = chats.find((chat) => chat.id === activeChatId)
    if (!targetChat) return
    setBusy(true); setError(undefined)
    try {
      const repaired = await api.retryPolicyRepair(targetSession.id)
      acceptSessionForChat(targetChat, repaired)
      if (activeChatIdRef.current === targetChat.id) setManualPrompt(repaired.last_manual_prompt || '')
      if (!repaired.last_manual_prompt) throw new Error('O Wharnex não conseguiu preparar o reprocessamento deste bundle.')
      if (repaired.state === 'awaiting_plan') {
        const prepared = await transportPlannerContinuation(repaired, targetChat)
        appendChatItem(targetChat, repaired.project_path, {
          id: crypto.randomUUID(), role: 'harness', source: 'wharness', presentation: 'notice', createdAt: new Date().toISOString(),
          text: prepared.submitted ? 'O pedido original foi reenviado ao ChatGPT. O Wharnex aguarda um novo bundle ZIP.' : 'O pedido original foi preparado no ChatGPT; confirme o envio para receber um novo bundle ZIP.',
          meta: prepared.submitted ? 'Reprocessamento enviado' : 'Reprocessamento · confirmação pendente',
          iteration: repaired.last_request_id ? iterationRef(repaired.last_request_id, prepared.submitted ? 'submitted' : 'prepared', selectedArtifactKinds(continuationArtifactSelection(repaired)), prepared.conversationUrl || targetChat.chatgptUrl) : undefined,
        })
        return
      }
      if (repaired.state !== 'repair_pending') throw new Error('O Wharnex não encontrou um bloqueio que possa ser reprocessado.')
      await submitRepairPrompt(repaired, targetChat, true)
    } catch (error) {
      setError(messageOf(error))
    } finally { setBusy(false) }
  }

  async function repairFailureWithGPT(detail: string) {
    if (!session || !activeChatId) return
    const targetSession = session
    const targetChat = chats.find((chat) => chat.id === activeChatId)
    if (!targetChat) return
    setBusy(true); setError(undefined)
    try {
      const repaired = await api.requestFailureRepair(targetSession.id, detail)
      acceptSessionForChat(targetChat, repaired)
      if (activeChatIdRef.current === targetChat.id) setManualPrompt(repaired.last_manual_prompt || '')
      if (repaired.state === 'planned' && repaired.plan) {
        appendChatItem(targetChat, repaired.project_path, {
          id: `manual-repair-plan-${repaired.plan.plan_id}`, role: 'harness', source: 'wharness', presentation: 'notice', createdAt: new Date().toISOString(),
          text: `O GPT devolveu um plano de correção: ${repaired.plan.summary}`,
          meta: `Plano de correção ${repaired.plan.plan_id}`,
          iteration: repaired.last_request_id ? iterationRef(repaired.last_request_id, 'result', ['result'], targetChat.chatgptUrl) : undefined,
        })
        return
      }
      if (!repaired.last_manual_prompt) {
        throw new Error('O Wharnex não conseguiu preparar uma requisição de correção para este erro.')
      }
      if (repaired.state === 'repair_pending') {
        await submitRepairPrompt(repaired, targetChat, true)
      } else if (repaired.state === 'awaiting_plan') {
        const prepared = await transportPlannerContinuation(repaired, targetChat)
        appendChatItem(targetChat, repaired.project_path, {
          id: `manual-repair-${repaired.last_request_id}`, role: 'harness', source: 'wharness', presentation: 'notice', createdAt: new Date().toISOString(),
          text: prepared.submitted ? 'Correção manual enviada ao ChatGPT. O Wharnex aguarda o novo bundle ZIP.' : 'Correção manual preparada no ChatGPT; confirme o envio para continuar.',
          meta: prepared.submitted ? 'Correção GPT enviada' : 'Correção GPT · confirmação pendente',
          iteration: repaired.last_request_id ? iterationRef(repaired.last_request_id, prepared.submitted ? 'submitted' : 'prepared', selectedArtifactKinds(continuationArtifactSelection(repaired)), prepared.conversationUrl || targetChat.chatgptUrl) : undefined,
        })
      } else {
        throw new Error('O Wharnex não conseguiu preparar uma requisição de correção para este erro.')
      }
    } catch (error) {
      setError(messageOf(error))
    } finally { setBusy(false) }
  }

  async function apply() {
    if (!session) return
    const targetSession = session
    const targetChat = chats.find((chat) => chat.id === activeChatId)
    if (!targetChat) return
    setBusy(true); setError(undefined)
    try {
      const updated = await api.apply(targetSession.id)
      acceptSessionForChat(targetChat, updated)
      markContextDirtyForOtherChats(updated.project_path, targetChat.id)
      void syncPeerBaselineUpdates(updated.project_path, targetChat.id)
      const waitingForKnowledgeReview = Boolean(updated.pending_knowledge_review_request_id)
      if (waitingForKnowledgeReview && isAutomaticAutomationMode(updated.automation_mode) && updated.last_manual_prompt) {
        const dispatchKey = `knowledge:${targetChat.id}:${updated.pending_knowledge_review_request_id}`
        if (!baselineSeenRef.current.has(dispatchKey)) {
          baselineSeenRef.current.add(dispatchKey)
          try {
            await transportPlannerContinuation(updated, targetChat)
          } catch (sendError) {
            baselineSeenRef.current.delete(dispatchKey)
            throw sendError
          }
        }
      }
      const notice: ChatItem = { id: crypto.randomUUID(), role: 'harness', source: 'wharness', presentation: 'notice', createdAt: new Date().toISOString(), text: waitingForKnowledgeReview ? (isAutomaticAutomationMode(updated.automation_mode) ? 'Alterações incorporadas no host. A revisão final foi enviada ao ChatGPT antes de apresentar o resultado aplicado.' : 'Alterações incorporadas no host. A revisão final está preparada; envie-a ao ChatGPT para concluir a apresentação.') : (updated.self_evolution ? 'Auto-evolução aplicada: a sandbox passou e o host foi reconstruído. O novo runtime só será ativado quando confirmar o reinício.' : 'Patch aplicado ao projeto real após a verificação da sandbox.'), meta: waitingForKnowledgeReview ? 'Host aplicado · revisão final' : (updated.self_evolution ? 'AUTO-EVOLUÇÃO · reinício pendente' : 'Host alterado') }
      mutateChatItems(targetChat, updated.project_path, (current) => mergeAppliedChangePresentationItems([...current, notice], waitingForKnowledgeReview ? [] : appliedChangePresentationItems(updated)))
    } catch (e) {
      setError(messageOf(e))
      try {
        const latest = await api.getSession(targetSession.id)
        acceptSessionForChat(targetChat, latest)
        if (activeChatIdRef.current === targetChat.id) setManualPrompt(latest.last_manual_prompt || '')
        if (latest.state === 'repair_pending' && latest.last_manual_prompt) {
          await submitRepairPrompt(latest, targetChat)
        }
      } catch { /* retain the original Apply error */ }
    } finally { setBusy(false) }
  }

  async function retryDependencyNetwork() {
    if (!session || busy) return
    const targetSession = session
    const targetChat = chats.find((chat) => chat.id === activeChatId)
    if (!targetChat || !(await confirmDialog({
      title: 'Permitir rede temporária na sandbox?',
      message: 'Somente comandos Go de dependências, build e teste deste plano serão repetidos com rede. A sandbox continua sem Docker socket, sem privilégios e sem acesso ao projeto original.',
      tone: 'warning',
      confirmLabel: 'Permitir e repetir',
    }))) return
    setBusy(true); setError(undefined)
    try {
      acceptSessionForChat(targetChat, await api.retryDependencyNetwork(targetSession.id))
    } catch (cause) {
      setError(messageOf(cause))
      // The dependency retry may have executed successfully and then failed on
      // a later verification command. Refresh before unlocking the UI so a
      // stale offline_go_module_cache session cannot expose the retry button a
      // second time after the backend has already advanced to repair_pending.
      try { acceptSessionForChat(targetChat, await api.getSession(targetSession.id)) } catch { /* keep the original retry error */ }
    } finally { setBusy(false) }
  }

  async function retryHostDependencyRepair() {
    if (!session || busy) return
    const targetSession = session
    const targetChat = chats.find((chat) => chat.id === activeChatId)
    if (!targetChat || !(await confirmDialog({
      title: 'Reinstalar dependências do host?',
      message: 'A mesma verificação passou na sandbox Protected mas falhou no host por uma dependência npm nativa/opcional ausente em node_modules (bug conhecido do npm com dependências opcionais). O Wharnex vai rodar, direto no host e sem sudo:\n\n  rm -rf node_modules\n  rm -f package-lock.json\n  npm install\n\nSe a build passar de novo, o Apply é repetido automaticamente.',
      tone: 'warning',
      confirmLabel: 'Reinstalar e repetir',
    }))) return
    setBusy(true); setError(undefined)
    try {
      acceptSessionForChat(targetChat, await api.retryHostDependencyRepair(targetSession.id))
    } catch (cause) {
      setError(messageOf(cause))
      // The repair may have reinstalled cleanly and then failed a later
      // reverification/apply step. Refresh before unlocking the UI so a
      // stale host_dependency_state session cannot expose this button a
      // second time after the backend already advanced past it.
      try { acceptSessionForChat(targetChat, await api.getSession(targetSession.id)) } catch { /* keep the original repair error */ }
    } finally { setBusy(false) }
  }

  async function rejectPendingChanges() {
    if (!session) return
    const targetSession = session
    const targetChat = chats.find((chat) => chat.id === activeChatId)
    if (!targetChat || !(await confirmDialog({
      title: 'Rejeitar alterações pendentes?',
      message: 'Todas as alterações verificadas que ainda não foram aplicadas serão descartadas. O projeto real permanecerá inalterado.',
      tone: 'warning',
      confirmLabel: 'Rejeitar alterações',
    }))) return
    setBusy(true); setError(undefined)
    try {
      const updated = await api.rejectPendingChanges(targetSession.id)
      acceptSessionForChat(targetChat, updated)
      appendChatItem(targetChat, updated.project_path, {
        id: crypto.randomUUID(), role: 'harness', source: 'wharness', presentation: 'notice', createdAt: new Date().toISOString(),
        text: 'Todas as alterações pendentes foram rejeitadas. A candidata verificada foi descartada e nada foi incorporado no host.',
        meta: 'Host inalterado',
      })
    } catch (e) { setError(messageOf(e)) } finally { setBusy(false) }
  }

  async function rejectExecutionPlan() {
    if (!session?.plan || busy) return
    const targetSession = session
    const targetChat = chats.find((chat) => chat.id === activeChatId)
    if (!targetChat || !(await confirmDialog({
      title: 'Rejeitar plano de execução?',
      message: 'O plano será encerrado sem executar comandos nem alterar o host. O documento continuará no histórico durável do chat.',
      tone: 'warning',
      confirmLabel: 'Rejeitar plano',
    }))) return
    setBusy(true); setError(undefined)
    try {
      const updated = await api.rejectExecutionPlan(targetSession.id)
      acceptSessionForChat(targetChat, updated)
      appendChatItem(targetChat, updated.project_path, {
        id: crypto.randomUUID(), role: 'harness', source: 'wharness', presentation: 'notice', createdAt: new Date().toISOString(),
        text: 'Plano de execução rejeitado. Nenhum comando foi executado e o host permaneceu inalterado.',
        meta: 'Plano rejeitado',
      })
    } catch (cause) { setError(messageOf(cause)) } finally { setBusy(false) }
  }

  async function controlExecutionPlan(action: 'pause' | 'resume' | 'suspend') {
    if (!session?.plan) return
    const targetSession = session
    const targetChat = chats.find((chat) => chat.id === activeChatId)
    if (!targetChat) return
    setError(undefined)
    try {
      let updated = await api.controlExecutionPlan(targetSession.id, action)
      acceptSessionForChat(targetChat, updated)
      if (action === 'resume') {
        if ((updated.pending_host_changes?.length || 0) > 0) {
          updated = await api.apply(updated.id)
          acceptSessionForChat(targetChat, updated)
          markContextDirtyForOtherChats(updated.project_path, targetChat.id)
          void syncPeerBaselineUpdates(updated.project_path, targetChat.id)
        } else if (updated.state === 'planned' && updated.plan && !updated.interrupted_execution) {
          const response = await api.execute(updated.id, true)
          updated = response.session
          acceptSessionForChat(targetChat, updated)
        }
      }
      appendChatItem(targetChat, updated.project_path, {
        id: crypto.randomUUID(), role: 'harness', source: 'wharness', presentation: 'notice', createdAt: new Date().toISOString(),
        text: action === 'pause' ? 'Plano auto-aprovado pausado antes do Apply. O plano continua disponível para leitura.' : action === 'suspend' ? 'Plano auto-aprovado suspenso antes do Apply. Nenhuma integração automática no host ocorrerá até retomar.' : 'Plano retomado. O Wharnex continua a execução/integração a partir do estado durável.',
        meta: `Controlo do plano · ${action}`,
      })
    } catch (cause) { setError(messageOf(cause)) }
  }

  async function prepareExecutionPlanReversal() {
    if (!session || busy) return
    const targetSession = session
    const targetChat = chats.find((chat) => chat.id === activeChatId)
    if (!targetChat || !(await confirmDialog({
      title: 'Calcular reversão com GPT?',
      message: 'O Wharnex enviará ao GPT o plano/diff aplicado, o estado atual do repositório e o histórico da Main Request para calcular uma reversão que preserve trabalho paralelo.',
      tone: 'warning',
      confirmLabel: 'Preparar reversão',
    }))) return
    setBusy(true); setError(undefined)
    try {
      const response = await api.prepareExecutionPlanReversal(targetSession.id)
      acceptSessionForChat(targetChat, response.session)
      if (activeChatIdRef.current === targetChat.id) setManualPrompt(response.manual_prompt || response.session.last_manual_prompt || '')
      appendChatItem(targetChat, response.session.project_path, {
        id: crypto.randomUUID(), role: 'harness', source: 'wharness', presentation: 'notice', createdAt: new Date().toISOString(),
        text: 'Reversão segura preparada como uma nova iteração GPT. O pedido usa a alteração aplicada, o estado atual do repositório e o histórico da Main Request; nenhuma inversão mecânica foi aplicada ao host.',
        meta: 'Reversão calculada por GPT',
        iteration: response.session.last_request_id ? iterationRef(response.session.last_request_id, 'prepared', selectedArtifactKinds(continuationArtifactSelection(response.session)), targetChat.chatgptUrl) : undefined,
      })
      if (response.session.last_manual_prompt) await transportPlannerContinuation(response.session, targetChat)
    } catch (cause) { setError(messageOf(cause)) } finally { setBusy(false) }
  }

  function openFileFromChat(path: string) {
    setEditorOpenPath(path)
    setEditorOpenNonce((value) => value + 1)
    setMode('editor')
  }

  async function revertChange(item: ChatItem) {
    if (!session || !item.change || busy) return
    const targetSession = session
    const targetChat = chats.find((chat) => chat.id === activeChatId)
    if (!targetChat) return
    const restoring = Boolean(item.change.reverted)
    const changes = restoring ? targetSession.last_reverted_changes : targetSession.last_applied_changes
    const latestPlanId = changes?.[changes.length - 1]?.plan.plan_id || (!restoring ? targetSession.plan?.plan_id : undefined)
    if (!latestPlanId || latestPlanId !== item.change.planId) {
      setError(restoring
        ? 'Este resumo já não corresponde à última reversão disponível para reposição segura.'
        : 'Este resumo pertence a um plano anterior. A reversão segura só está disponível para o último plano aplicado desta sessão.')
      return
    }
    if (!(await confirmDialog({
      title: restoring ? 'Repor alteração revertida?' : 'Calcular reversão com GPT?',
      message: restoring ? `O plano ${item.change.planId} será reposto no projeto real.` : `O GPT calculará uma reversão segura do plano ${item.change.planId} usando o diff aplicado, o estado atual e o histórico da Main Request. O host não será alterado mecanicamente nesta etapa.`,
      tone: 'warning',
      confirmLabel: restoring ? 'Repor alteração' : 'Preparar reversão',
    }))) return
    setBusy(true); setError(undefined)
    try {
      if (restoring) {
        const updated = await api.restoreReverted(targetSession.id)
        acceptSessionForChat(targetChat, updated)
        if (updated.state === 'applied') {
          mutateChatItems(targetChat, updated.project_path, (current) => current.map((candidate) => candidate.change?.planId === item.change?.planId ? { ...candidate, change: { ...candidate.change!, reverted: false } } : candidate))
        }
        markContextDirtyForOtherChats(updated.project_path, targetChat.id)
        void syncPeerBaselineUpdates(updated.project_path, targetChat.id)
        return
      }
      const response = await api.prepareExecutionPlanReversal(targetSession.id)
      acceptSessionForChat(targetChat, response.session)
      if (activeChatIdRef.current === targetChat.id) setManualPrompt(response.manual_prompt || response.session.last_manual_prompt || '')
      appendChatItem(targetChat, response.session.project_path, {
        id: crypto.randomUUID(), role: 'harness', source: 'wharness', presentation: 'notice', createdAt: new Date().toISOString(),
        text: 'Pedido de reversão enviado ao ciclo GPT. O Wharnex preserva o plano aplicado e o estado atual como evidência até a reversão calculada ser verificada e aplicada.',
        meta: 'Reversão GPT preparada',
      })
      if (response.session.last_manual_prompt) await transportPlannerContinuation(response.session, targetChat)
    } catch (error) { setError(messageOf(error)) } finally { setBusy(false) }
  }

  async function changeExecutionMode(next: ExecutionMode) {
    if (!session || next === executionMode || busy) return
    const targetSession = session
    const targetChat = chats.find((chat) => chat.id === activeChatId)
    if (!targetChat) return
    if (targetSession.self_evolution && next !== 'protected') { setError('A auto-evolução do próprio Wharnex é bloqueada em modos host-direct. Use Protected para manter sandbox, build transacional e rollback.'); return }
    let nextAutomation = automationMode
    if (next === 'unprotected' || next === 'full') {
      const full = next === 'full'
      const warning = full
        ? 'Ativar FULL para este projeto? Os planos serão executados diretamente no host e os gates de aprovação de comandos de alto impacto serão dispensados por padrão. sudo continua sempre a exigir uma aprovação explícita e uma senha efémera. Auto e Auto + Aprovar serão desativados.'
        : isAutomaticAutomationMode(automationMode)
          ? 'Ativar UNPROTECTED? O modo automático será desativado porque Auto e Auto + Aprovar sempre exigem sandbox Protected antes de aplicar no host.'
          : 'Ativar UNPROTECTED para este projeto? Os planos do Agent poderão alterar ficheiros e executar comandos diretamente no host, sem sandbox e sem etapa Apply.'
      if (!(await confirmDialog({
        title: full ? 'Ativar Full?' : 'Ativar Unprotected?',
        message: warning,
        tone: 'danger',
        confirmLabel: full ? 'Ativar Full' : 'Ativar Unprotected',
      }))) return
      nextAutomation = 'manual'
    }
    setBusy(true); setError(undefined)
    try {
      const updated = await syncSessionModes(targetSession, next, nextAutomation)
      acceptSessionForChat(targetChat, updated); setExecutionMode(next); setAutomationMode(nextAutomation)
      saveExecutionMode(updated.project_path, next); saveAutomationMode(updated.project_path, nextAutomation)
      void Promise.allSettled(chats.filter((chat) => chat.sessionId !== updated.id).map(async (chat) => {
        try { const candidate = await api.getSession(chat.sessionId); await syncSessionModes(candidate, next, nextAutomation) } catch { /* stale chat is repaired on selection */ }
      }))
      appendChatItem(targetChat, updated.project_path, { id: crypto.randomUUID(), role: 'harness', source: 'wharness', presentation: 'notice', createdAt: new Date().toISOString(), text: next === 'full' ? 'Modo Full ativado. A automação foi desativada; comandos de alto impacto deixam de pedir aprovação por padrão, mas sudo continua a exigir aprovação explícita e senha.' : next === 'unprotected' ? 'Modo Unprotected ativado. A automação foi desativada; execuções diretas continuam a exigir confirmação.' : 'Modo Protected ativado.', meta: next === 'full' ? 'Host direto · Full' : next === 'unprotected' ? 'Host direto' : 'Sandbox ativa' })
    } catch (e) { setError(messageOf(e)) } finally { setBusy(false) }
  }

  async function changeAutomationMode(next: AutomationMode) {
    if (!session || next === automationMode || busy) return
    const targetSession = session
    const targetChat = chats.find((chat) => chat.id === activeChatId)
    if (!targetChat) return
    if (next !== 'manual') {
      const autoApprove = isAutoApproveAutomationMode(next)
      if (!(await confirmDialog({
        title: autoApprove ? 'Ativar Auto + Aprovar?' : 'Ativar modo Auto?',
        message: autoApprove
          ? 'Mudanças com plano ready e permitidas pela Policy serão executadas em Protected sem pedir o consentimento inicial do contrato nem a aprovação de Policy. Bloqueios da Policy, autorizações interativas/debug, reparos de infraestrutura e a confirmação de reinício da auto-evolução continuam explícitos. Perguntas e análises nunca são executadas.'
          : 'Somente pedidos classificados como mudança, com plano válido, serão executados na sandbox Protected e aplicados após verificação. Perguntas e análises nunca serão executadas. No ChatGPT web, ainda é necessário iniciar o download do resultado; com provider API não há download.',
        tone: 'warning',
        confirmLabel: autoApprove ? 'Ativar Auto + Aprovar' : 'Ativar Auto',
      }))) return
    }
    setBusy(true); setError(undefined)
    try {
      const nextExecution: ExecutionMode = isAutomaticAutomationMode(next) ? 'protected' : executionMode
      const updated = await syncSessionModes(targetSession, nextExecution, next)
      acceptSessionForChat(targetChat, updated); setExecutionMode(nextExecution); setAutomationMode(next)
      saveExecutionMode(updated.project_path, nextExecution); saveAutomationMode(updated.project_path, next)
      void Promise.allSettled(chats.filter((chat) => chat.sessionId !== updated.id).map(async (chat) => {
        try { const candidate = await api.getSession(chat.sessionId); await syncSessionModes(candidate, nextExecution, next) } catch { /* stale chat is repaired on selection */ }
      }))
      const notice = next === 'auto_approve'
        ? { text: 'Modo Auto + Aprovar ativado. Mudanças válidas e permitidas seguem Protected e as aprovações de execução elegíveis são concedidas automaticamente; a ativação por reinício da auto-evolução continua explícita.', meta: 'AUTO + APROVAR · Protected' }
        : next === 'auto'
          ? { text: 'Modo Auto ativado. Respostas e análises continuam sem execução. Somente mudanças com plano válido seguem pela sandbox e são aplicadas após verificação; no ChatGPT web o download do resultado ainda precisa ser iniciado na superfície remota.', meta: 'AUTO · Protected' }
          : { text: 'Modo Manual ativado. Executar e aplicar mudanças voltam a exigir ação do utilizador.', meta: 'Manual' }
      appendChatItem(targetChat, updated.project_path, { id: crypto.randomUUID(), role: 'harness', source: 'wharness', presentation: 'notice', createdAt: new Date().toISOString(), ...notice })
    } catch (e) { setError(messageOf(e)) } finally { setBusy(false) }
  }

  // Effort is project-wide like execution/automation mode: every chat in the
  // workspace must use the same autonomous-attempt budget.
  async function changeEffortLevel(next: EffortLevel) {
    if (!session || next === effortLevel || busy) return
    const targetSession = session
    const targetChat = chats.find((chat) => chat.id === activeChatId)
    if (!targetChat) return
    setBusy(true); setError(undefined)
    try {
      const updated = await api.setEffortLevel(targetSession.id, next)
      acceptSessionForChat(targetChat, updated); setEffortLevel(next); saveEffortLevel(updated.project_path, next)
      void Promise.allSettled(chats.filter((chat) => chat.sessionId !== updated.id).map(async (chat) => {
        try { await api.setEffortLevel(chat.sessionId, next) } catch { /* stale chat is repaired on selection */ }
      }))
    } catch (error) { setError(messageOf(error)) } finally { setBusy(false) }
  }

  const { changeReasoningEffort, changeContextMode, changeChatTransportMode, changeKnowledgeSharing, changeDebugMode, approveDebug } = createChatSessionActions({ session, busy, chats, activeChatId, activeChatIdRef, chatTransportMode, setBusy, setError, setChatTransportMode, acceptSessionForChat, appendChatItem, transportPlannerContinuation })

  const { refreshRestartReports, openRestartConfirmation, dismissRestartConfirmation, confirmSelfRestart } = createRestartActions({ session, chats, orchestratorRestart, activeChatId, attentionSessions, sessionCacheRef, restartReports, busy, setRestartReports, setRestartModalOpen, setError, setBusy, acceptSessionForChat, appendChatItem })

  async function commentOnActiveTask(message: string, attachments: File[] = []) {
    if (!session) return
    const active = chats.find((chat) => chat.id === activeChatId)
    const requestId = activePendingRequestId(session) || active?.pendingPlan?.requestId || ''
    if (!active || !requestId) throw new Error('Nenhuma tarefa ChatGPT ativa para comentar.')
    try {
      const bridge = desktopBridge()
      if (!bridge) throw new Error('Comentários de tarefa requerem Wharnex Desktop.')
      const encoded = attachments.length ? await encodeChatAttachments(attachments) : []
      const result = await bridge.chatgpt.queueComment({ cacheKey: active.id, sessionId: session.id, text: message, url: active.chatgptUrl, requestId, commentId: crypto.randomUUID(), attachments: encoded, reasoningEffort: session.reasoning_effort || 'high' })
      const item: ChatItem = { id: crypto.randomUUID(), role: 'user', source: 'user', text: message, createdAt: new Date().toISOString(), meta: `${result.queued ? 'Comentário em fila' : 'Comentário enviado'} para a tarefa ativa${attachments.length ? ` · ${attachments.length} anexo(s)` : ''}`, iteration: iterationRef(requestId, 'submitted', ['prompt'], active.chatgptUrl) }
      appendChatItem(active, session.project_path, item)
    } catch (error) {
      setError(messageOf(error))
      throw error
    }
  }

  function handleChatGPTActivity(activity: ChatGPTActivity) {
    const active = chats.find((chat) => chat.id === activeChatId)
	const activeSurfaceKeys = active ? [active.id] : []
	if (!active || (activity.cacheKey && !activeSurfaceKeys.includes(activity.cacheKey))) return
    const requestId = session ? activePendingRequestId(session) || session.last_request_id || '' : ''
    if (activity.state === 'thinking' && activity.requestId) {
      setFailedPromptDeliveries((current) => {
        if (current[active.id]?.requestId !== activity.requestId) return current
        const next = { ...current }; delete next[active.id]; return next
      })
      for (const key of [...failedPromptDeliveryKeysRef.current]) if (key.includes(`:${activity.requestId}:`)) failedPromptDeliveryKeysRef.current.delete(key)
    }
    const thoughtId = `chatgpt-thought:${requestId || active.id}`
    setItems((current) => {
      const without = current.filter((item) => item.id !== thoughtId)
      if (activity.state !== 'thinking' && !activity.text) return without
      const text = activity.text || 'ChatGPT está a processar a tarefa…'
      return [...without, { id: thoughtId, role: 'harness', source: 'chatgpt', presentation: 'thought', text, createdAt: activity.capturedAt, meta: 'Conteúdo/estado visível na interface do ChatGPT' }]
    })
  }

  async function failRemoteInput(requestId: string, reason: string, kind: 'transport' | 'bundle_validation' | 'submodule_write' = 'transport', requestedSession: Session | undefined = session, requestedChat?: WorkspaceChat) {
    if (!requestedSession || !requestId) return
    try {
      const updated = await api.remoteInputFailure(requestedSession.id, requestId, reason.slice(0, 512), kind)
      const active = requestedChat || chats.find((chat) => chat.id === activeChatId)
      if (active) {
        acceptSessionForChat(active, updated)
        const submoduleBlocked = updated.failure_kind === 'submodule_write'
        const automaticallyRecovered = !submoduleBlocked && updated.last_request_id && updated.last_request_id !== requestId && updated.state === 'awaiting_plan'
        const itemId = `error-${crypto.randomUUID()}`
        appendChatItem(active, updated.project_path, {
          id: itemId, role: 'harness', source: 'wharness', presentation: 'notice', createdAt: new Date().toISOString(),
		  text: submoduleBlocked
		    ? `O bundle foi recusado porque o submódulo indicado não está inicializado ou o checkout Git dele não pode participar da integração protegida. Inicialize ou repare esse submódulo e repita o pedido.\n\nCausa: ${reason}`
		    : automaticallyRecovered
		      ? `O bundle foi recusado com segurança. O WHX preservou a falha como diagnóstico, criou uma nova base imutável e preparou automaticamente um único pedido de correção.\n\nCausa: ${reason}`
		      : `O pedido remoto terminou por falha de protocolo ou comunicação. Nenhum bundle foi executado. Ao repetir, o WHX enviará esta causa para que o ChatGPT corrija o contrato antes de gerar outro ZIP.\n\nCausa: ${reason}`,
		  meta: submoduleBlocked
		    ? `Submódulo sem checkout · inicialize-o e repita · ${reason.slice(0, 150)}`
		    : automaticallyRecovered
		      ? `Recuperação automática preparada · ${updated.last_request_id}`
		      : `Falha de protocolo/comunicação · pedido pode ser repetido · ${reason.slice(0, 180)}`,
		  iteration: iterationRef(requestId, 'failed', ['error'], active.chatgptUrl),
        })
        setError(reason)
        setErrorChatRef({ chatId: active.id, itemId, message: reason })
        if (automaticallyRecovered) {
          const dispatchKey = `auto-protocol-recovery:${active.id}:${updated.last_request_id}`
          if (!repairDispatchRef.current.has(dispatchKey)) {
            repairDispatchRef.current.add(dispatchKey)
            if (activeChatIdRef.current === active.id) setManualPrompt(updated.last_manual_prompt || '')
            try {
              const prepared = await transportPlannerContinuation(updated, active)
              // A dedicated notice for the recovered request id, distinct from
              // the diagnostic notice above (which stays pinned to the old,
              // now-superseded id). This is what makes "Reenviar request"
              // appear if the automatic delivery below silently fails.
              appendChatItem(active, updated.project_path, {
                id: `auto-recovery-dispatch-${updated.last_request_id}`, role: 'harness', source: 'wharness', presentation: 'notice', createdAt: new Date().toISOString(),
                text: prepared.submitted ? 'O pedido de correção automática foi enviado ao ChatGPT em segundo plano. O Wharnex vigia agora o download do novo bundle ZIP.' : 'O pedido de correção automática foi preparado no ChatGPT; confirme o envio para continuar.',
                meta: prepared.submitted ? `Pedido ${updated.last_request_id} enviado automaticamente` : `Pedido ${updated.last_request_id} · confirmação pendente`,
                iteration: updated.last_request_id ? iterationRef(updated.last_request_id, prepared.submitted ? 'submitted' : 'prepared', ['context', 'prompt'], prepared.conversationUrl || active.chatgptUrl) : undefined,
              })
            } catch (dispatchError) {
              repairDispatchRef.current.delete(dispatchKey)
              reportChatError(`A recuperação automática foi preparada, mas o envio ao ChatGPT falhou: ${messageOf(dispatchError)}`, 'Abra a aba ChatGPT para retomar', active, updated.project_path)
            }
          }
        }
      }
      return updated
    } catch (error) {
		setError(messageOf(error) || 'Não foi possível encerrar o pedido remoto avariado.')
    }
  }

  async function retryTransportFailure(requestId: string) {
    if (!session || busyChats[activeChatId] || requestChainActive(session)) return
    const targetSession = session
    const targetChat = chats.find((chat) => chat.id === activeChatId)
    if (!targetChat) return
    setChatBusy(targetChat.id, true); setError(undefined)
    try {
      const retried = await api.retryFailedRequest(targetSession.id)
      acceptSessionForChat(targetChat, retried)
      if (activeChatIdRef.current === targetChat.id) setManualPrompt(retried.last_manual_prompt || '')
      const prepared = await transportPlannerContinuation(retried, targetChat)
      appendChatItem(targetChat, retried.project_path, {
        id: crypto.randomUUID(), role: 'harness', source: 'wharness', presentation: 'notice', createdAt: new Date().toISOString(),
        text: prepared.submitted ? 'O pedido falhado foi recriado com uma nova base e enviado ao ChatGPT.' : 'O pedido falhado foi recriado com uma nova base; confirme o envio no ChatGPT.',
        meta: `Novo pedido ${retried.last_request_id || ''}`,
        iteration: retried.last_request_id ? iterationRef(retried.last_request_id, prepared.submitted ? 'submitted' : 'prepared', ['context', 'prompt'], prepared.conversationUrl || targetChat.chatgptUrl) : undefined,
      })
    } catch (retryError) {
      const detail = messageOf(retryError)
      setError(detail)
      reportChatError(`Não foi possível recriar o pedido ${requestId}: ${detail}`, 'Repetição falhou', targetChat, session.project_path)
    } finally { setChatBusy(targetChat.id, false) }
  }

	async function cancelPendingRequest(requestId: string) {
		if (!session || busy) return
		const targetSession = session
		const targetChat = chats.find((chat) => chat.id === activeChatId)
		if (!targetChat) return
    cancelledPromptDeliveryIdsRef.current.add(requestId)
		setBusy(true); setError(undefined)
		try {
      const desktopCancellation = isDesktop() ? (targetChat.engine === 'codex' ? desktopBridge()?.codex?.cancelRequest(targetSession.project_path, targetChat.id, requestId) : desktopBridge()?.chatgpt.cancelRequest(targetChat.id, requestId)) : undefined
      const [updated] = await Promise.all([api.cancelPendingRequest(targetSession.id, requestId), desktopCancellation || Promise.resolve(undefined)])
			acceptSessionForChat(targetChat, updated)
			if (activeChatIdRef.current === targetChat.id) { setManualPrompt(''); setTransportProgress('') }
			for (const key of [...resumedBundleKeysRef.current]) if (key.includes(`:${requestId}:`)) resumedBundleKeysRef.current.delete(key)
			for (const key of [...failedPromptDeliveryKeysRef.current]) if (key.includes(`:${requestId}:`)) failedPromptDeliveryKeysRef.current.delete(key)
			appendChatItem(targetChat, updated.project_path, { id: crypto.randomUUID(), role: 'harness', source: 'wharness', presentation: 'notice', createdAt: new Date().toISOString(), text: 'O pedido foi cancelado. A conversa está livre para receber um novo pedido principal; alterações Protected já verificadas foram preservadas.', meta: 'Pedido cancelado', iteration: iterationRef(requestId, 'failed', [], targetChat.chatgptUrl) })
		} catch (cancelError) {
      cancelledPromptDeliveryIdsRef.current.delete(requestId)
			setError(messageOf(cancelError))
			throw cancelError
		} finally { setBusy(false) }
	}

  async function consolidateProjectKnowledge() {
    if (!session || busy) return
    if (knowledgeConsolidationPending(session)) throw new Error('A consolidação do conhecimento já está em curso neste chat.')
    let targetSession = session
    let targetChat = chats.find((chat) => chat.id === activeChatId)
    if (!targetChat) return
    setBusy(true); setError(undefined)
    try {
      if (requestChainActive(session)) {
        // Knowledge maintenance owns request identity too, so isolate it instead
        // of overwriting the active request chain on the current session.
        const chatId = crypto.randomUUID()
        const created = await api.createSession(session.project_path, executionMode, automationMode, chatId, effortLevel)
        const maintenanceChat = newWorkspaceChat(created.id, 'Conhecimento · consolidação', chatId)
        await api.saveWorkspaceChat(durableWorkspaceChat(created.project_path, maintenanceChat))
        hideChatGPTSurfaces(targetChat)
        targetSession = created
        targetChat = maintenanceChat
        persistChats(created.project_path, [maintenanceChat, ...chats])
        transcriptReadyRef.current.add(maintenanceChat.id)
        sourceRef.current?.close(); sourceRef.current = null
        activeChatIdRef.current = maintenanceChat.id; setActiveChatId(maintenanceChat.id); setSession(created)
        setItems([welcomeItem(created)]); setEvents([]); setManualPrompt(''); setChatTransportMode(created.chat_transport_mode || 'scraper'); setMode('agent')
        connectEvents(created.id, created.project_path, maintenanceChat.id)
      }
      const result = await api.consolidateProjectKnowledge(targetSession.id)
      acceptSessionForChat(targetChat, result.session)
      if (activeChatIdRef.current === targetChat.id) setManualPrompt(result.session.last_manual_prompt || '')
      let submitted = false
      if (result.session.last_manual_prompt) {
        const prepared = await transportPlannerContinuation(result.session, targetChat)
        submitted = prepared.submitted
        setChatgptAttentionNonce((value) => value + 1)
      }
      appendChatItem(targetChat, result.session.project_path, {
        id: crypto.randomUUID(), role: 'harness', source: 'wharness', presentation: 'notice', createdAt: new Date().toISOString(),
        text: submitted ? 'O catálogo completo foi empacotado e enviado ao GPT para consolidação. A resposta poderá mesclar duplicados, reconciliar contradições por evidência/recência, remover registos vazios e recategorizar conhecimento.' : 'A consolidação do catálogo foi preparada. Envie o prompt pendente ao ChatGPT para concluir a manutenção.',
        meta: submitted ? 'Conhecimento · consolidação enviada' : 'Conhecimento · consolidação preparada',
        iteration: result.session.last_request_id ? iterationRef(result.session.last_request_id, submitted ? 'submitted' : 'prepared', ['prompt'], targetChat.chatgptUrl) : undefined,
      })
    } catch (cause) {
      setError(messageOf(cause))
      throw cause
    } finally { setBusy(false) }
  }

  async function analyzeEvolutionEvidence(evidenceIds: string[], knowledgeRefs: EvolutionKnowledgeRef[] = [], evidenceFiles: File[] = [], knowledgeOnly = false) {
    if (!session?.self_evolution || busy || requestChainActive(session)) return
    setBusy(true); setError(undefined)
    try {
      let targetChat = chats.find((chat) => chat.purpose === 'self-evolution')
      let targetSession: Session
      if (targetChat) {
        targetSession = await api.getSession(targetChat.sessionId)
      } else {
        const chatId = crypto.randomUUID()
        targetSession = await api.createSession(session.project_path, executionMode, automationMode, chatId, effortLevel)
        targetChat = { ...newWorkspaceChat(targetSession.id, 'Autoevolução · evidência operacional', chatId), purpose: 'self-evolution' }
        persistChats(session.project_path, [targetChat, ...chats])
      }
      const artifactIds = await persistOperationalEvidence(targetSession.id, evidenceFiles)
      const result = await api.analyzeEvolutionEvidence(targetSession.id, evidenceIds, knowledgeRefs, artifactIds, knowledgeOnly)
      sourceRef.current?.close(); sourceRef.current = null
      activeChatIdRef.current = targetChat.id; setActiveChatId(targetChat.id); setSession(result.session); setEvents([])
      const existingItems = loadChat(result.session.project_path, targetChat.id)
      setItems(existingItems.length ? existingItems : [welcomeItem(result.session)])
      connectEvents(result.session.id, result.session.project_path, targetChat.id)
      setManualPrompt(result.session.last_manual_prompt || '')
      const prepared = await transportPlannerContinuation(result.session, targetChat)
      // Reveal the Engine/ChatGPT surface: the workspace may currently be
      // showing another inspector tab (or the evidence drawer, which just
      // closed the active chat switch above), so preparing the ChatGPT
      // window here is otherwise invisible to the user. This reuses the same
      // signal openChatGPTHumanAction uses to focus that surface.
      setChatgptAttentionNonce((value) => value + 1)
      const eventSelection = evidenceIds.length > 0 ? `${evidenceIds.length} eventos` : knowledgeRefs.length > 0 ? (knowledgeOnly ? '0 eventos (só conhecimento)' : 'uma amostra automática de eventos de alto sinal') : 'todos os eventos aplicáveis'
      appendChatItem(targetChat, result.session.project_path, { id: crypto.randomUUID(), role: 'harness', source: 'wharness', presentation: 'notice', createdAt: new Date().toISOString(), text: `A análise foi preparada a partir do dossiê selecionado. A fonte global contém ${result.evidence_total} eventos e ${result.knowledge_total} conhecimentos operacionais elegíveis; esta ronda recebeu ${eventSelection} e ${knowledgeRefs.length} conhecimentos selecionados, além dos anexos escolhidos. A proposta continuará sujeita a Policy e sandbox Protected.`, meta: prepared.submitted ? 'Auto-evolução · análise enviada' : 'Auto-evolução · análise preparada', iteration: result.session.last_request_id ? iterationRef(result.session.last_request_id, prepared.submitted ? 'submitted' : 'prepared', ['context', 'prompt'], targetChat.chatgptUrl) : undefined })
    } catch (cause) { setError(messageOf(cause)) } finally { setBusy(false) }
  }

  const { approvePlanProposal, correctPlanProposal, rejectPlanProposal } = createPlanProposalActions({
    planAPI: api, session, chats, activeChatId, activeChatIdRef,
    setBusy, setError, acceptSessionForChat, setManualPrompt,
    mutateChatItems, updateChat, transportPlannerContinuation, appendChatItem,
  })

  function changeRequestMode(mode: ChatRequestMode) { updateChat({ requestMode: mode }) }

  submitBundleFileRef.current = submitBundleFile

  const orchestratorConclusions = orchestratorConclusionState.projectPath === session?.project_path ? orchestratorConclusionState.items : []
  // Ordinary chat attention, self-evolution restart decisions and successful
  // Orchestrator runs share one project-level list. Merge by semantic id so a
  // conclusion stays singular across polls and REVIEW → COMPLETE → ARCHIVED.
  const allAttentionItems = mergeAttentionItems(
    collectAttentionItems(chats, attentionSessions, chatgptHumanActions),
    collectAttentionItems(orchestratorRestart.chats, orchestratorRestart.sessions).filter((item) => item.kind === 'restart-pending'),
    orchestratorConclusionAttentionItems(orchestratorConclusions),
  )
  const attentionHistory = attentionHistoryState.projectPath === session?.project_path ? attentionHistoryState.items : []
  const attentionItems = filterActiveAttentionItems(allAttentionItems, attentionHistory)
  const attentionSummary = summarizeAttention(attentionItems)
  const { orchestratorTaskFocus, openAttentionItem, openDesktopNotification } = useAttentionNavigation({
    session, activeChatId, chats, allAttentionItems,
    chatgptHumanActionActive: Boolean(chatgptHumanAction?.active),
    acknowledge: acknowledgeAttentionItem,
    openHumanAction: openChatGPTHumanAction,
    setMode,
    selectChat,
    openRestart: openRestartConfirmation,
    focusInspector: (target) => setInspectorAttention((current) => ({ tab: target, nonce: current.nonce + 1 })),
  })
  useEffect(() => {
    const notifications = desktopBridge()?.notifications
    if (!notifications || !session) return
    for (const entry of attentionItems) {
      if (!entry.kind || !entry.occurredAt || nativeNotificationIdsRef.current.has(entry.id)) continue
      nativeNotificationIdsRef.current.add(entry.id)
      if (!shouldPublishNativeAttentionAfterBaseline(entry, nativeCompletionBaselineRef.current)) continue
      void notifications.publish({
        id: entry.id,
        projectPath: session.project_path,
        chatId: entry.chatId,
        kind: entry.kind,
        title: entry.title,
        body: entry.detail,
        occurredAt: entry.occurredAt,
      }).catch(() => undefined)
    }
  }, [attentionItems, session?.project_path])
  useEffect(() => {
    const notifications = desktopBridge()?.notifications
    if (!notifications?.onOpen || !session) return
    return notifications.onOpen((notice) => {
      if (notice.projectPath !== session.project_path) return
      void openDesktopNotification(notice)
    })
  }, [session?.project_path, activeChatId, chats, attentionSessions, orchestratorConclusionState])
  useEffect(() => {
    if (!embeddedProject) return
    window.parent.postMessage({ type: 'wharness:project-attention', projectPath: embeddedProject, total: attentionSummary.total, urgent: attentionSummary.urgent, actionable: attentionSummary.actionable }, window.location.origin)
  }, [embeddedProject, attentionSummary.total, attentionSummary.urgent, attentionSummary.actionable])
  useEffect(() => {
    if (embeddedProject && !shellActive) setAttentionPreviewOpen(false)
  }, [embeddedProject, shellActive])

  useEffect(() => {
    const tray = desktopBridge()?.tray
    if (!tray?.updateProjectState || !session) return
    const trayTaskInFlight = requestChainActive(session) || restartModalOpen || interruptedExecutions.some((target) => target.chat.id === activeChatId)
    void tray.updateProjectState(buildDesktopTrayProjectState({
      session, attentionItems, activeChatId, taskInFlight: trayTaskInFlight,
      tunnelCount: config?.remote_input?.instances?.length || 0,
    })).catch(() => undefined)
  }, [session, activeChatId, attentionItems, restartModalOpen, interruptedExecutions, config?.remote_input?.instances])

  useEffect(() => {
    const tray = desktopBridge()?.tray
    if (!tray?.onAction || !session) return
    return tray.onAction((event) => {
      if (event.projectPath !== session.project_path) return
      const attentionAction = async (action: AttentionItem['action']) => {
        const item = attentionItems.find((entry) => entry.chatId === activeChatId && entry.action === action)
        if (item) await runAttentionItemAction(item)
      }
      void dispatchDesktopTrayProjectAction(event.action, {
        openNotifications: () => { setMode('agent'); setAttentionPreviewOpen(true) },
        openPlan: () => { setMode('agent'); setInspectorAttention((current) => ({ tab: 'plan', nonce: current.nonce + 1 })) },
        openExecution: () => { setMode('agent'); setInspectorAttention((current) => ({ tab: 'terminal', nonce: current.nonce + 1 })) },
        approveExecution: () => attentionAction('approve-execution'),
        pauseExecution: () => controlExecutionPlan('pause'),
        resumeExecution: () => controlExecutionPlan('resume'),
        suspendExecution: () => controlExecutionPlan('suspend'),
        continueRequest: () => attentionAction('retry-transport'),
        openWorkers: () => {
          setMode('agent')
          const onLeft = railLayout.left.includes('agents') || railLayout.pinned.left.includes('agents')
          if (onLeft) setSideDrawer('agents'); else setRightDrawer('agents')
        },
      }).catch((cause) => setError(messageOf(cause)))
    })
  }, [session, activeChatId, attentionItems, railLayout, runAttentionItemAction, controlExecutionPlan])

  const notifyComposerTyping = useCallback(() => {
    if (!embeddedProject) return
    window.parent.postMessage({ type: 'wharness:composer-typing', projectPath: embeddedProject }, window.location.origin)
  }, [embeddedProject])

  if (!session) return <Bootstrap config={config} busy={busy} error={error} recent={recent} restoring={restoring} onStart={start} onCreate={createProject} onClone={cloneProject} />
  const workspaceProjectPath = session.project_path
  const activeChat = chats.find((chat) => chat.id === activeChatId)
  const contextArtifactRequired = Boolean(activeChat && (!activeChat.lastContextSha256 || activeChat.lastContextSha256 !== sessionContextSHA(session) || activeChat.artifactSelection?.context || (activeChat.chatgptUrl && activeChat.lastContextChatgptUrl && !sameChatGPTConversation(activeChat.chatgptUrl, activeChat.lastContextChatgptUrl))))
  const errorArtifactRequired = session.state === 'repair_pending' || session.last_execution?.success === false || Boolean(session.last_repair_error)
  const composerArtifacts: ChatArtifactSelection = {
    context: contextArtifactRequired,
    prompt: true,
    result: Boolean(activeChat?.artifactSelection?.result),
    error: errorArtifactRequired || Boolean(activeChat?.artifactSelection?.error),
  }
  const recoveryBlocksActiveChat = interruptedExecutions.some((target) => target.chat.id === activeChatId)
  const taskInFlight = nativeRequestActive || requestChainActive(session) || restartModalOpen || recoveryBlocksActiveChat
  // Also a task that changed Wharnex itself: it has no chat to show the restart.
  const restartPending = isRestartPending(session) || orchestratorRestart.chats.length > 0
  // Attention routing and the side rail are shell-level. The shell owns the
  // notification entry point, while inspector routing stays on the existing
  // inspectorAttention channel consumed by the Agent workspace.
  const visibleExecutionFIFO = visibleExecutionQueueItems(executionFIFO, chats.map((chat) => chat.id))
  const activeExecutionCount = executionQueueActiveCount(visibleExecutionFIFO)

  function acknowledgeAttentionItem(item: AttentionItem) {
    if (item.kind !== 'task-completed' || !session) return
    setAttentionHistoryState((current) => {
      const history = current.projectPath === session.project_path ? current.items : []
      return { projectPath: session.project_path, items: acknowledgeCompletedAttention(session.project_path, item, history) }
    })
  }


  // Shared by the Tarefas drawer and the Orchestrator planning queue: a
  // durable task's chat_id is the real Harness chat id for ordinary work, but
  // is the synthetic orchestrator request id for ORCHESTRATOR_PLAN tasks —
  // session_id is the fallback that resolves either shape to a real chat.
  function chatIdForRuntimeTask(chatId?: string, sessionId?: string) {
    if (chatId && chats.some((chat) => chat.id === chatId)) return chatId
    if (sessionId) return chats.find((chat) => chat.sessionId === sessionId)?.id
    return undefined
  }

  async function goToRuntimeTaskChat(chatId?: string, sessionId?: string) {
    const target = chatIdForRuntimeTask(chatId, sessionId)
    if (!target) return
    setMode('agent')
    if (target !== activeChatId) await selectChat(target)
  }

  function goToOrchestratorFromTask() {
    setMode('orchestrator')
    setOrchestratorFocusNonce((current) => current + 1)
  }

  // Mirrors the Agents drawer's own "Seguir (flow)" action: land on the
  // Engine tab of the task's owning chat, then dispatch the same global event
  // ChatGPTDesktopPane already listens for to show that exact Worker instance.
  async function followRuntimeTaskInstance(agentId: string, chatId?: string, sessionId?: string) {
    setMode('agent')
    const target = chatIdForRuntimeTask(chatId, sessionId)
    if (target && target !== activeChatId) await selectChat(target)
    setInspectorAttention((current) => ({ tab: 'chatgpt', nonce: current.nonce + 1 }))
    window.requestAnimationFrame(() => window.requestAnimationFrame(() => {
      window.dispatchEvent(new CustomEvent('wharnex:agent-follow', { detail: { agentId } }))
    }))
  }

  async function runAttentionItemAction(item: AttentionItem) {
    if (!item.action) return
    if (item.chatId !== activeChatId) {
      await openAttentionItem(item)
      return
    }
    switch (item.action) {
      case 'approve-execution': await execute(true); return
      case 'approve-debug': await approveDebug(); return
      case 'retry-dependency-network': await retryDependencyNetwork(); return
      case 'repair-host-dependency': await retryHostDependencyRepair(); return
      case 'repair-with-gpt': {
        const detail = await promptGPTRepairDetail(plannerDeclaredNonRetryable(session))
        if (detail !== undefined) await repairFailureWithGPT(detail)
        return
      }
      // A bare resume of a planner-declared non-retryable failure can only come
      // back as the planner's own refusal, so this surface collects the required
      // guidance and repairs instead of resending the same blocked request.
      case 'retry-transport': {
        if (!plannerDeclaredNonRetryable(session)) { await retryTransportFailure(item.requestId || ''); return }
        const detail = await promptGPTRepairDetail(true)
        if (detail !== undefined) await repairFailureWithGPT(detail)
        return
      }
      case 'retry-host-apply': {
        if (session?.failure_kind === 'self_evolution_transaction_busy' && !(await clearSelfEvolutionBlockForRetry())) return
        await apply()
        return
      }
    }
  }

  function moveRailTool(tool: WorkspaceTool, side: WorkspaceRailSide, before?: WorkspaceTool, pinned = false) {
    const source: WorkspaceRailSide = railLayout.left.includes(tool) || railLayout.pinned.left.includes(tool) ? 'left' : 'right'
    const next = saveWorkspaceRailLayout(moveWorkspaceTool(railLayout, tool, side, before, pinned), workspaceProjectPath)
    setRailLayout(next)
    if (source === side || tool === 'terminal') return
    if (source === 'left' && sideDrawer === tool) { setSideDrawer(''); setRightDrawer(tool) }
    if (source === 'right' && rightDrawer === tool) { setRightDrawer(''); setSideDrawer(tool) }
  }

  const openLeftDrawer = (next: Drawer) => { setSideDrawer(next) }
  const openRightDrawer = (next: Drawer) => { setRightDrawer(next) }

  function locateFileInExplorer(path: string) {
    const projectOnLeft = railLayout.left.includes('project') || railLayout.pinned.left.includes('project')
    if (projectOnLeft) setSideDrawer('project')
    else setRightDrawer('project')
    setExplorerReveal((current) => ({ path, nonce: current.nonce + 1 }))
  }

  const { activateWorkspaceSurface, detachSurface, removeMovedSurfaceFromThisWindow, moveSurfaceByDrag } = createSurfaceTransferActions({
    projectPath: session.project_path, surfaceHost: surfaceRequest?.host, activeChatId, activeChatIdRef,
    activeSurfaceKey, hiddenSurfaceKeys, chats, setMode, setError, setEditorOpenPath, setEditorOpenNonce,
    setTerminalOpen, setSurfaceTabs, setActiveSurfaceKey, setHiddenSurfaceKeys, selectChat,
  })
  const splitWorkspaceSurface = (target: WorkspaceSurfaceTarget, direction: WorkspaceSplitDirection) => setSplitSurface({ target, direction, ratio: .5 })
  const resizeWorkspaceSplit = (event: ReactPointerEvent<HTMLDivElement>, direction: WorkspaceSplitDirection) => {
    event.preventDefault()
    const container = event.currentTarget.parentElement
    if (!container) return
    const bounds = container.getBoundingClientRect()
    const move = (pointer: PointerEvent) => {
      const raw = direction === 'vertical' ? (pointer.clientX - bounds.left) / Math.max(1, bounds.width) : (pointer.clientY - bounds.top) / Math.max(1, bounds.height)
      const ratio = Math.max(.2, Math.min(.8, raw))
      setSplitSurface((current) => current ? { ...current, ratio } : current)
    }
    const finish = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', finish) }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', finish, { once: true })
  }
  const surfaceTarget = (kind: WorkspaceSurfaceTarget['kind'], detail: Pick<WorkspaceSurfaceTarget, 'chatId' | 'path'> = {}): WorkspaceSurfaceTarget => createWorkspaceSurfaceTarget(session.project_path, { kind, ...detail })

  const sharedChatProps: ComponentProps<typeof ChatPanel> = {
    session, items, chats, archivedChats, activeChatId, busy: activeBusy, executionMode, automationMode, effortLevel, reasoningEffort: session.reasoning_effort || 'high', chatTransportMode,
    ...createCodexComposerControls(activeChat, Boolean(taskInFlight || activeBusy), Boolean(taskInFlight || activeBusy || preparedDrafts[activeChatId]), (patch) => updateWorkspaceChat(activeChatId, session.project_path, patch)),
    attachmentsEnabled: isDesktop() && (activeChat?.engine === 'codex' || config?.planner === 'manual'), preparedAttachmentCount: preparedDrafts[activeChatId], failedPromptDelivery: failedPromptDeliveries[activeChatId],
    artifactSelection: composerArtifacts, artifactRequired: { context: contextArtifactRequired, error: errorArtifactRequired },
    artifactContent: { context: contextArtifact(session), prompt: manualPrompt || session.last_manual_prompt || '', result: executionArtifact(session), error: errorArtifact(session) },
    requestMode: activeChat?.requestMode || 'direct', taskInFlight, queuedRequests: queuedRequestsByChat[activeChatId] || [], transportProgress: busyChats[activeChatId] ? transportProgress : '', transportRequestId: busyChats[activeChatId] ? activePendingRequestId(session) : '',
    onExecutionMode: changeExecutionMode, onAutomationMode: changeAutomationMode, onDebugMode: changeDebugMode, onEffortLevel: changeEffortLevel, onReasoningEffort: changeReasoningEffort, onContextMode: changeContextMode, onChatTransportMode: changeChatTransportMode, onKnowledgeSharing: changeKnowledgeSharing, onToggleArtifact: toggleComposerArtifact, onRequestMode: changeRequestMode,
    onComposerTyping: notifyComposerTyping,
    onSend: enqueueMainRequest, onAdjustExecutionPlan: adjustExecutionPlan, onPreviewBundle: previewComposerBundle, onComment: commentOnActiveTask, onQueueEdit: updateQueuedRequest, onQueueMove: moveQueuedRequest, onQueueRemove: removeQueuedRequest, onQueueMerge: mergeQueuedRequest, onQueuePromote: activeChat?.engine === 'codex' ? undefined : promoteQueuedRequest,
    onApprovePlan: approvePlanProposal, onCorrectPlan: correctPlanProposal, onRejectPlan: rejectPlanProposal, onConfirmPrepared: confirmPreparedDraft, onDismissPrepared: dismissPreparedDraft, onRetryPreparedDelivery: retryPreparedPromptDelivery, onOpenFile: openFileFromChat, onRevertChange: revertChange, onReprocessPolicyBlock: reprocessPolicyBlock, canReprocessPolicyBlock: Boolean(session.plan && session.policy && !session.policy.allowed),
    onRepairWithGPT: repairFailureWithGPT, canRepairWithGPT: canRepairFailureWithGPT(session), onRetryDependencyNetwork: retryDependencyNetwork, canRetryDependencyNetwork: canRetryDependencyNetwork(session), onRetryTransportFailure: retryTransportFailure, onResendPendingRequest: retryPreparedPromptDelivery, onCancelPendingRequest: cancelPendingRequest,
    onNewChat: newChat, onSelectChat: selectChat, onSaveChat: async (chatId) => { await saveChatForLater(chatId) }, onArchiveChat: archiveChat, onRestoreChat: restoreArchivedChat, onDeleteArchivedChat: deleteArchivedChat, onRenameChat: renameWorkspaceChat, onGenerateChatTitle: generateWorkspaceChatTitle,
  }

  const hiddenSurfaceKeySet = new Set(hiddenSurfaceKeys)
  const mainVisibleChats = chats.filter((chat) => !hiddenSurfaceKeySet.has(workspaceSurfaceKey({ kind: 'chat', chatId: chat.id })))
  const hiddenEditorPaths = hiddenSurfaceKeys.filter((key) => key.startsWith('editor:')).map((key) => key.slice('editor:'.length))
  const activeSurface = surfaceRequest?.host === 'window'
    ? surfaceTabs.find((target) => workspaceSurfaceKey(target) === activeSurfaceKey) || surfaceTabs[0] || initialSurfaceTarget
    : initialSurfaceTarget
  const surfaceLabel = (target: WorkspaceSurfaceTarget) => {
    if (target.kind === 'chat') return chats.find((chat) => chat.id === target.chatId)?.title || 'Chat'
    if (target.kind === 'editor') return target.path?.split('/').pop() || target.path || 'Editor'
    return 'Terminal'
  }

  if (surfaceRequest && activeSurface) {
    const focusedChatProps = activeSurface.kind === 'chat' ? { ...sharedChatProps, chats: chats.filter((chat) => chat.id === activeChatId) } : sharedChatProps
    return <main className={`workspace-root workspace-surface-root workspace-surface-${activeSurface.kind}`}>
      {surfaceRequest.host === 'window' && isDesktop() && <header className="workspace-surface-windowbar" data-window-titlebar="true">
        <WorkspaceSurfaceTabs targets={surfaceTabs} activeKey={activeSurfaceKey} label={surfaceLabel}
          onSelect={(target) => { setActiveSurfaceKey(workspaceSurfaceKey(target)); activateWorkspaceSurface(target) }}
          onContextMenu={(event, target) => { if (target.kind !== 'chat') return; event.preventDefault(); setSurfaceTabMenu({ target, x: event.clientX, y: event.clientY }) }}
          onMove={moveSurfaceByDrag}/>

        <div className="workspace-surface-window-controls"><button type="button" onClick={() => void desktopBridge()?.windows.minimize()} aria-label="Minimizar">—</button><button type="button" onClick={() => void desktopBridge()?.windows.toggleMaximize()} aria-label="Maximizar ou restaurar">□</button><button type="button" onClick={() => void desktopBridge()?.windows.close()} aria-label="Fechar">×</button></div>
      </header>}
      {surfaceTabMenu && <div className="chat-tab-context-menu workspace-surface-tab-menu" role="menu" aria-label="Ações da tab de chat" style={{ left: surfaceTabMenu.x, top: surfaceTabMenu.y }} onPointerDown={(event) => event.stopPropagation()}>
        <button type="button" role="menuitem" disabled={activeBusy} onClick={() => { const target = surfaceTabMenu.target; const chatId = target.chatId; setSurfaceTabMenu(undefined); if (chatId) void saveChatForLater(chatId).then((saved) => { if (saved) removeMovedSurfaceFromThisWindow(target) }) }}><Icon name="save" size={12}/>Guardar em standby</button>
        <button type="button" role="menuitem" onClick={() => { const target = surfaceTabMenu.target; setSurfaceTabMenu(undefined); splitWorkspaceSurface(target, 'vertical') }}><Icon name="arrow-right" size={12}/>Dividir à direita</button>
        <button type="button" role="menuitem" onClick={() => { const target = surfaceTabMenu.target; setSurfaceTabMenu(undefined); splitWorkspaceSurface(target, 'horizontal') }}><Icon name="arrow-down" size={12}/>Dividir abaixo</button>
      </div>}
      <ErrorToast open={Boolean(error)} message={error} onDismiss={() => setError(undefined)} />
      <div className={`workspace-surface-content ${splitSurface ? `is-split split-${splitSurface.direction}` : ''}`} style={splitSurface ? { ['--workspace-split-primary' as string]: `${Math.round(splitSurface.ratio * 1000) / 10}%` } as React.CSSProperties : undefined}>
        <div className="workspace-surface-primary">
          {activeSurface.kind === 'chat' && <AgentWorkspace session={session} busy={activeBusy} attentionItems={attentionItems} onOpenAttention={openAttentionItem} onAttentionAction={runAttentionItemAction} chatgptAttentionNonce={chatgptAttentionNonce} inspectorAttention={inspectorAttention} surfaceMode minimalSurface={surfaceRequest.host === 'window'} onOpenAttentionDrawer={() => undefined} onExportChat={exportActiveChat} onReorderChat={reorderChat} chatProps={focusedChatProps} onSplitChat={surfaceRequest.host === 'split' ? undefined : (chatId, direction) => splitWorkspaceSurface(surfaceTarget('chat', { chatId }), direction)} inspectorProps={{ config, session, events, manualPrompt, busy: activeBusy, chat: activeChat, chats, chatgptSuspended: !shellActive, onChatGPTURL: bindChatGPTURL, onChatGPTActivity: handleChatGPTActivity, onContextSent: markContextSent, onExecute: execute, onApproveDebug: approveDebug, onRetryDependencyNetwork: retryDependencyNetwork, onRetryHostDependencyRepair: retryHostDependencyRepair, onRejectExecutionPlan: rejectExecutionPlan, onRejectPendingChanges: rejectPendingChanges, onControlExecutionPlan: controlExecutionPlan, onPrepareExecutionPlanReversal: prepareExecutionPlanReversal, onManualPlan: submitManualPlan, onPlanFile: submitPlanFile, onBundleFile: submitBundleFile, onTransportFailure: failRemoteInput, onCancelPendingRequest: cancelPendingRequest, onResendPendingRequest: retryPreparedPromptDelivery, onSession: setSession, onResolveConflictWithGPT: resolveConflictWithGPT }} />}
          {activeSurface.kind === 'editor' && <DeferredEditorWorkspace session={session} surfaceMode minimalSurface={surfaceRequest.host === 'window'} onError={setError} onRunInTerminal={runInTerminal} openPath={activeSurface.path} openNonce={editorOpenNonce} onSplitFile={surfaceRequest.host === 'split' ? undefined : (path, direction) => splitWorkspaceSurface(surfaceTarget('editor', { path }), direction)} />}
          {activeSurface.kind === 'terminal' && <TerminalWorkspace session={session} height={terminalHeight} visible fill runRequest={terminalRunRequest} onHeight={setTerminalHeight} onError={setError} onSplitTerminal={surfaceRequest.host === 'split' ? undefined : (direction) => splitWorkspaceSurface(surfaceTarget('terminal'), direction)} />}
        </div>
        {splitSurface && <div className={`workspace-surface-splitter split-${splitSurface.direction}`} role="separator" aria-orientation={splitSurface.direction === 'vertical' ? 'vertical' : 'horizontal'} aria-label="Redimensionar divisão do workspace" onPointerDown={(event) => resizeWorkspaceSplit(event, splitSurface.direction)} />}
        {splitSurface && <section className="workspace-split-pane"><header><strong>{surfaceLabel(splitSurface.target)}</strong><div><button type="button" onClick={() => detachSurface(splitSurface.target)} title="Destacar para janela" aria-label="Destacar painel para janela"><Icon name="external" size={12}/></button><button type="button" onClick={() => setSplitSurface(undefined)} title="Fechar divisão" aria-label="Fechar divisão">×</button></div></header><iframe title={`Painel ${splitSurface.target.kind}`} src={workspaceSurfaceURL(splitSurface.target, 'split')} /></section>}
      </div>
    </main>
  }

  const sharedRailProps = {
    chats: chats,
    chatProps: sharedChatProps,
    onPromoteTodoToChat: promoteTodoToChat,
    onPromoteTodoToCurrentChat: promoteTodoToCurrentChat,
    onLocateTodoChat: locateTodoChat,
    onGoToChat: (chatId, sessionId) => void goToRuntimeTaskChat(chatId, sessionId),
    onGoToOrchestrator: goToOrchestratorFromTask,
    onFollowInstance: (agentId, chatId, sessionId) => void followRuntimeTaskInstance(agentId, chatId, sessionId),
    onFocusProject: focusProject,
    savedChats: savedChats,
    archivedChats: archivedChats,
    activeChatId: activeChatId,
    activeEvents: events,
    attentionItems: attentionItems,
    attentionHistoryItems: attentionHistory,
    executionFIFO: visibleExecutionFIFO,
    activeExecutionCount: activeExecutionCount,
    onOpenAttention: openAttentionItem,
    onAttentionAction: runAttentionItemAction,
    onRestoreSavedChat: restoreSavedChat,
    onArchiveSavedChat: archiveSavedChat,
    onRestoreChat: restoreArchivedChat,
    onDeleteArchivedChat: deleteArchivedChat,
    onRenameChat: renameWorkspaceChat,
    onGenerateChatTitle: generateWorkspaceChatTitle,
    onOpenFile: openFileFromChat,
    explorerRevealPath: explorerReveal.path,
    explorerRevealNonce: explorerReveal.nonce,
    onAnalyzeEvolution: analyzeEvolutionEvidence,
    onConsolidateKnowledge: consolidateProjectKnowledge,
    onError: setError,
    onSession: setSession,
    onResolveConflictWithGPT: resolveConflictWithGPT,
    onOpenGitConflictChat: openGitConflictChat,
    terminalOpen: terminalOpen,
    onToggleTerminal: () => setTerminalOpen((open) => !open),
    onRunInTerminal: runInTerminal,
  } satisfies Partial<ComponentProps<typeof WorkspaceSideRail>>

  return <main className="workspace-root">
    {!embeddedProject && <WorkspaceTopbar config={config} session={session} mode={mode} executionMode={executionMode} automationMode={automationMode} attention={attentionSummary} restartPending={restartPending} restartBlocked={requestChainActive(session)} busy={busy} onMode={setMode} onAttention={() => setAttentionPreviewOpen((open) => !open)} onRestartPending={() => void openRestartConfirmation(activeChatId)} onSettings={() => setProjectSettingsOpen(true)} onClose={closeWorkspace} onSession={setSession} />}
    {attentionPreviewOpen && <AttentionPopover
      items={attentionItems}
      activeChatId={activeChatId}
      busy={activeBusy}
      position={{ top: embeddedProject ? 10 : 56, right: 10, maxHeight: embeddedProject ? 'calc(100dvh - 20px)' : 'calc(100dvh - 66px)' }}
      onOpen={async (item) => { setAttentionPreviewOpen(false); await openAttentionItem(item) }}
      onAction={async (item) => { setAttentionPreviewOpen(false); await runAttentionItemAction(item) }}
      onOpenAll={() => { setAttentionPreviewOpen(false); setMode('agent'); openLeftDrawer('attention') }}
      onClose={() => setAttentionPreviewOpen(false)}
    />}
    {projectSettingsOpen && <ProjectSettings session={session} onClose={() => setProjectSettingsOpen(false)} onSession={setSession} onError={setError} onTunnelConfigSaved={(document, runtime) => setConfig((current) => runtime || reconcileTunnelConfig(current, document))} />}
    {restartModalOpen && restartReports.length > 0 && <RestartConfirmation reports={restartReports} busy={busy} onLater={dismissRestartConfirmation} onActivate={(impacts) => void confirmSelfRestart(impacts)} />}
    {interruptedExecutions.length > 0 && <InterruptedExecutionRecovery
      items={interruptedExecutions.map((target) => ({ ...target, queue: executionFIFO.find((item) => item.chatId === target.chat.id && item.planId === target.session.interrupted_execution?.plan_id), humanAction: recoveryHumanAction(target.chat, chatgptHumanActions) }))}
      busyChats={busyChats}
      onDecision={(target, decision, sudoPassword) => void resolveInterruptedExecution(target, decision, sudoPassword)}
      onOpenChat={(target) => void focusRecoveryTarget(target)}
      onOpenLogs={(target) => void focusRecoveryTarget(target, 'terminal')}
      onOpenChatGPT={(target) => void focusRecoveryTarget(target, 'chatgpt')}
    />}
    <ErrorToast open={Boolean(error)} message={error} onDismiss={() => setError(undefined)} onShowInChat={errorChatRef?.message === error ? () => void showErrorInChat() : undefined} />
    {/* One side rail for every mode. The drawer and its width belong to the
        shell, so switching between Agent, Editor and Orchestrator never changes
        which panel is open — and the polling drawers are mounted once, not once
        per workspace. */}
    <div className={`workspace-body ${sideDrawer || rightDrawer ? 'drawer-open' : ''}`} style={{ ['--terminal-height' as string]: terminalOpen ? `${terminalHeight}px` : '0px' } as React.CSSProperties}>
      <div className="workspace-main-row">
      <WorkspaceSideRail
        session={session}
        busy={activeBusy}
        drawer={sideDrawer}
        onDrawer={openLeftDrawer}
        side="left"
        tools={railLayout.left}
        pinnedTools={railLayout.pinned.left}
        onMoveTool={moveRailTool}
        drawerWidth={leftDrawerWidth}
        onDrawerWidth={setLeftDrawerWidth}
        {...sharedRailProps}
      />
      <div className="workspace-center-column">
        <div className={`workspace-surface-content ${splitSurface ? `is-split split-${splitSurface.direction}` : ''}`} style={splitSurface ? { ['--workspace-split-primary' as string]: `${Math.round(splitSurface.ratio * 1000) / 10}%` } as React.CSSProperties : undefined}>
          <div className="workspace-surface-primary">
        <div className="workspace-mode-stack">
        <div className={`workspace-mode-surface ${mode === 'editor' ? 'active' : ''}`} aria-hidden={mode !== 'editor'}>
        <DeferredEditorWorkspace session={session} active={mode === 'editor'} onError={setError} onRunInTerminal={runInTerminal} openPath={editorOpenPath} openNonce={editorOpenNonce} hiddenPaths={hiddenEditorPaths} onLocateFile={locateFileInExplorer} onDetachFile={(path, point) => point ? moveSurfaceByDrag(surfaceTarget('editor', { path }), point) : detachSurface(surfaceTarget('editor', { path }))} onSplitFile={(path, direction) => splitWorkspaceSurface(surfaceTarget('editor', { path }), direction)} />
      </div>
      <div className={`workspace-mode-surface ${mode === 'orchestrator' ? 'active' : ''}`} aria-hidden={mode !== 'orchestrator'}>
        <OrchestratorWorkspace
          session={session}
          chats={chats}
          chatProps={sharedChatProps}
          onGoToChat={(chatId, sessionId) => void goToRuntimeTaskChat(chatId, sessionId)}
          focusNonce={orchestratorFocusNonce}
          focusTaskId={orchestratorTaskFocus.projectPath === session.project_path ? orchestratorTaskFocus.taskId : undefined}
          focusTaskNonce={orchestratorTaskFocus.projectPath === session.project_path ? orchestratorTaskFocus.nonce : 0}
          active={mode === 'orchestrator'}
          bootstrapObjective={orchestratorBootstrapObjective}
          bootstrapIncludeContext={Boolean(pendingBootstrapLaunch?.artifacts.context)}
          onBootstrapAccepted={acceptOrchestratorBootstrap}
          onError={setError}
        />
      </div>
      <div className={`workspace-mode-surface ${mode === 'agent' ? 'active' : ''}`} aria-hidden={mode !== 'agent'}>
        {mainVisibleChats.length === 0 ? <div className="agent-empty-workspace">
          <Icon name="agent" size={30}/>
          <strong>Nenhum chat aberto</strong>
          <span>Não há chats ativos. Reative um chat guardado em Gestão de chats ou crie um novo.</span>
          <button type="button" className="primary-button" disabled={busy} onClick={() => void newChat()}><Icon name="plus" size={14}/> Novo chat</button>
        </div> : <AgentWorkspace
          session={session}
          busy={activeBusy}
          attentionItems={attentionItems}
          chatgptAttentionNonce={chatgptAttentionNonce}
          inspectorAttention={inspectorAttention}
          singlePane={Boolean(sideDrawer && rightDrawer)}
          onOpenAttention={openAttentionItem}
          onAttentionAction={runAttentionItemAction}
          onOpenAttentionDrawer={() => openLeftDrawer('attention')}
          railVisible={mode === 'agent'}
          onExportChat={exportActiveChat}
          onReorderChat={reorderChat}
          onDetachChat={(chatId, point) => point ? moveSurfaceByDrag(surfaceTarget('chat', { chatId }), point) : detachSurface(surfaceTarget('chat', { chatId }))}
          onSplitChat={(chatId, direction) => splitWorkspaceSurface(surfaceTarget('chat', { chatId }), direction)}
          chatProps={{ ...sharedChatProps, chats: mainVisibleChats }}
          inspectorProps={{
		  config, session, events, manualPrompt, busy: activeBusy, chat: activeChat, chats, chatgptSuspended: !shellActive || mode !== 'agent' || projectSettingsOpen || restartModalOpen,
		  onChatGPTURL: bindChatGPTURL, onChatGPTActivity: handleChatGPTActivity, onContextSent: markContextSent, onExecute: execute, onApproveDebug: approveDebug, onRetryDependencyNetwork: retryDependencyNetwork, onRetryHostDependencyRepair: retryHostDependencyRepair, onRejectExecutionPlan: rejectExecutionPlan, onRejectPendingChanges: rejectPendingChanges, onControlExecutionPlan: controlExecutionPlan, onPrepareExecutionPlanReversal: prepareExecutionPlanReversal,
            onManualPlan: submitManualPlan, onPlanFile: submitPlanFile, onBundleFile: submitBundleFile, onTransportFailure: failRemoteInput, onCancelPendingRequest: cancelPendingRequest, onResendPendingRequest: retryPreparedPromptDelivery, onSession: setSession, onResolveConflictWithGPT: resolveConflictWithGPT,
          }}
        />}
      </div>
      </div>
        {terminalOpen && <div className="terminal-resizer" role="separator" aria-orientation="horizontal" aria-label="Ajustar altura do terminal" title="Arraste para aumentar ou reduzir o terminal" onPointerDown={resizeTerminal} onDoubleClick={() => setTerminalHeight(275)} />}
        <TerminalWorkspace session={session} height={terminalHeight} visible={terminalOpen} runRequest={terminalRunRequest} onHeight={setTerminalHeight} onError={setError} onDetachTerminal={() => detachSurface(surfaceTarget('terminal'))} onSplitTerminal={(direction) => splitWorkspaceSurface(surfaceTarget('terminal'), direction)} />
          </div>
          {splitSurface && <div className={`workspace-surface-splitter split-${splitSurface.direction}`} role="separator" aria-orientation={splitSurface.direction === 'vertical' ? 'vertical' : 'horizontal'} aria-label="Redimensionar divisão do workspace" onPointerDown={(event) => resizeWorkspaceSplit(event, splitSurface.direction)} />}
        {splitSurface && <section className="workspace-split-pane"><header><strong>{splitSurface.target.kind === 'chat' ? 'Chat' : splitSurface.target.kind === 'editor' ? splitSurface.target.path || 'Editor' : 'Terminal'}</strong><div><button type="button" onClick={() => detachSurface(splitSurface.target)} title="Destacar para janela" aria-label="Destacar painel para janela"><Icon name="external" size={12}/></button><button type="button" onClick={() => setSplitSurface(undefined)} title="Fechar divisão" aria-label="Fechar divisão">×</button></div></header><iframe title={`Painel ${splitSurface.target.kind}`} src={workspaceSurfaceURL(splitSurface.target, 'split')} /></section>}
        </div>
      </div>
      <WorkspaceSideRail
        session={session}
        busy={activeBusy}
        drawer={rightDrawer}
        onDrawer={openRightDrawer}
        side="right"
        tools={railLayout.right}
        pinnedTools={railLayout.pinned.right}
        onMoveTool={moveRailTool}
        drawerWidth={rightDrawerWidth}
        onDrawerWidth={setRightDrawerWidth}
        {...sharedRailProps}
      />
      </div>
      <WorkbenchStatusBar mode={mode} executionMode={executionMode} automationMode={automationMode} terminalOpen={terminalOpen} activeExecutions={activeExecutionCount} bundleRefreshKey={`${session.id}:${session.artifacts?.length || 0}`} />
    </div>
  </main>
}

async function encodeSystemArtifacts(session: Session, selection: ChatArtifactSelection): Promise<DesktopUserAttachment[]> {
  const files: File[] = []
  if (selection.result && session.last_execution) files.push(new File([executionArtifact(session)], 'wharness-execution-result.md', { type: 'text/markdown' }))
  if (selection.error && (session.last_execution?.success === false || session.last_repair_error)) files.push(new File([errorArtifact(session)], 'wharness-execution-error.md', { type: 'text/markdown' }))
  return encodeChatAttachments(files)
}
