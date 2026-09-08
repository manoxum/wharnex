import { useCallback, useEffect, useRef, useState } from 'react'
import { api, APIError } from './lib/api'
import { BundleRoutingError, isNonTerminalBundleRoutingError } from './lib/bundleRouting'
import type { AppConfig, AutomationMode, ChatArtifactKind, ChatArtifactSelection, ChatGPTActivity, ChatItem, ChatIterationRef, ChatRequestMode, ChatTransportMode, QueuedChatRequest, ExecutionMode, HarnessEvent, Session, WorkspaceMode } from './types'
import { Bootstrap } from './components/Bootstrap'
import { AgentWorkspace, type ExecutionFIFOItem } from './components/AgentWorkspace'
import { InterruptedExecutionRecovery, type InterruptedExecutionTarget } from './components/InterruptedExecutionRecovery'
import { EditorWorkspace } from './components/EditorWorkspace'
import { WorkspaceTopbar } from './components/WorkspaceTopbar'
import { WorkspaceShell } from './components/WorkspaceShell'
import { ProjectSettings } from './components/ProjectSettings'
import { RestartConfirmation } from './components/RestartConfirmation'
import { Icon } from './components/Icon'
import { ErrorToast } from './components/ErrorToast'
import {
  archiveChat as archiveStoredChat, clearActiveWorkspace, deriveChatTitle, loadActiveWorkspace, loadArchivedWorkspaceChats, loadChat, loadLegacyChat,
  loadExecutionHistory, loadRecentWorkspaces, loadWorkspaceChats, newWorkspaceChat, rememberRecent, removeArchivedChat as removeStoredArchivedChat, restoreArchivedChat as restoreStoredChat, saveActiveWorkspace,
  conflictChatGPTCacheKey, enabledTunnelIds, loadTransportOptions, saveArchivedWorkspaceChats, saveAutomationMode, saveChat, saveExecutionHistory, saveExecutionMode, saveWorkspaceChats, TRANSPORT_OPTIONS_STORAGE_KEY, type TransportOptions, type WorkspaceChat,
} from './lib/workspaceMemory'
import { chatgptConversationURL, desktopBridge, isDesktop, sameChatGPTConversation } from './lib/desktop'
import { embeddedProjectInitiallyActive, embeddedProjectPath } from './lib/projectBindings'
import { addChatAttachments, attachmentPromptSuffix, encodeChatAttachments } from './lib/chatAttachments'
import { buildChangeSummary } from './lib/changeSummary'
import { confirmDialog } from './lib/appDialog'
import { errorArtifact, executionArtifact } from './lib/executionArtifacts'
import { projectFileReferenceSuffix } from './lib/projectFileReferences'
import { promptDeliveryFailureKind, type PromptDeliveryFailureKind } from './lib/chatgptPromptDelivery'
import { isRestartPending, restartConfirmationKey } from './lib/restartConfirmation'
import { hasRecordedRequest } from './lib/requestDispatch'
import { executionNeedsAttention } from './lib/executionRecovery'

type FrontendExecutionQueueItem = ExecutionFIFOItem
const INSTANCE_ID = import.meta.env.VITE_WHARNESS_INSTANCE_ID?.trim()

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
  const activeAtLoad = embeddedProject ? undefined : loadActiveWorkspace()
  const [config, setConfig] = useState<AppConfig>()
  const [session, setSession] = useState<Session>()
  const [chats, setChats] = useState<WorkspaceChat[]>([])
  const [archivedChats, setArchivedChats] = useState<WorkspaceChat[]>([])
  const [activeChatId, setActiveChatId] = useState(activeAtLoad?.chatId || '')
  const [items, setItems] = useState<ChatItem[]>([])
  const [events, setEvents] = useState<HarnessEvent[]>([])
  const [manualPrompt, setManualPrompt] = useState('')
  const [mode, setMode] = useState<WorkspaceMode>('agent')
  const [executionMode, setExecutionMode] = useState<ExecutionMode>('protected')
  const [automationMode, setAutomationMode] = useState<AutomationMode>('auto')
  const [chatTransportMode, setChatTransportMode] = useState<ChatTransportMode>('scraper')
  const [globalTransport, setGlobalTransport] = useState<TransportOptions>(() => loadTransportOptions())
  const [recent, setRecent] = useState<string[]>(loadRecentWorkspaces())
  const [restoring, setRestoring] = useState(Boolean(activeAtLoad || embeddedProject))
  const [busy, setBusy] = useState(false)
  const [busyChats, setBusyChats] = useState<Record<string, boolean>>({})
  const [transportProgress, setTransportProgress] = useState('')
  const [chatgptHumanActions, setChatgptHumanActions] = useState<Record<string, DesktopChatGPTHumanAction>>({})
  const [attentionSessions, setAttentionSessions] = useState<Record<string, Session | undefined>>({})
  const [chatgptAttentionNonce, setChatgptAttentionNonce] = useState(0)
  const [inspectorAttention, setInspectorAttention] = useState<{ tab: 'terminal' | 'chatgpt'; nonce: number }>({ tab: 'terminal', nonce: 0 })
  const [error, setError] = useState<string>()
  const [errorChatRef, setErrorChatRef] = useState<{ chatId: string; itemId: string; message: string }>()
  const [preparedDrafts, setPreparedDrafts] = useState<Record<string, number>>({})
  const [failedPromptDeliveries, setFailedPromptDeliveries] = useState<Record<string, PromptDeliveryFailureKind>>({})
  const [queuedRequestsByChat, setQueuedRequestsByChat] = useState<Record<string, QueuedChatRequest[]>>({})
  const queueDrainRef = useRef(false)
  const [projectSettingsOpen, setProjectSettingsOpen] = useState(false)
  const [restartModalOpen, setRestartModalOpen] = useState(false)
  const [interruptedExecutions, setInterruptedExecutions] = useState<Array<{ chat: WorkspaceChat; session: Session }>>([])
  const [executionFIFO, setExecutionFIFO] = useState<FrontendExecutionQueueItem[]>([])
  const [editorOpenPath, setEditorOpenPath] = useState<string>()
  const [editorOpenNonce, setEditorOpenNonce] = useState(0)
  const sourceRef = useRef<EventSource | null>(null)
  const activeChatIdRef = useRef(activeChatId)
  const baselineSeenRef = useRef(new Set<string>())
  const repairDispatchRef = useRef(new Set<string>())
  const chatIdBackfillRef = useRef(new Set<string>())
  const creatingChatRef = useRef(false)
  // Keep strict typecheck stable when a concurrent restage temporarily separates this ref from its consumer.
  void chatIdBackfillRef
  const resumedBundleKeysRef = useRef(new Set<string>())
  const submitBundleFileRef = useRef<(contentBase64: string, requestId: string, filename: string) => Promise<string>>(async () => '')
  const dismissedRestartKeysRef = useRef(new Set<string>())
  const [shellActive, setShellActive] = useState(() => embeddedProject ? embeddedProjectInitiallyActive() : true)

  const restartPresentationKey = restartConfirmationKey(session)
  const activeConflictKey = session?.integration_conflict && activeChatId ? conflictChatGPTCacheKey(activeChatId, session.integration_conflict.id) : ''
  const chatgptHumanAction = chatgptHumanActions[activeConflictKey] || chatgptHumanActions[activeChatId] || Object.values(chatgptHumanActions)[0]
  const activeBusy = busy || Boolean(busyChats[activeChatId])

  useEffect(() => { activeChatIdRef.current = activeChatId }, [activeChatId])

  useEffect(() => {
    if (!session || !activeChatId) return
    setAttentionSessions((current) => current[activeChatId] === session ? current : { ...current, [activeChatId]: session })
  }, [activeChatId, session])

  useEffect(() => {
    if (!session || !chats.length) {
      if (!chats.length) setAttentionSessions({})
      return
    }
    let cancelled = false
    let refreshing = false
    const refresh = async () => {
      if (refreshing) return
      refreshing = true
      try {
        const entries = await Promise.all(chats.map(async (chat) => {
          if (chat.id === activeChatId && chat.sessionId === session.id) return [chat.id, session] as const
          try { return [chat.id, await api.getSession(chat.sessionId)] as const }
          catch { return [chat.id, undefined] as const }
        }))
        if (!cancelled) setAttentionSessions(Object.fromEntries(entries))
      } finally { refreshing = false }
    }
    void refresh()
    const timer = window.setInterval(() => void refresh(), 6000)
    return () => { cancelled = true; window.clearInterval(timer) }
  }, [activeChatId, chats, session])

  useEffect(() => {
    if (!restartPresentationKey) {
      setRestartModalOpen(false)
      return
    }
    if (!dismissedRestartKeysRef.current.has(restartPresentationKey)) setRestartModalOpen(true)
  }, [restartPresentationKey])

  function setChatBusy(chatId: string, value: boolean) {
    setBusyChats((current) => {
      const next = { ...current }
      if (value) next[chatId] = true
      else delete next[chatId]
      return next
    })
  }

  function mutateChatItems(targetChat: WorkspaceChat, projectPath: string, mutate: (current: ChatItem[]) => ChatItem[]) {
    if (activeChatIdRef.current === targetChat.id) { setItems(mutate); return }
    saveChat(projectPath, targetChat.id, mutate(loadChat(projectPath, targetChat.id)))
  }

  const connectEvents = useCallback((id: string, projectPath: string, chatId: string) => {
    sourceRef.current?.close()
    setEvents(loadExecutionHistory(projectPath, chatId))
    const source = new EventSource(api.eventsURL(id))
    source.onmessage = (event) => {
      try {
        const parsed = JSON.parse(event.data) as HarnessEvent
        const planId = String(parsed.data.plan_id || '')
        if (planId && ['execution.queued', 'execution.dequeued', 'execution.started'].includes(parsed.type)) {
          const status: FrontendExecutionQueueItem['status'] = parsed.type === 'execution.queued' ? 'queued' : 'running'
          const owner = loadWorkspaceChats(projectPath).find((chat) => chat.id === chatId)
          setExecutionFIFO((current) => {
            const key = `${id}:${planId}`
            const existing = current.find((item) => item.key === key)
            const next: FrontendExecutionQueueItem = { key, chatId, chatTitle: owner?.title || 'Harness Chat', planId, status, position: Number(parsed.data.position) || existing?.position, addedAt: existing?.addedAt || Date.now() }
            return [...current.filter((item) => item.key !== key), next].sort(compareExecutionQueueItems)
          })
        } else if (planId && ['execution.completed', 'execution.failed', 'execution.duplicate_blocked'].includes(parsed.type)) {
          setExecutionFIFO((current) => current.filter((item) => item.key !== `${id}:${planId}`))
        }
        setEvents((current) => {
          if (current.some((item) => item.id === parsed.id)) return current
          const next = [...current, parsed].slice(-500)
          saveExecutionHistory(projectPath, chatId, next)
          return next
        })
      } catch { /* ignore malformed SSE frame */ }
    }
    sourceRef.current = source
  }, [])

  const persistChats = useCallback((projectPath: string, next: WorkspaceChat[]) => {
    const bounded = next.slice(0, 30)
    setChats(bounded)
    saveWorkspaceChats(projectPath, bounded)
  }, [])

  useEffect(() => {
    let alive = true
    async function initialize() {
      try {
        const value = await api.config()
        if (alive) setConfig(value)
      } catch (e) { if (alive) setError(messageOf(e)) }

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
        const known = loadWorkspaceChats(active.projectPath)
        const selected = known.find((chat) => chat.id === active.chatId) || known[0]
        const projectExecutionMode: ExecutionMode = 'protected'
        const projectAutomationMode: AutomationMode = 'auto'
        let restored: Session
        try {
          restored = await api.getSession(selected?.sessionId || active.sessionId)
          restored = await syncSessionModes(restored, projectExecutionMode, projectAutomationMode)
        } catch (error) {
          if (!(error instanceof APIError) || error.status !== 404) throw error
          restored = await api.createSession(active.projectPath, projectExecutionMode, projectAutomationMode)
        }
        if (!alive) return

        let nextChats = loadWorkspaceChats(restored.project_path)
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
        saveWorkspaceChats(restored.project_path, nextChats)
        setChats(nextChats); setArchivedChats(loadArchivedWorkspaceChats(restored.project_path)); activeChatIdRef.current = nextChat.id; setActiveChatId(nextChat.id); setSession(restored)
        setMode('agent'); setExecutionMode(projectExecutionMode); setAutomationMode(projectAutomationMode); setChatTransportMode(restored.chat_transport_mode || 'scraper'); setManualPrompt(restored.last_manual_prompt || '')
        const chatItems = loadChat(restored.project_path, nextChat.id)
        setItems(chatItems.length ? chatItems : [welcomeItem(restored)])
        connectEvents(restored.id, restored.project_path, nextChat.id)
        saveActiveWorkspace({ sessionId: restored.id, projectPath: restored.project_path, mode: 'agent', chatId: nextChat.id, executionMode: projectExecutionMode, automationMode: projectAutomationMode })
      } catch (e) {
		if (alive) setError(`Não foi possível reabrir o workspace: ${messageOf(e)} A sessão local foi preservada e será tentada novamente no próximo arranque.`)
      } finally { if (alive) setRestoring(false) }
    }
    void initialize()
    return () => { alive = false }
  }, [connectEvents, embeddedProject])

  useEffect(() => () => { sourceRef.current?.close(); sourceRef.current = null }, [])

  useEffect(() => {
    if (!session) return
    if (!embeddedProject) saveActiveWorkspace({ sessionId: session.id, projectPath: session.project_path, mode, chatId: activeChatId || undefined, executionMode, automationMode })
    setRecent(loadRecentWorkspaces())
  }, [session, mode, activeChatId, executionMode, automationMode, embeddedProject])

  useEffect(() => {
    const syncTransport = (event: StorageEvent) => {
      if (event.key === TRANSPORT_OPTIONS_STORAGE_KEY) setGlobalTransport(loadTransportOptions())
    }
    window.addEventListener('storage', syncTransport)
    return () => window.removeEventListener('storage', syncTransport)
  }, [])

  useEffect(() => {
    if (!embeddedProject) return
    const handler = (event: MessageEvent) => {
      if (event.origin !== window.location.origin) return
      if (event.data?.type === 'wharness:project-active') setShellActive(Boolean(event.data.active))
      if (event.data?.type === 'wharness:set-workspace-mode' && (event.data.mode === 'editor' || event.data.mode === 'agent')) setMode(event.data.mode)
      if (event.data?.type === 'wharness:open-project-settings') setProjectSettingsOpen(true)
    }
    window.addEventListener('message', handler)
    window.parent.postMessage({ type: 'wharness:project-ready', projectPath: embeddedProject }, window.location.origin)
    return () => window.removeEventListener('message', handler)
  }, [embeddedProject])

  useEffect(() => {
    if (!embeddedProject) return
    window.parent.postMessage({ type: 'wharness:workspace-mode', projectPath: embeddedProject, mode }, window.location.origin)
  }, [embeddedProject, mode])

  useEffect(() => {
    if (session && activeChatId && items.length) saveChat(session.project_path, activeChatId, items)
  }, [session, activeChatId, items])

  useEffect(() => {
    // A session created before chat-id propagation existed (or one whose
    // creation call failed to attach it) permanently generates
    // "system"-scoped bundle filenames for every derived request, which can
    // never match this chat's real id and deterministically fails bundle
    // validation forever. Backfill it once the mismatch is noticed instead
    // of leaving that session stuck in an unrecoverable repair loop.
    if (!session || !activeChatId || session.chat_id === activeChatId) return
    if (chatIdBackfillRef.current.has(session.id)) return
    chatIdBackfillRef.current.add(session.id)
    void api.setChatId(session.id, activeChatId).then((updated) => {
      if (activeChatIdRef.current === activeChatId) setSession(updated)
    }).catch(() => { chatIdBackfillRef.current.delete(session.id) })
  }, [session, activeChatId])

  useEffect(() => {
	if (!session || !['repair_pending', 'conflict_resolution_pending', 'baseline_update_pending'].includes(session.state) || session.automation_mode !== 'auto' || !session.last_manual_prompt || !activeChatId) return
    const targetChat = chats.find((chat) => chat.id === activeChatId)
    if (!targetChat) return
	if (session.state === 'conflict_resolution_pending') void submitConflictPrompt(session, targetChat)
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
  }, [session, activeChatId, chats])

  useEffect(() => {
    // The post-apply knowledge_review round is independent of session.state
    // on purpose (see PendingKnowledgeReviewRequestID in the backend): the
    // apply that triggered it already succeeded and state already reflects
    // that, so this is keyed on its own field instead of joining the
    // repair/conflict/baseline dispatch above, which would either compete
    // with those states or require "restoring" state afterward.
    if (!session || !session.pending_knowledge_review_request_id || session.automation_mode !== 'auto' || !session.last_manual_prompt || !activeChatId) return
    const targetChat = chats.find((chat) => chat.id === activeChatId)
    if (!targetChat) return
    const dispatchKey = `knowledge:${targetChat.id}:${session.pending_knowledge_review_request_id}`
    if (baselineSeenRef.current.has(dispatchKey)) return
    baselineSeenRef.current.add(dispatchKey)
    void transportPlannerContinuation(session, targetChat).catch((sendError) => {
      baselineSeenRef.current.delete(dispatchKey)
      setError(messageOf(sendError))
    })
  }, [session, activeChatId, chats])

  async function syncSessionModes(value: Session, nextExecution: ExecutionMode, nextAutomation: AutomationMode) {
    let current = value
    const currentAutomation = current.automation_mode || 'manual'
    if (currentAutomation === 'auto' && nextAutomation === 'manual') current = await api.setAutomationMode(current.id, 'manual')
    if (current.execution_mode !== nextExecution) current = await api.setExecutionMode(current.id, nextExecution)
    if ((current.automation_mode || 'manual') !== nextAutomation) current = await api.setAutomationMode(current.id, nextAutomation)
    return current
  }

  async function start(projectPath: string) {
    setBusy(true); setError(undefined)
    try {
      const projectExecutionMode: ExecutionMode = 'protected'
      const projectAutomationMode: AutomationMode = 'auto'
      const created = await api.createSession(projectPath, projectExecutionMode, projectAutomationMode)
      rememberRecent(created.project_path); setRecent(loadRecentWorkspaces())
      let nextChats = loadWorkspaceChats(created.project_path)
      let selected = nextChats[0]
      let selectedSession = created
      if (selected) {
        try {
          selectedSession = await api.getSession(selected.sessionId)
          selectedSession = await syncSessionModes(selectedSession, projectExecutionMode, projectAutomationMode)
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
      persistChats(created.project_path, nextChats)
      setArchivedChats(loadArchivedWorkspaceChats(created.project_path)); setSession(selectedSession); activeChatIdRef.current = selected.id; setActiveChatId(selected.id)
      const chatItems = loadChat(created.project_path, selected.id)
      setItems(chatItems.length ? chatItems : [welcomeItem(selectedSession)])
      setManualPrompt(selectedSession.last_manual_prompt || ''); setEvents([]); setMode('agent'); setExecutionMode(projectExecutionMode); setAutomationMode(projectAutomationMode); setChatTransportMode(selectedSession.chat_transport_mode || 'scraper')
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

  function closeWorkspace() {
    if (embeddedProject) {
      window.parent.postMessage({ type: 'wharness:unbind-project', projectPath: session?.project_path || embeddedProject }, window.location.origin)
      return
    }
    sourceRef.current?.close(); sourceRef.current = null
    clearActiveWorkspace(); setSession(undefined); setChats([]); setArchivedChats([]); activeChatIdRef.current = ''; setActiveChatId(''); setProjectSettingsOpen(false)
    setEvents([]); setManualPrompt(''); setItems([]); setPreparedDrafts({}); setFailedPromptDeliveries({}); setError(undefined); setRecent(loadRecentWorkspaces())
  }

  async function newChat() {
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
    try {
      const chatId = crypto.randomUUID()
      const created = await api.createSession(session.project_path, executionMode, automationMode, chatId)
      const chat = newWorkspaceChat(created.id, 'Novo chat', chatId)
      const next = [chat, ...chats]
      persistChats(created.project_path, next)
      activeChatIdRef.current = chat.id; setActiveChatId(chat.id); setSession(created); setItems([welcomeItem(created)])
      setEvents([]); setManualPrompt(''); setChatTransportMode(created.chat_transport_mode || 'scraper'); connectEvents(created.id, created.project_path, chat.id)
    } catch (e) { setError(messageOf(e)) } finally { creatingChatRef.current = false }
  }

  async function exportActiveChat() {
    if (!session || !activeChatId || activeBusy) return
    const target = chats.find((chat) => chat.id === activeChatId)
    if (!target || target.sessionId !== session.id) return
    setChatBusy(target.id, true); setError(undefined)
    try {
      const exported = await api.exportChat(session.id, {
        chat_id: target.id,
        title: target.title,
        chatgpt_url: target.chatgptUrl,
        chat_items: items,
        frontend_events: events,
      })
      const url = URL.createObjectURL(exported.blob)
      const link = document.createElement('a')
      link.href = url; link.download = exported.filename; link.style.display = 'none'
      document.body.appendChild(link); link.click(); link.remove()
      window.setTimeout(() => URL.revokeObjectURL(url), 0)
    } catch (e) { setError(messageOf(e)) } finally { setChatBusy(target.id, false) }
  }

  async function archiveChat(chatId: string) {
    if (!session || busy) return
    const target = chats.find((chat) => chat.id === chatId)
    if (!target) return

    setBusy(true); setError(undefined)
    try {
      const projectPath = session.project_path
      const bridge = desktopBridge()
      if (bridge && target.chatgptUrl) {
        const remote = await bridge.chatgpt.archiveConversation(chatId, target.chatgptUrl)
        if (!remote.ok) throw new Error(`A conversa local não foi arquivada porque o arquivo remoto não pôde ser confirmado (${remote.state}).`)
      }
      const moved = archiveStoredChat(projectPath, chatId)
      const remoteKeys = [chatId, ...Object.values(target.conflictSurfaces || {}).map((surface) => surface.cacheKey)]
      await Promise.allSettled(remoteKeys.map((cacheKey) => bridge?.chatgpt.release(cacheKey)))
      setArchivedChats(moved.archived)
      setPreparedDrafts((current) => { const next = { ...current }; delete next[chatId]; return next })
      setFailedPromptDeliveries((current) => { const next = { ...current }; delete next[chatId]; return next })
      if (chatId !== activeChatId) {
        setChats(moved.active)
        return
      }

      sourceRef.current?.close(); sourceRef.current = null
      let nextChats = moved.active
      let nextChat = nextChats[0]
      if (!nextChat) {
        // Closing the last open chat is a valid end state: the workspace
        // stays on this project (its session is retained only for
        // project_path, so "Novo chat" can still create a fresh session) but
        // shows no active chat, instead of silently recreating one.
        persistChats(projectPath, [])
        activeChatIdRef.current = ''; setActiveChatId(''); setEvents([]); setItems([]); setManualPrompt('')
        return
      }
      let restored: Session
      try {
        restored = await api.getSession(nextChat.sessionId)
        restored = await syncSessionModes(restored, executionMode, automationMode)
      } catch (error) {
        if (!(error instanceof APIError) || error.status !== 404) throw error
        restored = await api.createSession(projectPath, executionMode, automationMode)
        nextChat = { ...nextChat, sessionId: restored.id, updatedAt: new Date().toISOString() }
        nextChats = nextChats.map((chat) => chat.id === nextChat!.id ? nextChat! : chat)
      }

      persistChats(projectPath, nextChats)
      activeChatIdRef.current = nextChat.id; setActiveChatId(nextChat.id); setSession(restored); setEvents([])
      setManualPrompt(restored.last_manual_prompt || '')
      const chatItems = loadChat(projectPath, nextChat.id)
      setItems(chatItems.length ? chatItems : [welcomeItem(restored)])
      connectEvents(restored.id, restored.project_path, nextChat.id)
    } catch (e) { setError(messageOf(e)) } finally { setBusy(false) }
  }

  async function restoreArchivedChat(chatId: string) {
    if (!session || busy) return
    const target = archivedChats.find((chat) => chat.id === chatId)
    if (!target) return
    setBusy(true); setError(undefined)
    try {
      const projectPath = session.project_path
      const moved = restoreStoredChat(projectPath, chatId)
      let selected = moved.active.find((chat) => chat.id === chatId) || target
      let restored: Session
      try {
        restored = await api.getSession(selected.sessionId)
        restored = await syncSessionModes(restored, executionMode, automationMode)
      } catch (error) {
        if (!(error instanceof APIError) || error.status !== 404) throw error
        restored = await api.createSession(projectPath, executionMode, automationMode)
        selected = { ...selected, sessionId: restored.id, updatedAt: new Date().toISOString() }
        moved.active = moved.active.map((chat) => chat.id === selected.id ? selected : chat)
        saveWorkspaceChats(projectPath, moved.active)
      }
      sourceRef.current?.close(); sourceRef.current = null
      setChats(moved.active); setArchivedChats(moved.archived); activeChatIdRef.current = selected.id; setActiveChatId(selected.id); setSession(restored); setEvents([])
      setManualPrompt(restored.last_manual_prompt || '')
      const chatItems = loadChat(projectPath, selected.id)
      setItems(chatItems.length ? chatItems : [welcomeItem(restored)])
      connectEvents(restored.id, restored.project_path, selected.id)
    } catch (e) { setError(messageOf(e)) } finally { setBusy(false) }
  }

  async function deleteArchivedChat(chatId: string) {
    if (!session || busy) return
    const target = archivedChats.find((chat) => chat.id === chatId)
    if (!target) return
    if (!(await confirmDialog({
      title: 'Eliminar Harness Chat?',
      message: `“${target.title}” será eliminado definitivamente do histórico local e os anexos do Wharness serão apagados. A conversa correspondente na tua conta ChatGPT continuará intacta.`,
      tone: 'danger',
      confirmLabel: 'Eliminar chat',
    }))) return

    setBusy(true); setError(undefined)
    try {
      try { await api.deleteSession(target.sessionId) }
      catch (error) { if (!(error instanceof APIError) || error.status !== 404) throw error }
      if (isDesktop()) {
        try { await desktopBridge()?.attachments.removeChat({ cacheKey: chatId }) } catch { /* permanent local deletion should continue even if orphan cleanup fails */ }
        try { await desktopBridge()?.chatgpt.release?.(chatId) } catch { /* the remote conversation itself remains intact */ }
      }
      setArchivedChats(removeStoredArchivedChat(session.project_path, chatId))
    } catch (e) { setError(messageOf(e)) } finally { setBusy(false) }
  }

  async function renameWorkspaceChat(chatId: string, requestedTitle: string) {
    if (!session) return
    const title = requestedTitle.replace(/\s+/g, ' ').trim().slice(0, 82)
    if (!title) return
    const target = chats.find((chat) => chat.id === chatId) || archivedChats.find((chat) => chat.id === chatId)
    if (!target) return
    setBusy(true); setError(undefined)
    try {
      if (target.chatgptUrl && isDesktop()) {
        const renamed = await desktopBridge()?.chatgpt.organizeConversation(target.id, chatGPTProjectName(session.project_path), title, target.chatgptUrl)
        if (renamed && !renamed.ok) throw new Error(`O nome local não foi alterado porque o ChatGPT não confirmou a renomeação (${renamed.state}).`)
      }
      const updatedAt = new Date().toISOString()
      setChats((current) => { const next = current.map((chat) => chat.id === chatId ? { ...chat, title, updatedAt } : chat); saveWorkspaceChats(session.project_path, next); return next })
      setArchivedChats((current) => { const next = current.map((chat) => chat.id === chatId ? { ...chat, title, updatedAt } : chat); saveArchivedWorkspaceChats(session.project_path, next); return next })
    } catch (cause) { setError(messageOf(cause)) } finally { setBusy(false) }
  }

  async function generateWorkspaceChatTitle(chatId: string) {
    if (!session || !isDesktop()) return
    const target = chats.find((chat) => chat.id === chatId) || archivedChats.find((chat) => chat.id === chatId)
    if (!target?.chatgptUrl) { setError('Este chat ainda não possui uma conversa ChatGPT capaz de fornecer o nome contextual.'); return }
    setBusy(true); setError(undefined)
    try {
      const suggestion = await desktopBridge()?.chatgpt.suggestTitle(target.id, target.chatgptUrl)
      if (!suggestion?.ok || !suggestion.title) throw new Error('O título contextual do ChatGPT ainda não está disponível.')
      await renameWorkspaceChat(chatId, suggestion.title.replace(/^WHX:\s*/i, ''))
    } catch (cause) { setError(messageOf(cause)); setBusy(false) }
  }

  async function selectChat(chatId: string) {
    if (!session || chatId === activeChatId || busy) return
    const selected = chats.find((chat) => chat.id === chatId)
    if (!selected) return
    setBusy(true); setError(undefined)
    try {
      let restored: Session
      try {
        restored = await api.getSession(selected.sessionId)
        restored = await syncSessionModes(restored, executionMode, automationMode)
      } catch (error) {
        if (!(error instanceof APIError) || error.status !== 404) throw error
        restored = await api.createSession(session.project_path, executionMode, automationMode)
        const next = chats.map((chat) => chat.id === chatId ? { ...chat, sessionId: restored.id } : chat)
        persistChats(restored.project_path, next)
      }
      activeChatIdRef.current = chatId; setActiveChatId(chatId); setSession(restored); setEvents([])
      setManualPrompt(restored.last_manual_prompt || ''); setChatTransportMode(restored.chat_transport_mode || 'scraper')
      const chatItems = loadChat(restored.project_path, chatId)
      setItems(chatItems.length ? chatItems : [welcomeItem(restored)])
      connectEvents(restored.id, restored.project_path, chatId)
    } catch (e) { setError(messageOf(e)) } finally { setBusy(false) }
  }

  const updateWorkspaceChat = useCallback((chatId: string, projectPath: string, patch: Partial<WorkspaceChat>) => {
    setChats((current) => {
      const next = current.map((chat) => chat.id === chatId ? { ...chat, ...patch, updatedAt: new Date().toISOString() } : chat)
      saveWorkspaceChats(projectPath, next)
      return next
    })
  }, [])

  function updateChat(patch: Partial<WorkspaceChat>) {
    if (!session || !activeChatId) return
    updateWorkspaceChat(activeChatId, session.project_path, patch)
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
        if (notice.relevant && peer.state === 'baseline_update_pending' && peer.last_manual_prompt && peer.automation_mode === 'auto') {
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
    const contextRequired = !active.lastContextSha256 || active.lastContextSha256 !== session.context.manifest.sha256 || Boolean(active.chatgptUrl && active.lastContextChatgptUrl && !sameChatGPTConversation(active.chatgptUrl, active.lastContextChatgptUrl))
    const errorRequired = session.state === 'repair_pending' || session.last_execution?.success === false || Boolean(session.last_repair_error)
    if ((kind === 'context' && contextRequired) || (kind === 'error' && errorRequired)) return
    const current = Boolean(active.artifactSelection?.[kind])
    updateWorkspaceChat(active.id, session.project_path, { artifactSelection: { ...active.artifactSelection, [kind]: !current } })
  }

  function appendChatItem(targetChat: WorkspaceChat, projectPath: string, item: ChatItem) {
    if (targetChat.id === activeChatIdRef.current) {
      setItems((current) => [...current, item])
      return
    }
    const prior = loadChat(projectPath, targetChat.id)
    saveChat(projectPath, targetChat.id, [...prior, item])
    setChats((current) => {
      const next = current.map((chat) => chat.id === targetChat.id ? { ...chat, updatedAt: new Date().toISOString() } : chat)
      saveWorkspaceChats(projectPath, next)
      return next
    })
  }

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
    if (!sameChatGPTConversation(target.chatgptUrl, conversation)) {
      updateWorkspaceChat(chatId, projectPath, {
        chatgptUrl: conversation,
        lastContextChatgptUrl: target.lastContextSha256 && !target.lastContextChatgptUrl ? conversation : target.lastContextChatgptUrl,
      })
    }
    void desktopBridge()?.chatgpt.confirmAffinity(chatId, conversation).catch((error) => setError(messageOf(error)))
    return true
  }, [archivedChats, chats, updateWorkspaceChat])

	const bindChatGPTURLForSurface = useCallback((cacheKey: string, projectPath: string, url: string) => {
		const conversation = chatgptConversationURL(url)
		if (!conversation) return false
		const owner = chats.find((chat) => Object.values(chat.conflictSurfaces || {}).some((surface) => surface.cacheKey === cacheKey))
		if (!owner) return false
		const entry = Object.entries(owner.conflictSurfaces || {}).find(([, surface]) => surface.cacheKey === cacheKey)
		if (!entry) return false
		const [conflictId, surface] = entry
		const occupied = [...chats, ...archivedChats].some((chat) => sameChatGPTConversation(chat.chatgptUrl, conversation) || Object.entries(chat.conflictSurfaces || {}).some(([id, candidate]) => (chat.id !== owner.id || id !== conflictId) && sameChatGPTConversation(candidate.url, conversation)))
		if (occupied) {
			setError('Esta conversa ChatGPT já pertence a outra superfície do Wharness. Abra uma conversa nova para resolver o conflito.')
			void desktopBridge()?.chatgpt.rejectAffinity(cacheKey, conversation)
			return false
		}
		if (!sameChatGPTConversation(surface.url, conversation)) {
			updateWorkspaceChat(owner.id, projectPath, { conflictSurfaces: { ...owner.conflictSurfaces, [conflictId]: { ...surface, url: conversation } } })
		}
		void desktopBridge()?.chatgpt.confirmAffinity(cacheKey, conversation).catch((error) => setError(messageOf(error)))
		return true
	}, [archivedChats, chats, updateWorkspaceChat])

	const bindChatGPTURLForOwnedKey = useCallback((ownerKey: string, projectPath: string, url: string) => {
		return chats.some((chat) => chat.id === ownerKey)
			? bindChatGPTURLForChat(ownerKey, projectPath, url)
			: bindChatGPTURLForSurface(ownerKey, projectPath, url)
	}, [bindChatGPTURLForChat, bindChatGPTURLForSurface, chats])

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

  useEffect(() => {
    if (!isDesktop()) return
    const bridge = desktopBridge()
    if (!bridge) return
    return bridge.chatgpt.onBundleDownloaded((bundle) => {
      void submitBundleFileRef.current(bundle.contentBase64, bundle.requestId, bundle.filename)
        .catch((bundleError) => setError(messageOf(bundleError)))
    })
  }, [])

  useEffect(() => {
    if (!isDesktop() || !session || chats.length === 0) return
    const bridge = desktopBridge()
    if (!bridge) return
    let cancelled = false
	const keys = chats.flatMap((chat) => [chat.id, ...Object.values(chat.conflictSurfaces || {}).filter((surface) => !surface.resolvedAt).map((surface) => surface.cacheKey)])
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
    void Promise.all(chats.map(async (chat) => {
      const candidate = chat.sessionId === session.id ? session : await api.getSession(chat.sessionId)
      const requests = pendingBundleRequestIDs(candidate)
      await Promise.all(requests.map(async (requestId) => {
        const conflict = candidate.integration_conflict?.request_id === requestId ? candidate.integration_conflict : undefined
        const surface = conflict ? chat.conflictSurfaces?.[conflict.id] : undefined
        const cacheKey = surface?.cacheKey || chat.id
        const url = surface?.url || chat.chatgptUrl
        if (!url) return
        const resumeKey = `${candidate.id}:${requestId}:${cacheKey}`
        if (cancelled || resumedBundleKeysRef.current.has(resumeKey)) return
        resumedBundleKeysRef.current.add(resumeKey)
        try {
          await bridge.chatgpt.resumeExpectedBundle({ cacheKey, sessionId: candidate.id, requestId, url, recoveryBootstrap: candidate.last_manual_prompt || '' })
        } catch (resumeError) {
          resumedBundleKeysRef.current.delete(resumeKey)
          console.warn('pending ChatGPT bundle recovery failed', cacheKey, messageOf(resumeError))
        }
      }))
      return { chat, session: candidate }
    })).then((candidates) => {
      if (!cancelled) setInterruptedExecutions(candidates.filter((candidate) => executionNeedsAttention(candidate.session)))
    }).catch((resumeError) => console.warn('pending ChatGPT supervision recovery failed', messageOf(resumeError)))
    return () => { cancelled = true }
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
	if (session.integration_conflict) {
		return bindChatGPTURLForSurface(conflictChatGPTCacheKey(activeChatId, session.integration_conflict.id), session.project_path, url)
	}
    return bindChatGPTURLForChat(activeChatId, session.project_path, url)
  }

  async function openChatGPTHumanAction() {
    const notice = chatgptHumanAction
    if (!notice?.active) return
	const owner = chats.find((chat) => chat.id === notice.cacheKey || Object.values(chat.conflictSurfaces || {}).some((surface) => surface.cacheKey === notice.cacheKey))
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

  async function send(message: string, attachments: File[], projectFiles: string[], artifacts: ChatArtifactSelection, requestMode: ChatRequestMode = 'direct') {
    if (!session) return
    if (attachments.length && (!isDesktop() || config?.planner !== 'manual')) {
      setError('Anexos diretos requerem o Wharness Desktop com o planner manual.')
      throw new Error('Anexos diretos indisponíveis neste modo.')
    }
    const targetSession = session
    const targetChat = chats.find((chat) => chat.id === activeChatId)
    if (!targetChat) throw new Error('Harness Chat ativo não encontrado.')
    if (!await authorizeChatGPTConversationMismatch(targetChat)) return
    const projectPath = targetSession.project_path
    const transport = targetChat.transport || globalTransport
    const tunnelInstanceIds = enabledTunnelIds(transport, config?.remote_input?.instances || [])

    setChatBusy(targetChat.id, true); setError(undefined)
    const messageId = crypto.randomUUID()
    let encoded: Awaited<ReturnType<typeof encodeChatAttachments>> = []
    let persistedAttachments: ChatItem['attachments'] = undefined
    const systemArtifacts = await encodeSystemArtifacts(targetSession, artifacts)
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
    if (firstRequest) updateWorkspaceChat(targetChat.id, projectPath, { title: generatedChatTitle })
    try {
      const response = await api.message(targetSession.id, message + attachmentPromptSuffix(attachments) + projectFileReferenceSuffix(projectFiles), requestMode)
      if (activeChatIdRef.current === targetChat.id) setSession(response.session)
      updateWorkspaceChat(targetChat.id, response.session.project_path, { sessionId: response.session.id })
      const prompt = response.manual_prompt || response.session.last_manual_prompt || ''
      const turn = response.session.last_turn || response.turn
      const requestId = response.session.last_request_id || turn?.request_id || ''
      if (activeChatIdRef.current === targetChat.id) setManualPrompt(prompt)
      if (requestId) {
        mutateChatItems(targetChat, response.session.project_path, (current) => current.map((item) => item.id === messageId ? { ...item, iteration: iterationRef(requestId, 'outbound', selectedArtifactKinds(artifacts)) } : item))
        updateWorkspaceChat(targetChat.id, response.session.project_path, { requestMode, pendingPlan: requestMode === 'plan_first' ? { requestId, originalMessage: message } : undefined })
      }
      let draftCount = 0
      let autoSubmitted = false
      let transportFailure = ''
      if (prompt && isDesktop() && response.session.chat_transport_mode !== 'manual') {
        try {
          await new Promise<void>((resolve) => window.setTimeout(resolve, 240))
          const bridge = desktopBridge()
          if (!bridge) throw new Error('Desktop bridge indisponível')
          if (activeChatIdRef.current === targetChat.id) setTransportProgress('A preparar o bundle ZIP e a publicar apenas os túneis selecionados…')
          const prepared = await bridge.chatgpt.preparePrompt({
            cacheKey: targetChat.id, text: prompt, transport, tunnelInstanceIds, bootstrapText: message, url: targetChat.chatgptUrl, sessionId: response.session.id,
            requestId: response.session.last_request_id || '', attachments: encoded, artifacts: systemArtifacts, autoSubmit: automationMode === 'auto',
            projectFiles,
            contextSha256: response.session.context.manifest.sha256, lastContextSha256: targetChat.lastContextSha256,
            lastContextChatgptUrl: targetChat.lastContextChatgptUrl, includeContext: artifacts.context || projectFiles.length > 0, preferCurrentConversation: true,
            firstRequest, chatTitle: generatedChatTitle, projectName: chatGPTProjectName(projectPath),
          })
          try {
            const artifactSession = await api.getSession(response.session.id)
            if (activeChatIdRef.current === targetChat.id) setSession(artifactSession)
          } catch { /* artifact metadata refresh is best effort; transport result remains authoritative */ }
          draftCount = prepared.attachmentCount
          autoSubmitted = prepared.submitted
          const bindingAccepted = prepared.conversationUrl ? bindChatGPTURLForChat(targetChat.id, response.session.project_path, prepared.conversationUrl) : true
          if (prepared.includedContext && bindingAccepted) {
            updateWorkspaceChat(targetChat.id, response.session.project_path, {
              lastContextSha256: response.session.context.manifest.sha256,
              lastContextChatgptUrl: prepared.conversationUrl || targetChat.chatgptUrl,
            })
          }
          if (requestId) {
            const actualArtifacts = selectedArtifactKinds({ ...artifacts, context: prepared.includedContext, prompt: true })
            mutateChatItems(targetChat, response.session.project_path, (current) => current.map((item) => item.id === messageId ? { ...item, iteration: iterationRef(requestId, prepared.submitted ? 'submitted' : 'prepared', actualArtifacts, prepared.conversationUrl || targetChat.chatgptUrl) } : item))
          }
          updateWorkspaceChat(targetChat.id, response.session.project_path, { artifactSelection: { context: false, result: false, error: false } })
          if (!prepared.submitted) setPreparedDrafts((current) => ({ ...current, [targetChat.id]: prepared.attachmentCount }))
          setFailedPromptDeliveries((current) => { const next = { ...current }; delete next[targetChat.id]; return next })
        } catch (prepareError) {
          transportFailure = messageOf(prepareError)
          const failureKind = promptDeliveryFailureKind(transportFailure)
          setFailedPromptDeliveries((current) => ({ ...current, [targetChat.id]: failureKind }))
        } finally {
          if (activeChatIdRef.current === targetChat.id) setTransportProgress('')
        }
      }
      const immediatePlannerFailure = turn?.outcome?.status === 'failed' || turn?.outcome?.status === 'partial'
      const immediateConversationalTurn = Boolean(turn && !immediatePlannerFailure && turn.kind !== 'change' && turn.kind !== 'workflow')
      appendChatItem(targetChat, response.session.project_path, {
        id: crypto.randomUUID(), role: 'harness',
        source: immediateConversationalTurn ? 'chatgpt' : 'wharness',
        presentation: immediateConversationalTurn ? 'message' : 'notice',
        createdAt: new Date().toISOString(),
        text: immediatePlannerFailure
          ? `${turn?.message || 'O planner não concluiu o pedido.'}\n\n${turn?.outcome?.message || response.session.last_repair_error || ''}\n\nPode corrigir o prompt, acrescentar contexto/anexos, ativar outro transporte ou repetir o pedido.`
          : immediateConversationalTurn
          ? turn!.message
          : response.session.plan
            ? (turn?.message || response.session.plan.summary)
          : transportFailure
            ? promptDeliveryFailureKind(transportFailure) === 'attention'
              ? `O ChatGPT está aberto, mas ainda não expõe um campo de escrita utilizável: ${transportFailure}`
              : `O prompt foi preparado, mas não foi possível montar o rascunho no ChatGPT: ${transportFailure}`
            : autoSubmitted
              ? 'Entrada do planner submetida automaticamente ao ChatGPT em modo Auto. O Wharness aguarda agora o download validado do bundle.'
            : draftCount
              ? 'A preparação foi enviada ao composer do ChatGPT. Verifique visualmente a entrada preparada antes de confirmar o envio.'
              : 'Prompt do planner preparado. No ChatGPT, gere o bundle ZIP solicitado e clique em Download; o Desktop irá importá-lo automaticamente.',
        meta: immediatePlannerFailure ? `Pedido não concluído · ${turn?.outcome?.retryable ? 'pode ser repetido' : 'requer intervenção'}` : (immediateConversationalTurn ? turnMeta(turn!.kind) : (response.session.state === 'applied' ? 'AUTO · Host aplicado' : (response.session.plan ? `Plano ${response.session.plan.plan_id}` : (autoSubmitted ? `${draftCount} item(ns) de entrada transportados · aguardando resultado ZIP` : (draftCount ? `${draftCount} item(ns) de entrada preparados · aguardando confirmação` : 'Aguardando resultado externo'))))),
        turnKind: turn?.kind,
        iteration: immediatePlannerFailure && requestId ? iterationRef(requestId, 'failed', ['error'], targetChat.chatgptUrl) : undefined,
      })
    } catch (e) {
      const msg = messageOf(e)
      reportChatError(`Falha no planeamento: ${msg}`, 'Falha na request', targetChat, projectPath)
    } finally {
      if (activeChatIdRef.current === targetChat.id) setTransportProgress('')
      setChatBusy(targetChat.id, false)
    }
  }


  function enqueueMainRequest(message: string, attachments: File[], projectFiles: string[], artifacts: ChatArtifactSelection, requestMode: ChatRequestMode = 'direct') {
    if (!activeChatId) return Promise.resolve()
    const queued: QueuedChatRequest = { id: crypto.randomUUID(), message, attachments, projectFiles, artifacts: { ...artifacts }, requestMode, createdAt: new Date().toISOString() }
    setQueuedRequestsByChat((current) => ({ ...current, [activeChatId]: [...(current[activeChatId] || []), queued] }))
    return Promise.resolve()
  }

  function updateQueuedRequest(id: string, message: string) {
    setQueuedRequestsByChat((current) => ({ ...current, [activeChatId]: (current[activeChatId] || []).map((item) => item.id === id ? { ...item, message } : item) }))
  }

  function moveQueuedRequest(id: string, direction: -1 | 1) {
    setQueuedRequestsByChat((current) => {
      const queue = [...(current[activeChatId] || [])]
      const index = queue.findIndex((item) => item.id === id)
      const target = index + direction
      if (index < 0 || target < 0 || target >= queue.length) return current
      ;[queue[index], queue[target]] = [queue[target], queue[index]]
      return { ...current, [activeChatId]: queue }
    })
  }

  function removeQueuedRequest(id: string) {
    setQueuedRequestsByChat((current) => ({ ...current, [activeChatId]: (current[activeChatId] || []).filter((item) => item.id !== id) }))
  }

  function mergeQueuedRequest(id: string) {
    setQueuedRequestsByChat((current) => {
      const queue = [...(current[activeChatId] || [])]
      const index = queue.findIndex((item) => item.id === id)
      if (index < 0 || index >= queue.length - 1) return current
      const first = queue[index]
      const second = queue[index + 1]
      const mergedAttachments = addChatAttachments(first.attachments, second.attachments)
      if (mergedAttachments.error) { setError(`Não foi possível mesclar as requests: ${mergedAttachments.error}`); return current }
      const artifacts: ChatArtifactSelection = {
        context: first.artifacts.context || second.artifacts.context,
        prompt: first.artifacts.prompt || second.artifacts.prompt,
        result: first.artifacts.result || second.artifacts.result,
        error: first.artifacts.error || second.artifacts.error,
      }
      queue.splice(index, 2, { ...first, message: `${first.message}\n\n${second.message}`, attachments: mergedAttachments.files, projectFiles: [...new Set([...first.projectFiles, ...second.projectFiles])], artifacts })
      return { ...current, [activeChatId]: queue }
    })
  }

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
    try { await commentOnActiveTask(queued.message + projectFileReferenceSuffix(queued.projectFiles), queued.attachments) }
    catch (error) {
      setQueuedRequestsByChat((current) => ({ ...current, [activeChatId]: [queued, ...(current[activeChatId] || [])] }))
      setError(messageOf(error))
    }
  }

  useEffect(() => {
    if (!session || !activeChatId || activeBusy || restartModalOpen || queueDrainRef.current || requestChainActive(session) || preparedDrafts[activeChatId]) return
    const next = (queuedRequestsByChat[activeChatId] || [])[0]
    if (!next) return
    queueDrainRef.current = true
    setQueuedRequestsByChat((current) => ({ ...current, [activeChatId]: (current[activeChatId] || []).filter((item) => item.id !== next.id) }))
    void send(next.message, next.attachments, next.projectFiles, next.artifacts, next.requestMode).finally(() => { queueDrainRef.current = false })
    // send intentionally stays outside the dependency array: this effect is a serialized queue dispatcher.
  }, [activeChatId, activeBusy, preparedDrafts, queuedRequestsByChat, restartModalOpen, session?.state, session?.pending_manual_request_ids, session?.self_evolution_activation])

  async function confirmPreparedDraft() {
    if (!activeChatId || busy) return
    setBusy(true); setError(undefined)
    try {
      const bridge = desktopBridge()
      if (!bridge) throw new Error('Desktop bridge indisponível')
      const submitted = await bridge.chatgpt.submitPrepared({ cacheKey: activeChatId })
      if (submitted.conversationUrl) bindChatGPTURL(submitted.conversationUrl)
      setPreparedDrafts((current) => { const next = { ...current }; delete next[activeChatId]; return next })
      setItems((current) => [...current, { id: crypto.randomUUID(), role: 'harness', source: 'wharness', presentation: 'notice', createdAt: new Date().toISOString(), text: 'Prompt e anexos enviados ao ChatGPT após confirmação.', meta: 'Aguardando bundle do ChatGPT' }])
    } catch (e) { setError(messageOf(e)) } finally { setBusy(false) }
  }

  function dismissPreparedDraft() {
    setPreparedDrafts((current) => { const next = { ...current }; delete next[activeChatId]; return next })
  }

  async function retryPreparedPromptDelivery(requestId?: string) {
    if (!session || !activeChatId || busy) return
    if (requestId && !sessionHasPendingRequest(session, requestId)) return
    const targetChat = chats.find((chat) => chat.id === activeChatId)
    if (!targetChat) return
    setBusy(true); setError(undefined); setTransportProgress('A repetir a entrega já preparada ao ChatGPT…')
    try {
      const bridge = desktopBridge()
      if (!bridge) throw new Error('Desktop bridge indisponível')
      const prepared = await bridge.chatgpt.retryPreparedPrompt({ cacheKey: activeChatId, expectedRequestId: requestId })
      if (prepared.conversationUrl) bindChatGPTURL(prepared.conversationUrl)
      if (!prepared.submitted) setPreparedDrafts((current) => ({ ...current, [activeChatId]: prepared.attachmentCount }))
      setFailedPromptDeliveries((current) => { const next = { ...current }; delete next[activeChatId]; return next })
      const text = requestId ? (prepared.submitted ? 'O mesmo pedido foi reenviado ao ChatGPT.' : 'O mesmo pedido foi montado novamente no ChatGPT; confirme o envio quando estiver pronto.') : (prepared.submitted ? 'O prompt original foi entregue novamente ao ChatGPT.' : 'O prompt original foi montado novamente no ChatGPT; confirme o envio quando estiver pronto.')
      const meta = prepared.submitted ? 'Aguardando bundle do ChatGPT' : 'Confirmação pendente'
      appendChatItem(targetChat, session.project_path, { id: crypto.randomUUID(), role: 'harness', source: 'wharness', presentation: 'notice', createdAt: new Date().toISOString(), text, meta, iteration: requestId ? iterationRef(requestId, prepared.submitted ? 'submitted' : 'prepared', ['context', 'prompt'], prepared.conversationUrl || targetChat.chatgptUrl) : undefined })
    } catch (retryError) {
      setError(`Não foi possível repetir a entrega: ${messageOf(retryError)}`)
    } finally { setTransportProgress(''); setBusy(false) }
  }

  async function submitManualPlan(raw: string) {
    if (!session) return
    setBusy(true); setError(undefined)
    try {
      const updated = await api.manualPlan(session.id, raw)
      setSession(updated); setItems((current) => [...current, { id: crypto.randomUUID(), role: 'harness', source: 'wharness', presentation: 'notice', createdAt: new Date().toISOString(), text: updated.plan?.summary || 'Plano manual validado.', meta: updated.policy?.allowed ? 'Policy validada' : 'Policy bloqueou o plano' }])
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

      if (targetChat.id === activeChatIdRef.current) {
        setSession(updated)
        setItems((current) => [...current, planItem])
      } else {
        const prior = loadChat(updated.project_path, targetChat.id)
        saveChat(updated.project_path, targetChat.id, [...prior, planItem])
        setChats((current) => {
          const next = current.map((chat) => chat.id === targetChat!.id ? { ...chat, updatedAt: new Date().toISOString() } : chat)
          saveWorkspaceChats(updated.project_path, next)
          return next
        })
      }
      return `Plano ${updated.plan?.plan_id || requestId} importado e validado no Harness Chat “${targetChat.title}”.`
    } catch (e) {
      const message = messageOf(e)
      setError(message)
      throw new Error(message)
    } finally { if (busyTargetChatId) setChatBusy(busyTargetChatId, false) }
  }


  async function submitBundleFile(contentBase64: string, requestId: string, filename: string) {
    if (!session) throw new Error('Nenhum workspace ativo.')
    let busyTargetChatId = ''
    let targetSession: Session | undefined = session
    let targetChat = chats.find((chat) => chat.id === activeChatId)
    setError(undefined)
    try {
      if (!sessionHasPendingRequest(targetSession, requestId)) {
        targetSession = undefined; targetChat = undefined
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
      if (!targetSession || !targetChat) throw new BundleRoutingError(`O bundle pertence ao pedido ${requestId}, mas esse pedido não está pendente em nenhum Harness Chat deste workspace.`)
      busyTargetChatId = targetChat.id
      setChatBusy(busyTargetChatId, true)

      const knowledgeReviewResult = targetSession.pending_knowledge_review_request_id === requestId
      const submission = await api.executionBundle(targetSession.id, filename, contentBase64)
      const updated = submission.session
      // A pending-approval pause (network access, high-risk command, an
      // offline Go module cache that needs a restricted-network retry) is not
      // a failure: the commandbar already shows the exact action to take.
      // Keying off structured session state (never auto_error prose) is what
      // tells this apart from a genuine automation failure below.
      const pendingApproval = Boolean(submission.auto_error && ((updated.policy?.allowed && updated.policy?.requires_approval) || updated.failure_kind === 'offline_go_module_cache'))
      const plannerFailed = updated.last_turn?.outcome?.status === 'failed' || updated.last_turn?.outcome?.status === 'partial'
      const policyReason = (submission.policy_reasons || updated.policy?.reasons || []).join('; ')
      const workflowRound = submission.workflow_round || updated.workflow_round || 0
      const autoText = submission.remote_recovery_prepared
        ? `O resultado remoto terminou como retryable. O WHX registou a causa e preparou automaticamente um único pedido novo com contexto e base imutável atuais.`
        : submission.policy_blocked
        ? `Bundle bloqueado pela Policy antes da execução: ${policyReason || 'plano não permitido'}.${submission.repair_prepared ? ' O Wharness preparou automaticamente um novo pedido de correção.' : ''}`
		: submission.conflict_prepared
		  ? `O ChangeSet foi verificado, mas encontrou um conflito real. O Wharness preparou uma janela ChatGPT dedicada para resolver apenas ${updated.integration_conflict?.paths.join(', ') || 'os caminhos conflitantes'}.`
        : submission.workflow_prepared
          ? `Passo local ${workflowRound}/6 concluído na sandbox Protected. Os resultados foram incorporados numa continuação para o mesmo ChatGPT; o Wharness vai submetê-la automaticamente.`
          : submission.workflow_executed
            ? `Passo local ${workflowRound}/6 executado na sandbox Protected. Nenhuma alteração deste passo foi aplicada ao host.`
            : submission.auto_applied
              ? (submission.restart_required ? 'Bundle validado. O plano foi verificado na sandbox, aplicado ao próprio Wharness e reconstruído no host. O reinício aguarda confirmação.' : 'Bundle validado. O plano foi executado na sandbox e aplicado automaticamente ao host.')
              : pendingApproval
                ? (updated.failure_kind === 'offline_go_module_cache'
                  ? 'Bundle validado. A execução automática pausou porque a verificação Go precisa do cache de módulos, que ainda não está hidratado offline. Abra o resumo de alertas e use "Permitir rede e repetir" para continuar.'
                  : `Bundle validado. A execução automática pausou porque este plano precisa da sua aprovação explícita${policyReason ? ` (${policyReason})` : ''}. Abra o resumo de alertas e use "Aprovar e executar" para continuar.`)
                : submission.auto_executed
                  ? (submission.auto_error ? `Bundle validado e execução automática iniciada, mas falhou: ${submission.auto_error}` : 'Bundle validado e executado automaticamente na sandbox.')
                  : 'Bundle ZIP importado e plano validado.'
      const conversational = updated.last_turn && updated.last_turn.kind !== 'change' && updated.last_turn.kind !== 'workflow'
      const isPlanProposal = Boolean(conversational && targetChat.pendingPlan?.requestId === updated.last_turn?.request_id)
      const bundleItem: ChatItem = {
        id: crypto.randomUUID(), role: 'harness', source: plannerFailed || submission.policy_blocked || submission.workflow_executed || pendingApproval ? 'wharness' : 'chatgpt', presentation: plannerFailed ? 'notice' : (isPlanProposal ? 'plan' : (submission.policy_blocked || submission.workflow_executed || pendingApproval ? 'notice' : 'message')), createdAt: new Date().toISOString(), text: plannerFailed ? `${updated.last_turn?.message || 'O ChatGPT não concluiu o pedido.'}\n\n${updated.last_turn?.outcome?.message || updated.last_repair_error || ''}\n\nPode corrigir o prompt, acrescentar contexto/anexos, ativar outro transporte ou repetir o pedido.` : (submission.policy_blocked || pendingApproval ? autoText : (submission.workflow_executed ? `${autoText}${updated.last_turn?.message ? `\n\n${updated.last_turn.message}` : ''}` : (conversational ? updated.last_turn!.message : (updated.last_turn?.message || updated.plan?.summary || autoText)))),
        approval: isPlanProposal && targetChat.pendingPlan ? { status: 'pending', requestId: targetChat.pendingPlan.requestId, originalMessage: targetChat.pendingPlan.originalMessage } : undefined,
        meta: plannerFailed
          ? `Pedido não concluído · ${updated.last_turn?.outcome?.retryable ? 'pode ser repetido' : 'requer intervenção'}`
		  : submission.remote_recovery_prepared
		  ? `Recuperação automática · ${updated.last_request_id || ''}`
		  : submission.policy_blocked
          ? `Policy bloqueada${submission.repair_prepared ? ' · reparação automática preparada' : ''}`
		  : submission.conflict_prepared
		  ? 'Conflito real · GPT dedicado'
          : submission.workflow_prepared || submission.workflow_executed
            ? `Workflow ${workflowRound}/6 · sandbox Protected`
            : pendingApproval
              ? (updated.failure_kind === 'offline_go_module_cache' ? 'Aguarda aprovação · rede restrita' : 'Aguarda aprovação · Policy')
              : conversational ? turnMeta(updated.last_turn!.kind) : (submission.auto_applied ? (submission.restart_required ? 'AUTO-EVOLUÇÃO · reinício pendente' : 'AUTO · Host aplicado') : (updated.policy?.allowed ? `Bundle ${filename} · Policy validada` : `Bundle ${filename} · Policy bloqueada`)),
        turnKind: updated.last_turn?.kind,
        iteration: updated.last_turn?.request_id ? iterationRef(updated.last_turn.request_id, plannerFailed ? 'failed' : 'result', plannerFailed || updated.last_execution?.success === false ? ['error', 'result'] : ['result'], targetChat.chatgptUrl) : undefined,
      }
      if (targetChat.id === activeChatIdRef.current) {
        setSession(updated); setManualPrompt(updated.last_manual_prompt || '')
      }
      const waitingForKnowledgeReview = submission.auto_applied && Boolean(updated.pending_knowledge_review_request_id)
      if (waitingForKnowledgeReview && updated.automation_mode === 'auto' && updated.last_manual_prompt) {
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
      if (waitingForKnowledgeReview) {
        appendChatItem(targetChat, updated.project_path, {
          id: crypto.randomUUID(), role: 'harness', source: 'wharness', presentation: 'notice', createdAt: new Date().toISOString(),
          text: updated.automation_mode === 'auto' ? 'Alterações incorporadas no host. A revisão final foi enviada ao ChatGPT antes de apresentar o resultado aplicado.' : 'Alterações incorporadas no host. A revisão final está preparada; envie-a ao ChatGPT para concluir a apresentação.',
          meta: 'Host aplicado · revisão final',
        })
      } else {
        appendChatItem(targetChat, updated.project_path, bundleItem)
      }
      if (knowledgeReviewResult || (submission.auto_applied && !waitingForKnowledgeReview)) {
        const change = buildAppliedChangeSummary(updated)
        if (change) appendChatItem(targetChat, updated.project_path, { id: crypto.randomUUID(), role: 'harness', source: 'wharness', presentation: 'change', createdAt: change.appliedAt, text: 'Alterações e comandos aplicados ao host.', change })
      }
      if (submission.auto_error && !pendingApproval) reportChatError(`A execução automática do bundle falhou:\n\n${submission.auto_error}`, 'Execução do bundle falhou', targetChat, updated.project_path)
      if (submission.auto_executed && updated.last_execution) updateWorkspaceChat(targetChat.id, updated.project_path, { artifactSelection: { ...targetChat.artifactSelection, result: true, error: updated.last_execution.success === false } })
      if (submission.auto_applied) {
        markContextDirtyForOtherChats(updated.project_path, targetChat.id)
        void syncPeerBaselineUpdates(updated.project_path, targetChat.id)
		const resolvedConflict = targetSession.integration_conflict
		if (resolvedConflict && !updated.integration_conflict) {
			const surface = targetChat.conflictSurfaces?.[resolvedConflict.id]
			if (surface) {
				updateWorkspaceChat(targetChat.id, updated.project_path, { conflictSurfaces: { ...targetChat.conflictSurfaces, [resolvedConflict.id]: { ...surface, resolvedAt: new Date().toISOString() } } })
				void desktopBridge()?.chatgpt.release(surface.cacheKey)
			}
		}
      }
      let workflowSubmitted = false
      if (submission.remote_recovery_prepared && updated.state === 'awaiting_plan' && updated.last_manual_prompt) {
        const dispatchKey = `auto-terminal-recovery:${targetChat.id}:${updated.last_request_id || requestId}`
        if (!repairDispatchRef.current.has(dispatchKey)) {
          repairDispatchRef.current.add(dispatchKey)
          await transportPlannerContinuation(updated, targetChat)
        }
      } else if (submission.workflow_prepared && updated.state === 'workflow_pending' && updated.last_manual_prompt) {
        workflowSubmitted = await submitWorkflowPrompt(updated, targetChat)
	  } else if (updated.state === 'conflict_resolution_pending' && updated.last_manual_prompt) {
		await submitConflictPrompt(updated, targetChat)
      } else if (updated.state === 'repair_pending' && updated.last_manual_prompt) {
        await submitRepairPrompt(updated, targetChat)
      } else if (updated.state === 'baseline_update_pending' && updated.last_manual_prompt && updated.automation_mode === 'auto') {
        const dispatchKey = `dispatch:${targetChat.id}:${updated.last_request_id || requestId}`
        if (!baselineSeenRef.current.has(dispatchKey)) {
          baselineSeenRef.current.add(dispatchKey)
          await transportPlannerContinuation(updated, targetChat)
        }
      }
      return submission.auto_applied
        ? (submission.restart_required ? `Bundle ${filename} aplicado ao próprio Wharness; build do host concluído e reinício pendente de confirmação.` : `Bundle ${filename} executado e aplicado automaticamente no Harness Chat “${targetChat.title}”.`)
        : submission.workflow_prepared
          ? workflowSubmitted
            ? `Passo ${workflowRound}/6 executado e continuação submetida no Harness Chat “${targetChat.title}”.`
            : `Passo ${workflowRound}/6 executado; a continuação ficou pendente no Harness Chat “${targetChat.title}”.`
          : `Bundle ${filename} importado no Harness Chat “${targetChat.title}”.`
    } catch (e) {
		const message = messageOf(e)
		if (isNonTerminalBundleRoutingError(e)) {
			setError(undefined)
			return `Bundle atrasado ou duplicado ignorado. (${message})`
		}
		// A downloaded bundle can still be rejected by strict protocol
		// validation. It is terminal for this request: do not leave the chat
		// waiting for a bundle that was already received and refused.
		if (targetSession && targetChat && sessionHasPendingRequest(targetSession, requestId)) {
			const recovered = await failRemoteInput(requestId, `Falha de protocolo ao validar o bundle: ${message}`, 'bundle_validation', targetSession, targetChat)
			if (recovered?.last_request_id && recovered.last_request_id !== requestId) return `Bundle recusado; recuperação automática ${recovered.last_request_id} preparada.`
		} else {
			reportChatError(`Falha ao importar o bundle: ${message}`, 'Falha no bundle')
		}
		throw new Error(message)
    } finally { if (busyTargetChatId) setChatBusy(busyTargetChatId, false) }
  }

  async function authorizeChatGPTConversationMismatch(targetChat: WorkspaceChat) {
    const bridge = desktopBridge()
    const linked = chatgptConversationURL(targetChat.chatgptUrl || '')
    if (!bridge || !linked) return true
    const current = chatgptConversationURL((await bridge.chatgpt.state(targetChat.id)).url)
    if (!current || sameChatGPTConversation(current, linked)) return true
    return confirmDialog({
      title: 'Autorizar nova vinculação ChatGPT?',
      message: 'A conversa aberta no ChatGPT é diferente da conversa vinculada a este Harness Chat. Ao continuar, o pedido será enviado para a conversa aberta e a vinculação será atualizada.',
      tone: 'warning',
      confirmLabel: 'Autorizar e vincular',
      cancelLabel: 'Cancelar',
    })
  }

  async function execute(approved: boolean) {
    if (!session) return
    const targetSession = session
    const targetChat = chats.find((chat) => chat.id === activeChatId)
    if (!targetChat) return
    const direct = targetSession.execution_mode === 'unprotected'
    if (direct && !(await confirmDialog({
      title: 'Executar em Unprotected?',
      message: 'Este plano será executado diretamente no projeto real. As alterações e comandos não passarão pela sandbox e não terão a etapa Apply.',
      tone: 'danger',
      confirmLabel: 'Executar no host',
    }))) return
    const planId = targetSession.plan?.plan_id || 'unknown-plan'
    const queueKey = `${targetSession.id}:${planId}`
    setExecutionFIFO((current) => current.some((item) => item.key === queueKey) ? current : [...current, { key: queueKey, chatId: targetChat.id, chatTitle: targetChat.title, planId, status: current.length ? 'queued' : 'submitting', position: current.length + 1, addedAt: Date.now() }])
    setChatBusy(targetChat.id, true); setError(undefined)
    try {
      const response = await api.execute(targetSession.id, approved || direct)
      if (activeChatIdRef.current === targetChat.id) setSession(response.session)
      const ok = response.session.last_execution?.success
      const warnings = response.session.last_execution?.warnings || []
      if (response.session.last_execution) updateWorkspaceChat(targetChat.id, response.session.project_path, { artifactSelection: { ...targetChat.artifactSelection, result: true, error: !ok } })
      if (direct && ok) {
        markContextDirtyForOtherChats(response.session.project_path, targetChat.id)
        void syncPeerBaselineUpdates(response.session.project_path, targetChat.id)
      }
      appendChatItem(targetChat, response.session.project_path, {
        id: crypto.randomUUID(), role: 'harness', source: 'wharness', presentation: 'notice', createdAt: new Date().toISOString(),
        text: ok ? (direct ? 'Plano executado diretamente no host em modo Unprotected. Não há etapa Apply.' : (warnings.length ? 'Execução concluída na sandbox. As falhas de verificação já existentes na baseline permaneceram inalteradas; o plano não introduziu novas regressões nesses gates.' : 'Execução e verificações concluídas na sandbox. O host ainda não foi alterado.')) : 'A execução terminou com falha.',
        meta: direct && ok ? 'Host alterado diretamente' : (warnings.length ? `${warnings.length} dívida(s) pré-existente(s)` : undefined),
      })
      if (!ok) reportChatError(errorArtifact(response.session) || 'A execução terminou com falha.', 'Execução falhou', targetChat, response.session.project_path)
    } catch (e) {
      const message = messageOf(e)
      const payload = e instanceof APIError ? e.data as { session?: Session } | undefined : undefined
      const failedSession = payload?.session
      if (failedSession) {
        if (activeChatIdRef.current === targetChat.id) { setSession(failedSession); setManualPrompt(failedSession.last_manual_prompt || '') }
        updateWorkspaceChat(targetChat.id, failedSession.project_path, { sessionId: failedSession.id, artifactSelection: { ...targetChat.artifactSelection, result: Boolean(failedSession.last_execution), error: true } })
      } else if (activeChatIdRef.current === targetChat.id) {
        try { setSession(await api.getSession(targetSession.id)) } catch { /* retain last known target state */ }
      }
      reportChatError(failedSession ? errorArtifact(failedSession) || message : message, 'Execução falhou', targetChat, failedSession?.project_path || targetSession.project_path)
      if (failedSession?.state === 'repair_pending' && failedSession.last_manual_prompt) await submitRepairPrompt(failedSession, targetChat)
    } finally {
      setExecutionFIFO((current) => current.filter((item) => item.key !== queueKey).map((item, index) => ({ ...item, position: index + 1, status: index === 0 && item.status === 'queued' ? 'submitting' : item.status })))
      setChatBusy(targetChat.id, false)
    }
  }

  async function resolveInterruptedExecution(target: { chat: WorkspaceChat; session: Session }, decision: 'continue' | 'discard') {
    const intent = target.session.interrupted_execution
    if (!intent) return
    setChatBusy(target.chat.id, true); setError(undefined)
    try {
      const updated = decision === 'continue'
        ? (await api.resumeInterruptedExecution(target.session.id)).session
        : await api.discardInterruptedExecution(target.session.id)
      setInterruptedExecutions((current) => decision === 'discard' || !updated.interrupted_execution
        ? current.filter((candidate) => candidate.session.id !== target.session.id)
        : current.map((candidate) => candidate.session.id === target.session.id ? { ...candidate, session: updated } : candidate))
      if (activeChatIdRef.current === target.chat.id) setSession(updated)
      appendChatItem(target.chat, updated.project_path, {
        id: crypto.randomUUID(), role: 'harness', source: 'wharness', presentation: 'notice', createdAt: new Date().toISOString(),
        text: decision === 'continue' ? `Retomada iniciada em segundo plano: ${intent.plan_id}. Pode continuar a trabalhar enquanto o Wharness acompanha a execução.` : `Execução pendente descartada: ${intent.plan_id}.`,
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
        if (activeChatIdRef.current === target.chat.id) setSession(refreshed)
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

  async function transportPlannerContinuation(promptSession: Session, targetChat: WorkspaceChat, surface?: { cacheKey: string; url?: string }) {
    const text = promptSession.last_manual_prompt || ''
    if (!text) throw new Error('Continuação do planner vazia.')
    if (promptSession.chat_transport_mode === 'manual') throw new Error('Este chat está em modo Manual: copie o prompt e submeta o bundle de resposta manualmente.')
    if (!isDesktop()) throw new Error('O loop automático com ChatGPT requer Wharness Desktop.')
    await new Promise<void>((resolve) => window.setTimeout(resolve, 220))
    const bridge = desktopBridge()
    if (!bridge) throw new Error('Desktop bridge indisponível')
	const continuationArtifacts = continuationArtifactSelection(promptSession)
	const cacheKey = surface?.cacheKey || targetChat.id
	const dedicatedConflict = Boolean(surface)
	const dedicatedURL = surface?.url && !sameChatGPTConversation(surface.url, targetChat.chatgptUrl) ? surface.url : undefined
	const targetURL = dedicatedConflict ? dedicatedURL : targetChat.chatgptUrl
    const transport = targetChat.transport || globalTransport
    const continuationRequestId = promptSession.pending_knowledge_review_request_id || promptSession.last_request_id || ''
    const prepared = await bridge.chatgpt.preparePrompt({
	  cacheKey, text, transport, tunnelInstanceIds: enabledTunnelIds(transport, config?.remote_input?.instances || []), url: targetURL, sessionId: promptSession.id,
      requestId: continuationRequestId, attachments: [], artifacts: await encodeSystemArtifacts(promptSession, continuationArtifacts), autoSubmit: true,
      projectFiles: [],
	  contextSha256: promptSession.context.manifest.sha256, lastContextSha256: dedicatedConflict ? undefined : targetChat.lastContextSha256,
	  lastContextChatgptUrl: dedicatedConflict ? undefined : targetChat.lastContextChatgptUrl, includeContext: dedicatedConflict || continuationArtifacts.context, preferCurrentConversation: false,
    })
	const bindingAccepted = prepared.conversationUrl ? bindChatGPTURLForOwnedKey(cacheKey, promptSession.project_path, prepared.conversationUrl) : true
    const patch: Partial<WorkspaceChat> = {}
	if (!dedicatedConflict && prepared.includedContext && bindingAccepted) {
      patch.lastContextSha256 = promptSession.context.manifest.sha256
      patch.lastContextChatgptUrl = prepared.conversationUrl || targetChat.chatgptUrl
    }
    if (Object.keys(patch).length) updateWorkspaceChat(targetChat.id, promptSession.project_path, patch)
    return prepared
  }

	async function submitConflictPrompt(conflictedSession: Session, targetChat: WorkspaceChat) {
		const conflict = conflictedSession.integration_conflict
		if (!conflict || !conflictedSession.last_manual_prompt) return
		const cacheKey = conflictChatGPTCacheKey(targetChat.id, conflict.id)
		const existing = targetChat.conflictSurfaces?.[conflict.id]
		const dispatchKey = `conflict:${conflictedSession.id}:${conflict.request_id}`
		if (repairDispatchRef.current.has(dispatchKey) || requestAlreadyRecorded(conflictedSession.project_path, targetChat.id, conflict.request_id, ['conflict', 'prepared', 'submitted'])) return
		repairDispatchRef.current.add(dispatchKey)
		updateWorkspaceChat(targetChat.id, conflictedSession.project_path, {
			conflictSurfaces: { ...targetChat.conflictSurfaces, [conflict.id]: { cacheKey, url: existing?.url } },
		})
		appendChatItem(targetChat, conflictedSession.project_path, {
			id: `conflict-${conflict.request_id}`, role: 'harness', source: 'wharness', presentation: 'notice', createdAt: new Date().toISOString(),
			text: `Foi detetado um conflito real em ${conflict.paths.join(', ')}. O Wharness abriu uma janela ChatGPT dedicada e enviará apenas o capsule harness.conflict/v1 para resolução.`,
			meta: `Conflito ${conflict.id} · superfície dedicada`,
			iteration: iterationRef(conflict.request_id, 'conflict', selectedArtifactKinds(continuationArtifactSelection(conflictedSession)), existing?.url || targetChat.chatgptUrl),
		})
		try {
			const prepared = await transportPlannerContinuation(conflictedSession, targetChat, { cacheKey, url: existing?.url })
			const conversation = chatgptConversationURL(prepared.conversationUrl || '')
			if (conversation) {
				// The transport can publish the definitive /c/... URL before React has
				// committed the newly-created surface. Persist it against the known
				// owner directly so the dedicated conflict view survives that race.
				updateWorkspaceChat(targetChat.id, conflictedSession.project_path, {
					conflictSurfaces: { ...targetChat.conflictSurfaces, [conflict.id]: { cacheKey, url: conversation } },
				})
				void desktopBridge()?.chatgpt.confirmAffinity(cacheKey, conversation).catch((error) => setError(messageOf(error)))
			}
			appendChatItem(targetChat, conflictedSession.project_path, {
				id: `conflict-dispatch-${conflict.request_id}`, role: 'harness', source: 'wharness', presentation: 'notice', createdAt: new Date().toISOString(),
				text: prepared.submitted ? 'Capsule de conflito submetido automaticamente na janela ChatGPT dedicada.' : 'Capsule preparado na janela dedicada; confirme o envio para continuar.',
				meta: prepared.submitted ? 'Resolução de conflito em curso' : 'Resolução aguarda confirmação',
				iteration: iterationRef(conflict.request_id, prepared.submitted ? 'submitted' : 'prepared', selectedArtifactKinds(continuationArtifactSelection(conflictedSession)), prepared.conversationUrl || existing?.url || targetChat.chatgptUrl),
			})
		} catch (error) {
			repairDispatchRef.current.delete(dispatchKey)
			setError(`Falha ao preparar a janela dedicada de conflito: ${messageOf(error)}`)
		}
	}

  async function submitWorkflowPrompt(workflowSession: Session, targetChat: WorkspaceChat): Promise<boolean> {
    const round = workflowSession.workflow_round || 1
    const requestId = workflowSession.last_request_id || ''
    if (requestAlreadyRecorded(workflowSession.project_path, targetChat.id, requestId, ['workflow'])) return false
    appendChatItem(targetChat, workflowSession.project_path, {
      id: `workflow-${requestId || round}`, role: 'harness', source: 'wharness', presentation: 'notice', createdAt: new Date().toISOString(),
      text: `O Wharness terminou o passo local ${round}/6 e vai devolver stdout, stderr e códigos de saída ao mesmo ChatGPT para decidir o próximo passo.`,
      meta: workflowSession.last_request_id ? `Workflow ${round}/6 · ${workflowSession.last_request_id}` : `Workflow ${round}/6`,
      turnKind: 'workflow',
      iteration: workflowSession.last_request_id ? iterationRef(workflowSession.last_request_id, 'workflow', selectedArtifactKinds(continuationArtifactSelection(workflowSession)), targetChat.chatgptUrl) : undefined,
    })
    try {
      const prepared = await transportPlannerContinuation(workflowSession, targetChat)
      appendChatItem(targetChat, workflowSession.project_path, {
        id: `workflow-dispatch-${requestId || round}`, role: 'harness', source: 'wharness', presentation: 'notice', createdAt: new Date().toISOString(),
        text: prepared.submitted
          ? 'Resultados locais submetidos automaticamente ao ChatGPT. O Wharness aguarda a próxima decisão ou o encerramento do fluxo.'
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
    const attempt = failedSession.repair_attempt || 1
    const requestId = failedSession.last_request_id || ''
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
      text: `O Wharness criou automaticamente a requisição de correção ${attempt}/3 e vai enviá-la ao mesmo ChatGPT vinculado.${cause ? `\n\n**O que falhou:**\n\n${cause}` : ''}`,
      meta: failedSession.last_request_id ? `Repair ${failedSession.last_request_id}` : 'Repair automático',
      iteration: failedSession.last_request_id ? iterationRef(failedSession.last_request_id, 'repair', selectedArtifactKinds(continuationArtifactSelection(failedSession)), targetChat.chatgptUrl) : undefined,
    })
    try {
      const prepared = await transportPlannerContinuation(failedSession, targetChat)
      appendChatItem(targetChat, failedSession.project_path, { id: `repair-dispatch-${requestId || attempt}`, role: 'harness', source: 'wharness', presentation: 'notice', createdAt: new Date().toISOString(), text: prepared.submitted ? 'Requisição de correção enviada automaticamente ao ChatGPT em background. O Wharness vigia agora o download do novo bundle ZIP.' : 'Requisição de correção preparada no ChatGPT; confirme o envio para continuar.', meta: prepared.submitted ? 'ChatGPT acionado automaticamente' : 'Confirmação pendente', iteration: requestId ? iterationRef(requestId, prepared.submitted ? 'submitted' : 'prepared', selectedArtifactKinds({ ...continuationArtifactSelection(failedSession), context: prepared.includedContext }), prepared.conversationUrl || targetChat.chatgptUrl) : undefined })
    } catch (sendError) {
      appendChatItem(targetChat, failedSession.project_path, { id: `repair-failed-${requestId || attempt}`, role: 'harness', source: 'wharness', presentation: 'notice', createdAt: new Date().toISOString(), text: `A requisição de correção foi preparada, mas o envio automático ao ChatGPT falhou: ${messageOf(sendError)}`, meta: 'Abra a aba ChatGPT para retomar', iteration: requestId ? iterationRef(requestId, 'failed', selectedArtifactKinds(continuationArtifactSelection(failedSession)), targetChat.chatgptUrl) : undefined })
      setError(messageOf(sendError))
    }
  }

  async function reprocessPolicyBlock() {
    if (!session || !activeChatId) return
    const targetChat = chats.find((chat) => chat.id === activeChatId)
    if (!targetChat) return
    setBusy(true); setError(undefined)
    try {
      const repaired = await api.retryPolicyRepair(session.id)
      setSession(repaired)
      setManualPrompt(repaired.last_manual_prompt || '')
      if (!repaired.last_manual_prompt) throw new Error('O Wharness não conseguiu preparar o reprocessamento deste bundle.')
      if (repaired.state === 'awaiting_plan') {
        const prepared = await transportPlannerContinuation(repaired, targetChat)
        appendChatItem(targetChat, repaired.project_path, {
          id: crypto.randomUUID(), role: 'harness', source: 'wharness', presentation: 'notice', createdAt: new Date().toISOString(),
          text: prepared.submitted ? 'O pedido original foi reenviado ao ChatGPT. O Wharness aguarda um novo bundle ZIP.' : 'O pedido original foi preparado no ChatGPT; confirme o envio para receber um novo bundle ZIP.',
          meta: prepared.submitted ? 'Reprocessamento enviado' : 'Reprocessamento · confirmação pendente',
          iteration: repaired.last_request_id ? iterationRef(repaired.last_request_id, prepared.submitted ? 'submitted' : 'prepared', selectedArtifactKinds(continuationArtifactSelection(repaired)), prepared.conversationUrl || targetChat.chatgptUrl) : undefined,
        })
        return
      }
      if (repaired.state !== 'repair_pending') throw new Error('O Wharness não encontrou um bloqueio que possa ser reprocessado.')
      await submitRepairPrompt(repaired, targetChat, true)
    } catch (error) {
      setError(messageOf(error))
    } finally { setBusy(false) }
  }

  async function apply() {
    if (!session || !(await confirmDialog({
      title: 'Aplicar alterações verificadas?',
      message: 'Os patches já verificados na sandbox serão incorporados no projeto real.',
      tone: 'warning',
      confirmLabel: 'Aplicar patches',
    }))) return
    setBusy(true); setError(undefined)
    try {
      const updated = await api.apply(session.id)
      setSession(updated)
      markContextDirtyForOtherChats(updated.project_path, activeChatId)
      void syncPeerBaselineUpdates(updated.project_path, activeChatId)
      const targetChat = chats.find((chat) => chat.id === activeChatId)
      const waitingForKnowledgeReview = Boolean(updated.pending_knowledge_review_request_id)
      if (waitingForKnowledgeReview && updated.automation_mode === 'auto' && updated.last_manual_prompt && targetChat) {
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
      const change = waitingForKnowledgeReview ? undefined : buildAppliedChangeSummary(updated)
      setItems((current) => [...current,
        { id: crypto.randomUUID(), role: 'harness', source: 'wharness', presentation: 'notice', createdAt: new Date().toISOString(), text: waitingForKnowledgeReview ? (updated.automation_mode === 'auto' ? 'Alterações incorporadas no host. A revisão final foi enviada ao ChatGPT antes de apresentar o resultado aplicado.' : 'Alterações incorporadas no host. A revisão final está preparada; envie-a ao ChatGPT para concluir a apresentação.') : (updated.self_evolution ? 'Auto-evolução aplicada: a sandbox passou e o host foi reconstruído. O novo runtime só será ativado quando confirmar o reinício.' : 'Patch aplicado ao projeto real após a verificação da sandbox.'), meta: waitingForKnowledgeReview ? 'Host aplicado · revisão final' : (updated.self_evolution ? 'AUTO-EVOLUÇÃO · reinício pendente' : 'Host alterado') },
        ...(change ? [{ id: crypto.randomUUID(), role: 'harness' as const, source: 'wharness' as const, presentation: 'change' as const, createdAt: change.appliedAt, text: 'Alterações e comandos aplicados ao host.', change }] : []),
      ])
	} catch (e) {
	  setError(messageOf(e))
	  try {
		const latest = await api.getSession(session.id)
		setSession(latest); setManualPrompt(latest.last_manual_prompt || '')
		const targetChat = chats.find((chat) => chat.id === activeChatId)
		if (latest.state === 'conflict_resolution_pending' && latest.last_manual_prompt && targetChat) {
		  await submitConflictPrompt(latest, targetChat)
		} else if (latest.state === 'repair_pending' && latest.last_manual_prompt && targetChat) {
		  await submitRepairPrompt(latest, targetChat)
		}
	  } catch { /* retain the original Apply error */ }
	} finally { setBusy(false) }
  }

  async function retryDependencyNetwork() {
	if (!session || busy || !(await confirmDialog({
		title: 'Permitir rede temporária na sandbox?',
		message: 'Somente comandos Go de dependências, build e teste deste plano serão repetidos com rede. A sandbox continua sem Docker socket, sem privilégios e sem acesso ao projeto original.',
		tone: 'warning',
		confirmLabel: 'Permitir e repetir',
	}))) return
	setBusy(true); setError(undefined)
	try {
		setSession(await api.retryDependencyNetwork(session.id))
	} catch (cause) {
		setError(messageOf(cause))
		// The dependency retry may have executed successfully and then failed on
		// a later verification command. Refresh before unlocking the UI so a
		// stale offline_go_module_cache session cannot expose the retry button a
		// second time after the backend has already advanced to repair_pending.
		try { setSession(await api.getSession(session.id)) } catch { /* keep the original retry error */ }
	} finally { setBusy(false) }
  }

  async function retryHostDependencyRepair() {
	if (!session || busy || !(await confirmDialog({
		title: 'Reinstalar dependências do host?',
		message: 'A mesma verificação passou na sandbox Protected mas falhou no host por uma dependência npm nativa/opcional ausente em node_modules (bug conhecido do npm com dependências opcionais). O Wharness vai rodar, direto no host e sem sudo:\n\n  rm -rf node_modules\n  rm -f package-lock.json\n  npm install\n\nSe a build passar de novo, o Apply é repetido automaticamente.',
		tone: 'warning',
		confirmLabel: 'Reinstalar e repetir',
	}))) return
	setBusy(true); setError(undefined)
	try {
		setSession(await api.retryHostDependencyRepair(session.id))
	} catch (cause) {
		setError(messageOf(cause))
		// The repair may have reinstalled cleanly and then failed a later
		// reverification/apply step. Refresh before unlocking the UI so a
		// stale host_dependency_state session cannot expose this button a
		// second time after the backend already advanced past it.
		try { setSession(await api.getSession(session.id)) } catch { /* keep the original repair error */ }
	} finally { setBusy(false) }
  }

  async function rejectPendingChanges() {
    if (!session || !(await confirmDialog({
      title: 'Rejeitar alterações pendentes?',
      message: 'Todas as alterações verificadas que ainda não foram aplicadas serão descartadas. O projeto real permanecerá inalterado.',
      tone: 'warning',
      confirmLabel: 'Rejeitar alterações',
    }))) return
    setBusy(true); setError(undefined)
    try {
	  const cancelledConflict = session.integration_conflict
      const updated = await api.rejectPendingChanges(session.id)
      setSession(updated)
	  if (cancelledConflict && activeChat) {
		const surface = activeChat.conflictSurfaces?.[cancelledConflict.id]
		if (surface) {
		  updateWorkspaceChat(activeChat.id, updated.project_path, { conflictSurfaces: { ...activeChat.conflictSurfaces, [cancelledConflict.id]: { ...surface, resolvedAt: new Date().toISOString() } } })
		  void desktopBridge()?.chatgpt.release(surface.cacheKey)
		}
	  }
      setItems((current) => [...current, {
        id: crypto.randomUUID(), role: 'harness', source: 'wharness', presentation: 'notice', createdAt: new Date().toISOString(),
        text: 'Todas as alterações pendentes foram rejeitadas. A candidata verificada foi descartada e nada foi incorporado no host.',
        meta: 'Host inalterado',
      }])
    } catch (e) { setError(messageOf(e)) } finally { setBusy(false) }
  }

  function openFileFromChat(path: string) {
    setEditorOpenPath(path)
    setEditorOpenNonce((value) => value + 1)
    setMode('editor')
  }

  async function revertChange(item: ChatItem) {
    if (!session || !item.change || item.change.reverted || busy) return
    const latestAppliedPlanId = session.last_applied_changes?.[session.last_applied_changes.length - 1]?.plan.plan_id || session.plan?.plan_id
    if (!latestAppliedPlanId || latestAppliedPlanId !== item.change.planId) {
      setError('Este resumo pertence a um plano anterior. A reversão segura só está disponível para o último plano aplicado desta sessão.')
      return
    }
    if (!(await confirmDialog({
      title: 'Reverter alterações aplicadas?',
      message: `O plano ${item.change.planId} será revertido no projeto real.`,
      tone: 'danger',
      confirmLabel: 'Reverter plano',
    }))) return
    setBusy(true); setError(undefined)
    try {
      const updated = await api.revert(session.id)
      setSession(updated)
      setItems((current) => current.map((candidate) => candidate.change?.planId === item.change?.planId ? { ...candidate, change: { ...candidate.change!, reverted: true } } : candidate))
      markContextDirtyForOtherChats(updated.project_path, activeChatId)
      void syncPeerBaselineUpdates(updated.project_path, activeChatId)
    } catch (error) { setError(messageOf(error)) } finally { setBusy(false) }
  }

  async function changeExecutionMode(next: ExecutionMode) {
    if (!session || next === executionMode || busy) return
    if (session.self_evolution && next === 'unprotected') { setError('A auto-evolução do próprio Wharness é bloqueada em Unprotected. Use Protected para manter sandbox, build transacional e rollback.'); return }
    let nextAutomation = automationMode
    if (next === 'unprotected') {
      const warning = automationMode === 'auto'
        ? 'Ativar UNPROTECTED? O modo Auto será desativado porque Auto sempre exige sandbox Protected antes de aplicar no host.'
        : 'Ativar UNPROTECTED para este projeto? Os planos do Agent poderão alterar ficheiros e executar comandos diretamente no host, sem sandbox e sem etapa Apply.'
      if (!(await confirmDialog({
        title: 'Ativar Unprotected?',
        message: warning,
        tone: 'danger',
        confirmLabel: 'Ativar Unprotected',
      }))) return
      nextAutomation = 'manual'
    }
    setBusy(true); setError(undefined)
    try {
      const updated = await syncSessionModes(session, next, nextAutomation)
      setSession(updated); setExecutionMode(next); setAutomationMode(nextAutomation)
      saveExecutionMode(updated.project_path, next); saveAutomationMode(updated.project_path, nextAutomation)
      void Promise.allSettled(chats.filter((chat) => chat.sessionId !== updated.id).map(async (chat) => {
        try { const candidate = await api.getSession(chat.sessionId); await syncSessionModes(candidate, next, nextAutomation) } catch { /* stale chat is repaired on selection */ }
      }))
      setItems((current) => [...current, { id: crypto.randomUUID(), role: 'harness', source: 'wharness', presentation: 'notice', createdAt: new Date().toISOString(), text: next === 'unprotected' ? 'Modo Unprotected ativado. Auto foi desativado; execuções diretas continuam a exigir confirmação.' : 'Modo Protected ativado.', meta: next === 'unprotected' ? 'Host direto' : 'Sandbox ativa' }])
    } catch (e) { setError(messageOf(e)) } finally { setBusy(false) }
  }

  async function changeAutomationMode(next: AutomationMode) {
    if (!session || next === automationMode || busy) return
    if (next === 'auto' && !(await confirmDialog({
      title: 'Ativar modo Auto?',
      message: 'Somente pedidos classificados como mudança, com plano válido, serão executados na sandbox Protected e aplicados após verificação. Perguntas e análises nunca serão executadas. No ChatGPT web, ainda é necessário iniciar o download do resultado; com provider API não há download.',
      tone: 'warning',
      confirmLabel: 'Ativar Auto',
    }))) return
    setBusy(true); setError(undefined)
    try {
      const nextExecution: ExecutionMode = next === 'auto' ? 'protected' : executionMode
      const updated = await syncSessionModes(session, nextExecution, next)
      setSession(updated); setExecutionMode(nextExecution); setAutomationMode(next)
      saveExecutionMode(updated.project_path, nextExecution); saveAutomationMode(updated.project_path, next)
      void Promise.allSettled(chats.filter((chat) => chat.sessionId !== updated.id).map(async (chat) => {
        try { const candidate = await api.getSession(chat.sessionId); await syncSessionModes(candidate, nextExecution, next) } catch { /* stale chat is repaired on selection */ }
      }))
      setItems((current) => [...current, { id: crypto.randomUUID(), role: 'harness', source: 'wharness', presentation: 'notice', createdAt: new Date().toISOString(), text: next === 'auto' ? 'Modo Auto ativado. Respostas e análises continuam sem execução. Somente mudanças com plano válido seguem pela sandbox e são aplicadas após verificação; no ChatGPT web o download do resultado ainda precisa ser iniciado na superfície remota.' : 'Modo Manual ativado. Executar e aplicar mudanças voltam a exigir ação do utilizador.', meta: next === 'auto' ? 'AUTO · Protected' : 'Manual' }])
    } catch (e) { setError(messageOf(e)) } finally { setBusy(false) }
  }

  // Deliberately genuinely per-chat, unlike changeExecutionMode/changeAutomationMode
  // above: those two are project-wide by design (propagated to every other chat of
  // the project, because a mismatched sandbox/Auto lock across chats of the same
  // project has real correctness implications). Chat transport mode has no such
  // cross-chat dependency — it only decides whether THIS chat's own Desktop DOM
  // automation runs — so switching it must never touch any other chat's session.
  async function changeChatTransportMode(next: ChatTransportMode) {
    if (!session || next === chatTransportMode || busy) return
    setBusy(true); setError(undefined)
    try {
      const updated = await api.setChatTransportMode(session.id, next)
      setSession(updated); setChatTransportMode(next)
      if (isDesktop() && activeChatId) { try { await desktopBridge()?.chatgpt.setTransportMode(activeChatId, next) } catch { /* best-effort defense in depth; the primary guard is never calling preparePrompt while manual */ } }
      setItems((current) => [...current, { id: crypto.randomUUID(), role: 'harness', source: 'wharness', presentation: 'notice', createdAt: new Date().toISOString(), text: next === 'manual' ? 'Modo Manual ativado para este chat. O Wharness deixa de interagir com o ChatGPT — copie o prompt e entregue o bundle de resposta manualmente.' : 'Modo Scraper ativado para este chat. O Wharness volta a interagir diretamente com o ChatGPT.', meta: next === 'manual' ? 'Manual' : 'Scraper' }])
    } catch (e) { setError(messageOf(e)) } finally { setBusy(false) }
  }

  function dismissRestartConfirmation() {
    if (restartPresentationKey) dismissedRestartKeysRef.current.add(restartPresentationKey)
    setRestartModalOpen(false)
  }

  async function confirmSelfRestart(scope: 'all' | 'current') {
    if (!session || !isRestartPending(session) || busy) return
    setBusy(true); setError(undefined)
    try {
      await desktopBridge()?.windows.prepareRestart(scope)
      const updated = await api.restartSelfEvolution(session.id)
      setSession(updated); setRestartModalOpen(false)
      const detail = scope === 'current' ? 'As outras janelas serão restauradas com os respetivos projetos e estado de trabalho.' : 'Todas as janelas serão restauradas na nova runtime.'
      setItems((current) => [...current, { id: crypto.randomUUID(), role: 'harness', source: 'wharness', presentation: 'notice', createdAt: new Date().toISOString(), text: `Reinício confirmado. ${detail} O supervisor transacional valida a nova runtime e restaura automaticamente a versão anterior se a ativação falhar.`, meta: 'AUTO-EVOLUÇÃO · reinício confirmado' }])
    } catch (e) { setError(messageOf(e)) } finally { setBusy(false) }
  }

  async function commentOnActiveTask(message: string, attachments: File[] = []) {
    if (!session) return
    const active = chats.find((chat) => chat.id === activeChatId)
    const pending = session.pending_manual_request_ids || []
    const requestId = pending[pending.length - 1] || session.last_request_id || active?.pendingPlan?.requestId || ''
    if (!active || !requestId) throw new Error('Nenhuma tarefa ChatGPT ativa para comentar.')
    try {
      const bridge = desktopBridge()
      if (!bridge) throw new Error('Comentários de tarefa requerem Wharness Desktop.')
      const encoded = attachments.length ? await encodeChatAttachments(attachments) : []
      const result = await bridge.chatgpt.queueComment({ cacheKey: active.id, sessionId: session.id, text: message, url: active.chatgptUrl, requestId, commentId: crypto.randomUUID(), attachments: encoded })
      const item: ChatItem = { id: crypto.randomUUID(), role: 'user', source: 'user', text: message, createdAt: new Date().toISOString(), meta: `${result.queued ? 'Comentário em fila' : 'Comentário enviado'} para a tarefa ativa${attachments.length ? ` · ${attachments.length} anexo(s)` : ''}`, iteration: iterationRef(requestId, 'submitted', ['prompt'], active.chatgptUrl) }
      appendChatItem(active, session.project_path, item)
    } catch (error) {
      setError(messageOf(error))
      throw error
    }
  }

  function handleChatGPTActivity(activity: ChatGPTActivity) {
    const active = chats.find((chat) => chat.id === activeChatId)
	const activeSurfaceKeys = active ? [active.id, ...Object.values(active.conflictSurfaces || {}).map((surface) => surface.cacheKey)] : []
	if (!active || (activity.cacheKey && !activeSurfaceKeys.includes(activity.cacheKey))) return
    const requestId = session?.last_request_id || ''
    const thoughtId = `chatgpt-thought:${requestId || active.id}`
    setItems((current) => {
      const without = current.filter((item) => item.id !== thoughtId)
      if (activity.state !== 'thinking' && !activity.text) return without
      const text = activity.text || 'ChatGPT está a processar a tarefa…'
      return [...without, { id: thoughtId, role: 'harness', source: 'chatgpt', presentation: 'thought', text, createdAt: activity.capturedAt, meta: 'Conteúdo/estado visível na interface do ChatGPT' }]
    })
  }

  async function failRemoteInput(requestId: string, reason: string, kind: 'transport' | 'bundle_validation' = 'transport', requestedSession: Session | undefined = session, requestedChat?: WorkspaceChat) {
    if (!requestedSession || !requestId) return
    try {
      const updated = await api.remoteInputFailure(requestedSession.id, requestId, reason.slice(0, 512), kind)
      const active = requestedChat || chats.find((chat) => chat.id === activeChatId)
      if (active?.id === activeChatIdRef.current) setSession(updated)
      if (active) {
        const automaticallyRecovered = updated.last_request_id && updated.last_request_id !== requestId && updated.state === 'awaiting_plan'
        const itemId = `error-${crypto.randomUUID()}`
        appendChatItem(active, updated.project_path, {
          id: itemId, role: 'harness', source: 'wharness', presentation: 'notice', createdAt: new Date().toISOString(),
		  text: automaticallyRecovered ? `O bundle foi recusado com segurança. O WHX preservou a falha como diagnóstico, criou uma nova base imutável e preparou automaticamente um único pedido de correção.\n\nCausa: ${reason}` : `O pedido remoto terminou por falha de protocolo ou comunicação. Nenhum bundle foi executado. Ao repetir, o WHX enviará esta causa para que o ChatGPT corrija o contrato antes de gerar outro ZIP.\n\nCausa: ${reason}`,
		  meta: automaticallyRecovered ? `Recuperação automática preparada · ${updated.last_request_id}` : `Falha de protocolo/comunicação · pedido pode ser repetido · ${reason.slice(0, 180)}`, iteration: iterationRef(requestId, 'failed', ['error'], active.chatgptUrl),
        })
        setError(reason)
        setErrorChatRef({ chatId: active.id, itemId, message: reason })
        if (automaticallyRecovered) {
          const dispatchKey = `auto-protocol-recovery:${active.id}:${updated.last_request_id}`
          if (!repairDispatchRef.current.has(dispatchKey)) {
            repairDispatchRef.current.add(dispatchKey)
            setManualPrompt(updated.last_manual_prompt || '')
            try {
              const prepared = await transportPlannerContinuation(updated, active)
              // A dedicated notice for the recovered request id, distinct from
              // the diagnostic notice above (which stays pinned to the old,
              // now-superseded id). This is what makes "Reenviar request"
              // appear if the automatic delivery below silently fails.
              appendChatItem(active, updated.project_path, {
                id: `auto-recovery-dispatch-${updated.last_request_id}`, role: 'harness', source: 'wharness', presentation: 'notice', createdAt: new Date().toISOString(),
                text: prepared.submitted ? 'O pedido de correção automática foi enviado ao ChatGPT em segundo plano. O Wharness vigia agora o download do novo bundle ZIP.' : 'O pedido de correção automática foi preparado no ChatGPT; confirme o envio para continuar.',
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
    if (!session || busy || requestChainActive(session)) return
    const targetChat = chats.find((chat) => chat.id === activeChatId)
    if (!targetChat) return
    setBusy(true); setError(undefined)
    try {
      const retried = await api.retryFailedRequest(session.id)
      setSession(retried); setManualPrompt(retried.last_manual_prompt || '')
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
    } finally { setBusy(false) }
  }

	async function cancelPendingRequest(requestId: string) {
		if (!session || busy) return
		const targetChat = chats.find((chat) => chat.id === activeChatId)
		if (!targetChat) return
		setBusy(true); setError(undefined)
		try {
			const updated = await api.cancelPendingRequest(session.id)
			setSession(updated); setManualPrompt('')
			appendChatItem(targetChat, updated.project_path, { id: crypto.randomUUID(), role: 'harness', source: 'wharness', presentation: 'notice', createdAt: new Date().toISOString(), text: 'O pedido foi cancelado. A conversa está livre para receber um novo pedido principal; alterações Protected já verificadas foram preservadas.', meta: 'Pedido cancelado', iteration: iterationRef(requestId, 'failed', [], targetChat.chatgptUrl) })
		} catch (cancelError) { setError(messageOf(cancelError)) } finally { setBusy(false) }
	}

  async function analyzeEvolutionEvidence(evidenceIds: string[]) {
    if (!session?.self_evolution || busy || requestChainActive(session)) return
    setBusy(true); setError(undefined)
    try {
      let targetChat = chats.find((chat) => chat.purpose === 'self-evolution')
      let targetSession: Session
      if (targetChat) {
        targetSession = await api.getSession(targetChat.sessionId)
      } else {
        const chatId = crypto.randomUUID()
        targetSession = await api.createSession(session.project_path, executionMode, automationMode, chatId)
        targetChat = { ...newWorkspaceChat(targetSession.id, 'Autoevolução · evidência operacional', chatId), purpose: 'self-evolution' }
        persistChats(session.project_path, [targetChat, ...chats])
      }
      const result = await api.analyzeEvolutionEvidence(targetSession.id, evidenceIds)
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
      appendChatItem(targetChat, result.session.project_path, { id: crypto.randomUUID(), role: 'harness', source: 'wharness', presentation: 'notice', createdAt: new Date().toISOString(), text: `Foram correlacionados ${result.evidence_total} eventos operacionais. A análise foi aberta como proposta de plano e continuará sujeita a aprovação, Policy e sandbox Protected.`, meta: prepared.submitted ? 'Auto-evolução · análise enviada' : 'Auto-evolução · análise preparada', iteration: result.session.last_request_id ? iterationRef(result.session.last_request_id, prepared.submitted ? 'submitted' : 'prepared', ['context', 'prompt'], targetChat.chatgptUrl) : undefined })
    } catch (cause) { setError(messageOf(cause)) } finally { setBusy(false) }
  }

  async function approvePlanProposal(item: ChatItem) {
    if (!item.approval || item.approval.status !== 'pending') return
    const active = chats.find((chat) => chat.id === activeChatId)
    if (!active) return
    setItems((current) => current.map((entry) => entry.id === item.id && entry.approval ? { ...entry, approval: { ...entry.approval, status: 'approved' } } : entry))
    updateChat({ pendingPlan: undefined, requestMode: 'direct' })
    await send(`Plano aprovado. Implemente agora o plano proposto para o pedido original: ${item.approval.originalMessage}

Mantenha o escopo aprovado, execute as verificações adequadas e devolva o bundle canónico de implementação.`, [], [], { context: true, prompt: true, result: false, error: false }, 'direct')
  }

  function rejectPlanProposal(item: ChatItem) {
    setItems((current) => current.map((entry) => entry.id === item.id && entry.approval ? { ...entry, approval: { ...entry.approval, status: 'rejected' } } : entry))
    updateChat({ pendingPlan: undefined, requestMode: 'direct' })
  }

  function changeRequestMode(mode: ChatRequestMode) { updateChat({ requestMode: mode }) }

  submitBundleFileRef.current = submitBundleFile

  if (!session) return <Bootstrap config={config} busy={busy} error={error} recent={recent} restoring={restoring} onStart={start} onCreate={createProject} onClone={cloneProject} />
  const activeChat = chats.find((chat) => chat.id === activeChatId)
	const activeConflict = session.integration_conflict
	const activeConflictSurface = activeChat && activeConflict ? activeChat.conflictSurfaces?.[activeConflict.id] : undefined
	const chatgptSurface = activeChat && activeConflict ? {
		cacheKey: activeConflictSurface?.cacheKey || conflictChatGPTCacheKey(activeChat.id, activeConflict.id),
		title: `Conflito · ${activeConflict.paths.join(', ')}`,
		url: activeConflictSurface?.url,
		conflictId: activeConflict.id,
	} : undefined
  const contextArtifactRequired = Boolean(activeChat && (!activeChat.lastContextSha256 || activeChat.lastContextSha256 !== session.context.manifest.sha256 || activeChat.artifactSelection?.context || (activeChat.chatgptUrl && activeChat.lastContextChatgptUrl && !sameChatGPTConversation(activeChat.chatgptUrl, activeChat.lastContextChatgptUrl))))
  const errorArtifactRequired = session.state === 'repair_pending' || session.last_execution?.success === false || Boolean(session.last_repair_error)
  const composerArtifacts: ChatArtifactSelection = {
    context: contextArtifactRequired,
    prompt: true,
    result: Boolean(activeChat?.artifactSelection?.result),
    error: errorArtifactRequired || Boolean(activeChat?.artifactSelection?.error),
  }
  const recoveryBlocksActiveChat = interruptedExecutions.some((target) => target.chat.id === activeChatId)
  const taskInFlight = requestChainActive(session) || restartModalOpen || recoveryBlocksActiveChat
  const restartPending = isRestartPending(session)
  return <main className="workspace-root">
    {!embeddedProject && <WorkspaceTopbar config={config} session={session} mode={mode} executionMode={executionMode} automationMode={automationMode} instanceID={INSTANCE_ID} restartPending={restartPending} restartBlocked={requestChainActive(session)} busy={busy} onMode={setMode} onRestartPending={() => setRestartModalOpen(true)} onSettings={() => setProjectSettingsOpen(true)} onClose={closeWorkspace} />}
    {projectSettingsOpen && <ProjectSettings session={session} onClose={() => setProjectSettingsOpen(false)} onSession={setSession} onError={setError} />}
    {restartModalOpen && restartPresentationKey && <RestartConfirmation sessionId={session.id} change={buildAppliedChangeSummary(session)} busy={busy} onLater={dismissRestartConfirmation} onRestart={(scope) => void confirmSelfRestart(scope)} />}
    {interruptedExecutions.length > 0 && <InterruptedExecutionRecovery
      items={interruptedExecutions.map((target) => ({ ...target, queue: executionFIFO.find((item) => item.chatId === target.chat.id && item.planId === target.session.interrupted_execution?.plan_id), humanAction: recoveryHumanAction(target.chat, chatgptHumanActions) }))}
      busyChats={busyChats}
      onDecision={(target, decision) => void resolveInterruptedExecution(target, decision)}
      onOpenChat={(target) => void focusRecoveryTarget(target)}
      onOpenLogs={(target) => void focusRecoveryTarget(target, 'terminal')}
      onOpenChatGPT={(target) => void focusRecoveryTarget(target, 'chatgpt')}
    />}
    <ErrorToast open={Boolean(error)} message={error} onDismiss={() => setError(undefined)} onShowInChat={errorChatRef?.message === error ? () => void showErrorInChat() : undefined} />
    <div className={`workspace-mode-surface ${mode === 'editor' ? 'active' : ''}`} aria-hidden={mode !== 'editor'}>
      <EditorWorkspace session={session} onError={setError} openPath={editorOpenPath} openNonce={editorOpenNonce} />
    </div>
    <div className={`workspace-mode-surface ${mode === 'agent' ? 'active' : ''}`} aria-hidden={mode !== 'agent'}>
      {chats.length === 0 ? <div className="agent-empty-workspace">
        <Icon name="agent" size={30}/>
        <strong>Nenhum chat aberto</strong>
        <span>Todos os chats deste projeto foram fechados e arquivados.</span>
        <button type="button" className="primary-button" disabled={busy} onClick={() => void newChat()}><Icon name="plus" size={14}/> Novo chat</button>
      </div> : <AgentWorkspace
        session={session}
        busy={activeBusy}
        executionFIFO={executionFIFO}
        attentionSessions={attentionSessions}
        chatgptHumanActions={chatgptHumanActions}
        chatgptHumanAction={chatgptHumanAction}
        chatgptAttentionNonce={chatgptAttentionNonce}
        inspectorAttention={inspectorAttention}
        onChatGPTHumanAction={() => void openChatGPTHumanAction()}
        onOpenFile={openFileFromChat}
        onError={setError}
        onAnalyzeEvolution={analyzeEvolutionEvidence}
        onExportChat={exportActiveChat}
        chatProps={{
          session, items, chats, archivedChats, activeChatId, busy: activeBusy, executionMode, automationMode, chatTransportMode,
          attachmentsEnabled: isDesktop() && config?.planner === 'manual', preparedAttachmentCount: preparedDrafts[activeChatId], failedPromptDelivery: failedPromptDeliveries[activeChatId],
          artifactSelection: composerArtifacts, artifactRequired: { context: contextArtifactRequired, error: errorArtifactRequired },
          artifactContent: { context: contextArtifact(session), prompt: manualPrompt || session.last_manual_prompt || '', result: executionArtifact(session), error: errorArtifact(session) },
          requestMode: activeChat?.requestMode || 'direct', globalTransport, chatTransport: activeChat?.transport, tunnelInstances: config?.remote_input?.instances || [], taskInFlight, queuedRequests: queuedRequestsByChat[activeChatId] || [], transportProgress: busyChats[activeChatId] ? transportProgress : '',
          onExecutionMode: changeExecutionMode, onAutomationMode: changeAutomationMode, onChatTransportMode: changeChatTransportMode, onToggleArtifact: toggleComposerArtifact, onRequestMode: changeRequestMode,
          onChatTransport: (transport?: TransportOptions) => activeChat && updateWorkspaceChat(activeChat.id, session.project_path, { transport }),
          onSend: enqueueMainRequest, onComment: commentOnActiveTask, onQueueEdit: updateQueuedRequest, onQueueMove: moveQueuedRequest, onQueueRemove: removeQueuedRequest, onQueueMerge: mergeQueuedRequest, onQueuePromote: promoteQueuedRequest,
          onApprovePlan: approvePlanProposal, onRejectPlan: rejectPlanProposal, onConfirmPrepared: confirmPreparedDraft, onDismissPrepared: dismissPreparedDraft, onRetryPreparedDelivery: retryPreparedPromptDelivery, onOpenFile: openFileFromChat, onRevertChange: revertChange, onReprocessPolicyBlock: reprocessPolicyBlock, canReprocessPolicyBlock: Boolean(session.plan && session.policy && !session.policy.allowed), onRetryTransportFailure: retryTransportFailure, onResendPendingRequest: retryPreparedPromptDelivery, onCancelPendingRequest: cancelPendingRequest,
          onNewChat: newChat, onSelectChat: selectChat, onArchiveChat: archiveChat, onRestoreChat: restoreArchivedChat, onDeleteArchivedChat: deleteArchivedChat, onRenameChat: renameWorkspaceChat, onGenerateChatTitle: generateWorkspaceChatTitle,
        }}
        inspectorProps={{
		  config, session, events, manualPrompt, busy: activeBusy, chat: activeChat, chats, chatgptSurface, chatgptSuspended: !shellActive || mode !== 'agent' || projectSettingsOpen || restartModalOpen,
		  onChatGPTURL: bindChatGPTURL, onChatGPTActivity: handleChatGPTActivity, onContextSent: markContextSent, onExecute: execute, onRetryDependencyNetwork: retryDependencyNetwork, onRetryHostDependencyRepair: retryHostDependencyRepair, onApply: apply, onRejectPendingChanges: rejectPendingChanges,
          onManualPlan: submitManualPlan, onPlanFile: submitPlanFile, onBundleFile: submitBundleFile, onTransportFailure: failRemoteInput, onCancelPendingRequest: cancelPendingRequest, onSession: setSession,
        }}
      />}
    </div>
  </main>
}

function recoveryHumanAction(chat: WorkspaceChat, actions: Record<string, DesktopChatGPTHumanAction>) {
  const keys = [chat.id, ...Object.values(chat.conflictSurfaces || {}).map((surface) => surface.cacheKey)]
  return keys.map((key) => actions[key]).find((action) => action?.active)
}

function compareExecutionQueueItems(a: { position?: number; addedAt: number }, b: { position?: number; addedAt: number }) {
  const left = a.position || Number.MAX_SAFE_INTEGER
  const right = b.position || Number.MAX_SAFE_INTEGER
  return left === right ? a.addedAt - b.addedAt : left - right
}

function iterationRef(requestId: string, phase: ChatIterationRef['phase'], artifacts: ChatArtifactKind[], chatgptUrl?: string): ChatIterationRef {
  return { id: crypto.randomUUID(), requestId, phase, artifacts: [...new Set(artifacts)], chatgptUrl }
}

function selectedArtifactKinds(selection: ChatArtifactSelection): ChatArtifactKind[] {
  return (['context', 'prompt', 'result', 'error'] as ChatArtifactKind[]).filter((kind) => selection[kind])
}

function continuationArtifactSelection(session: Session): ChatArtifactSelection {
  const failure = session.state === 'repair_pending' || session.last_execution?.success === false || Boolean(session.last_repair_error)
  return { context: false, prompt: true, result: Boolean(session.last_execution), error: failure }
}

async function encodeSystemArtifacts(session: Session, selection: ChatArtifactSelection): Promise<DesktopUserAttachment[]> {
  const files: File[] = []
  if (selection.result && session.last_execution) files.push(new File([executionArtifact(session)], 'wharness-execution-result.md', { type: 'text/markdown' }))
  if (selection.error && (session.last_execution?.success === false || session.last_repair_error)) files.push(new File([errorArtifact(session)], 'wharness-execution-error.md', { type: 'text/markdown' }))
  return encodeChatAttachments(files)
}

function contextArtifact(session: Session) {
  const manifest = session.context.manifest
  const files = manifest.files.slice(0, 240).map((file) => `- ${file.path} · ${file.size} B · ${file.sha256.slice(0, 12)}`).join('\n')
  const omitted = manifest.files.length > 240 ? `\n- ... ${manifest.files.length - 240} ficheiro(s) adicionais` : ''
  return `# Wharness context snapshot\n\n- id: ${manifest.id}\n- project: ${manifest.project_root}\n- sha256: ${manifest.sha256}\n- files: ${manifest.files.length}\n- text truncated: ${manifest.text_truncated}\n\n## Included files\n\n${files}${omitted}\n`
}

function requestChainActive(session: Session) {
  if (session.planner_in_flight || session.pending_manual_request_ids?.length) return true
  if (session.self_evolution_activation === 'restart_scheduled') return true
  return new Set(['awaiting_plan', 'workflow_pending', 'workflow_planned', 'workflow_observed', 'repair_pending', 'planned', 'baseline_update_pending', 'conflict_resolution_pending', 'restart_scheduled']).has(session.state)
}

function buildAppliedChangeSummary(session: Session) {
  return buildChangeSummary(appliedSummaryPlan(session), session.last_host_applied_at || new Date().toISOString(), session.last_host_commands || [])
}

function appliedSummaryPlan(session: Session) {
  const applied = session.last_applied_changes || []
  if (!applied.length) return session.plan
  const latest = applied[applied.length - 1].plan
  return {
    ...latest,
    summary: applied.map((change) => change.plan.summary).filter(Boolean).join(' + '),
    operations: applied.flatMap((change) => change.plan.operations || []),
    verification: applied.flatMap((change) => change.plan.verification || []),
  }
}

function sessionHasPendingRequest(session: Session, requestId: string) {
  return Boolean(session.pending_manual_request_ids?.includes(requestId) || session.last_request_id === requestId)
}

function pendingBundleRequestIDs(session: Session) {
  return [...new Set((session.pending_manual_request_ids || []).filter(Boolean))]
}

function turnMeta(kind: NonNullable<Session['last_turn']>['kind']) {
  switch (kind) {
    case 'answer': return 'Resposta · sem alterações'
    case 'clarification': return 'Aguardando esclarecimento'
    case 'investigation': return 'Análise · sem alterações'
    case 'workflow': return 'Workflow local · sandbox Protected'
    case 'blocked': return 'Pedido bloqueado'
    default: return 'Plano de mudança'
  }
}

function welcomeItem(session: Session): ChatItem {
  return { id: 'welcome', role: 'harness', source: 'wharness', presentation: 'notice', text: session.self_evolution ? 'Auto-evolução detetada: este workspace é o próprio root da instância Wharness. Mudanças permanecem Protected e, após Apply + build do host, o Wharness pede confirmação antes de reiniciar; o rollback continua disponível até a nova versão ficar saudável.' : 'Contexto preparado. Pode perguntar, pedir uma análise, explorar uma ideia, diagnosticar o projecto ou solicitar uma alteração.', createdAt: new Date().toISOString(), meta: session.self_evolution ? `AUTO-EVOLUÇÃO · ${session.context.manifest.files.length} ficheiros elegíveis` : `${session.context.manifest.files.length} ficheiros elegíveis no snapshot` }
}

function truncateRepairCause(cause?: string, limit = 800) {
  const text = (cause || '').trim()
  if (!text) return ''
  return text.length > limit ? `${text.slice(0, limit)}…` : text
}

function messageOf(error: unknown) {
  if (error instanceof APIError || error instanceof Error) return error.message
  if (typeof error === 'string' && error.trim()) return error
  if (error && typeof error === 'object' && 'message' in error && typeof error.message === 'string' && error.message.trim()) return error.message
  return 'Erro inesperado'
}

function chatGPTProjectName(projectPath: string) {
  const leaf = projectPath.replace(/[\\/]+$/, '').split(/[\\/]/).filter(Boolean).pop() || 'Wharnex'
  return /^wharness$/i.test(leaf) ? 'Wharnex' : leaf.slice(0, 80)
}
