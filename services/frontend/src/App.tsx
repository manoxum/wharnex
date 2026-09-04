import { useCallback, useEffect, useRef, useState } from 'react'
import { api, APIError } from './lib/api'
import type { AppConfig, AutomationMode, ChatArtifactKind, ChatArtifactSelection, ChatGPTActivity, ChatItem, ChatIterationRef, ChatRequestMode, QueuedChatRequest, ExecutionMode, HarnessEvent, Session, WorkspaceMode } from './types'
import { Bootstrap } from './components/Bootstrap'
import { ChatPanel } from './components/ChatPanel'
import { Inspector } from './components/Inspector'
import { EditorWorkspace } from './components/EditorWorkspace'
import { WorkspaceTopbar } from './components/WorkspaceTopbar'
import { ProjectSettings } from './components/ProjectSettings'
import { Icon } from './components/Icon'
import {
  archiveChat as archiveStoredChat, clearActiveWorkspace, deriveChatTitle, loadActiveWorkspace, loadArchivedWorkspaceChats, loadChat, loadLegacyChat,
  loadExecutionHistory, loadRecentWorkspaces, loadWorkspaceChats, newWorkspaceChat, rememberRecent, removeArchivedChat as removeStoredArchivedChat, restoreArchivedChat as restoreStoredChat, saveActiveWorkspace,
  saveAutomationMode, saveChat, saveExecutionHistory, saveExecutionMode, saveWorkspaceChats, type WorkspaceChat,
} from './lib/workspaceMemory'
import { chatgptConversationURL, desktopBridge, isDesktop, sameChatGPTConversation } from './lib/desktop'
import { addChatAttachments, attachmentPromptSuffix, encodeChatAttachments } from './lib/chatAttachments'
import { buildChangeSummary } from './lib/changeSummary'

export default function App() {
  const activeAtLoad = loadActiveWorkspace()
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
  const [recent, setRecent] = useState<string[]>(loadRecentWorkspaces())
  const [restoring, setRestoring] = useState(Boolean(activeAtLoad))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  const [preparedDrafts, setPreparedDrafts] = useState<Record<string, number>>({})
  const [queuedRequestsByChat, setQueuedRequestsByChat] = useState<Record<string, QueuedChatRequest[]>>({})
  const queueDrainRef = useRef(false)
  const [projectSettingsOpen, setProjectSettingsOpen] = useState(false)
  const [restartModalOpen, setRestartModalOpen] = useState(false)
  const [editorOpenPath, setEditorOpenPath] = useState<string>()
  const [editorOpenNonce, setEditorOpenNonce] = useState(0)
  const sourceRef = useRef<EventSource | null>(null)

  const connectEvents = useCallback((id: string, projectPath: string, chatId: string) => {
    sourceRef.current?.close()
    setEvents(loadExecutionHistory(projectPath, chatId))
    const source = new EventSource(api.eventsURL(id))
    source.onmessage = (event) => {
      try {
        const parsed = JSON.parse(event.data) as HarnessEvent
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
        setChats(nextChats); setArchivedChats(loadArchivedWorkspaceChats(restored.project_path)); setActiveChatId(nextChat.id); setSession(restored)
        setMode('agent'); setExecutionMode(projectExecutionMode); setAutomationMode(projectAutomationMode); setManualPrompt(restored.last_manual_prompt || '')
        const chatItems = loadChat(restored.project_path, nextChat.id)
        setItems(chatItems.length ? chatItems : [welcomeItem(restored)])
        connectEvents(restored.id, restored.project_path, nextChat.id)
        saveActiveWorkspace({ sessionId: restored.id, projectPath: restored.project_path, mode: 'agent', chatId: nextChat.id, executionMode: projectExecutionMode, automationMode: projectAutomationMode })
      } catch (e) {
        if (alive) { clearActiveWorkspace(); setError(`Não foi possível reabrir o workspace: ${messageOf(e)}`) }
      } finally { if (alive) setRestoring(false) }
    }
    void initialize()
    return () => { alive = false }
  }, [connectEvents])

  useEffect(() => () => { sourceRef.current?.close(); sourceRef.current = null }, [])

  useEffect(() => {
    if (!session) return
    saveActiveWorkspace({ sessionId: session.id, projectPath: session.project_path, mode, chatId: activeChatId || undefined, executionMode, automationMode })
    setRecent(loadRecentWorkspaces())
  }, [session, mode, activeChatId, executionMode, automationMode])

  useEffect(() => {
    if (session && activeChatId && items.length) saveChat(session.project_path, activeChatId, items)
  }, [session, activeChatId, items])

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
      setArchivedChats(loadArchivedWorkspaceChats(created.project_path)); setSession(selectedSession); setActiveChatId(selected.id)
      const chatItems = loadChat(created.project_path, selected.id)
      setItems(chatItems.length ? chatItems : [welcomeItem(selectedSession)])
      setManualPrompt(selectedSession.last_manual_prompt || ''); setEvents([]); setMode('agent'); setExecutionMode(projectExecutionMode); setAutomationMode(projectAutomationMode)
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
    sourceRef.current?.close(); sourceRef.current = null
    clearActiveWorkspace(); setSession(undefined); setChats([]); setArchivedChats([]); setActiveChatId(''); setProjectSettingsOpen(false)
    setEvents([]); setManualPrompt(''); setItems([]); setPreparedDrafts({}); setError(undefined); setRecent(loadRecentWorkspaces())
  }

  async function newChat() {
    if (!session || busy) return
    setBusy(true); setError(undefined)
    try {
      const created = await api.createSession(session.project_path, executionMode, automationMode)
      const chat = newWorkspaceChat(created.id)
      const next = [chat, ...chats]
      persistChats(created.project_path, next)
      setActiveChatId(chat.id); setSession(created); setItems([welcomeItem(created)])
      setEvents([]); setManualPrompt(''); connectEvents(created.id, created.project_path, chat.id)
    } catch (e) { setError(messageOf(e)) } finally { setBusy(false) }
  }

  async function archiveChat(chatId: string) {
    if (!session || busy) return
    const target = chats.find((chat) => chat.id === chatId)
    if (!target) return

    setBusy(true); setError(undefined)
    try {
      const projectPath = session.project_path
      const moved = archiveStoredChat(projectPath, chatId)
      setArchivedChats(moved.archived)
      setPreparedDrafts((current) => { const next = { ...current }; delete next[chatId]; return next })
      if (chatId !== activeChatId) {
        setChats(moved.active)
        return
      }

      sourceRef.current?.close(); sourceRef.current = null
      let nextChats = moved.active
      let nextChat = nextChats[0]
      let restored: Session
      if (nextChat) {
        try {
          restored = await api.getSession(nextChat.sessionId)
          restored = await syncSessionModes(restored, executionMode, automationMode)
        } catch (error) {
          if (!(error instanceof APIError) || error.status !== 404) throw error
          restored = await api.createSession(projectPath, executionMode, automationMode)
          nextChat = { ...nextChat, sessionId: restored.id, updatedAt: new Date().toISOString() }
          nextChats = nextChats.map((chat) => chat.id === nextChat!.id ? nextChat! : chat)
        }
      } else {
        restored = await api.createSession(projectPath, executionMode, automationMode)
        nextChat = newWorkspaceChat(restored.id, 'Chat principal')
        nextChats = [nextChat]
      }

      persistChats(projectPath, nextChats)
      setActiveChatId(nextChat.id); setSession(restored); setEvents([])
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
      setChats(moved.active); setArchivedChats(moved.archived); setActiveChatId(selected.id); setSession(restored); setEvents([])
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
    if (!window.confirm(`Eliminar definitivamente o Harness Chat "${target.title}"?\n\nO histórico local e os anexos do Wharness serão apagados. A conversa correspondente na tua conta ChatGPT continuará intacta.`)) return

    setBusy(true); setError(undefined)
    try {
      try { await api.deleteSession(target.sessionId) }
      catch (error) { if (!(error instanceof APIError) || error.status !== 404) throw error }
      if (isDesktop()) {
        try { await desktopBridge()?.attachments.removeChat({ cacheKey: chatId }) } catch { /* permanent local deletion should continue even if orphan cleanup fails */ }
      }
      setArchivedChats(removeStoredArchivedChat(session.project_path, chatId))
    } catch (e) { setError(messageOf(e)) } finally { setBusy(false) }
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
      setActiveChatId(chatId); setSession(restored); setEvents([])
      setManualPrompt(restored.last_manual_prompt || '')
      const chatItems = loadChat(restored.project_path, chatId)
      setItems(chatItems.length ? chatItems : [welcomeItem(restored)])
      connectEvents(restored.id, restored.project_path, chatId)
    } catch (e) { setError(messageOf(e)) } finally { setBusy(false) }
  }

  function updateWorkspaceChat(chatId: string, projectPath: string, patch: Partial<WorkspaceChat>) {
    setChats((current) => {
      const next = current.map((chat) => chat.id === chatId ? { ...chat, ...patch, updatedAt: new Date().toISOString() } : chat)
      saveWorkspaceChats(projectPath, next)
      return next
    })
  }

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

  function toggleComposerArtifact(kind: ChatArtifactKind) {
    if (!session || !activeChatId || kind === 'prompt') return
    const active = chats.find((chat) => chat.id === activeChatId)
    if (!active) return
    const contextRequired = !active.lastContextSha256 || active.lastContextSha256 !== session.context.manifest.sha256 || Boolean(active.chatgptUrl && active.lastContextChatgptUrl && !sameChatGPTConversation(active.chatgptUrl, active.lastContextChatgptUrl))
    const errorRequired = session.state === 'repair_pending' || session.last_execution?.success === false
    if ((kind === 'context' && contextRequired) || (kind === 'error' && errorRequired)) return
    const current = Boolean(active.artifactSelection?.[kind])
    updateWorkspaceChat(active.id, session.project_path, { artifactSelection: { ...active.artifactSelection, [kind]: !current } })
  }

  function appendChatItem(targetChat: WorkspaceChat, projectPath: string, item: ChatItem) {
    if (targetChat.id === activeChatId) {
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

  function bindChatGPTURL(url: string) {
    if (!session || !activeChatId) return false
    const conversation = chatgptConversationURL(url)
    if (!conversation) return false
    const conflict = [...chats, ...archivedChats].find((chat) => chat.id !== activeChatId && sameChatGPTConversation(chat.chatgptUrl, conversation))
    if (conflict) {
      setError(`A conversa ChatGPT já está vinculada ao Harness Chat ${conflict.title}. Abra outra conversa ou reabra esse chat para continuar nela.`)
      return false
    }
    const active = chats.find((chat) => chat.id === activeChatId)
    updateWorkspaceChat(activeChatId, session.project_path, {
      chatgptUrl: conversation,
      lastContextChatgptUrl: active?.lastContextSha256 && !active.lastContextChatgptUrl ? conversation : active?.lastContextChatgptUrl,
    })
    return true
  }

  function markContextSent(sha256: string, conversationUrl?: string) {
    updateChat({ lastContextSha256: sha256, lastContextChatgptUrl: conversationUrl || chats.find((chat) => chat.id === activeChatId)?.chatgptUrl })
  }

  async function send(message: string, attachments: File[], artifacts: ChatArtifactSelection, requestMode: ChatRequestMode = 'direct') {
    if (!session) return
    if (attachments.length && (!isDesktop() || config?.planner !== 'manual')) {
      setError('Anexos diretos requerem o Wharness Desktop com o planner manual.')
      throw new Error('Anexos diretos indisponíveis neste modo.')
    }
    const activeChat = chats.find((chat) => chat.id === activeChatId)
    if (!activeChat) throw new Error('Harness Chat ativo não encontrado.')

    setBusy(true); setError(undefined)
    const messageId = crypto.randomUUID()
    let encoded: Awaited<ReturnType<typeof encodeChatAttachments>> = []
    let persistedAttachments: ChatItem['attachments'] = undefined
    const systemArtifacts = await encodeSystemArtifacts(session, artifacts)
    if (attachments.length) {
      try {
        encoded = await encodeChatAttachments(attachments)
        const bridge = desktopBridge()
        if (!bridge) throw new Error('Desktop bridge indisponível')
        const persisted = await bridge.attachments.persist({ cacheKey: activeChat.id, messageId, attachments: encoded })
        persistedAttachments = persisted.attachments.map((file) => ({
          name: file.name, size: file.size, mime: file.mime, storageRef: file.storageRef, previewKind: file.previewKind,
        }))
      } catch (attachmentError) {
        const detail = messageOf(attachmentError)
        setError(`Não foi possível guardar os anexos do chat: ${detail}`)
        setBusy(false)
        throw attachmentError
      }
    }

    const userItem: ChatItem = { id: messageId, role: 'user', source: 'user', text: message, createdAt: new Date().toISOString(), attachments: persistedAttachments }
    setItems((current) => [...current, userItem])
    if (activeChat.title === 'Novo chat' || activeChat.title === 'Chat principal') updateChat({ title: deriveChatTitle(message) })
    try {
      const response = await api.message(session.id, message + attachmentPromptSuffix(attachments), requestMode)
      setSession(response.session); updateChat({ sessionId: response.session.id })
      const prompt = response.manual_prompt || response.session.last_manual_prompt || ''
      const turn = response.session.last_turn || response.turn
      const requestId = response.session.last_request_id || turn?.request_id || ''
      setManualPrompt(prompt)
      if (requestId) {
        setItems((current) => current.map((item) => item.id === messageId ? { ...item, iteration: iterationRef(requestId, 'outbound', selectedArtifactKinds(artifacts)) } : item))
        updateWorkspaceChat(activeChat.id, response.session.project_path, { requestMode, pendingPlan: requestMode === 'plan_first' ? { requestId, originalMessage: message } : undefined })
      }
      let draftCount = 0
      let autoSubmitted = false
      let transportFailure = ''
      if (prompt && activeChat && isDesktop()) {
        try {
          await new Promise<void>((resolve) => window.setTimeout(resolve, 240))
          const bridge = desktopBridge()
          if (!bridge) throw new Error('Desktop bridge indisponível')
          const prepared = await bridge.chatgpt.preparePrompt({
            cacheKey: activeChat.id, text: prompt, url: activeChat.chatgptUrl, sessionId: response.session.id,
            requestId: response.session.last_request_id || '', attachments: encoded, artifacts: systemArtifacts, autoSubmit: automationMode === 'auto',
            contextSha256: response.session.context.manifest.sha256, lastContextSha256: activeChat.lastContextSha256,
            lastContextChatgptUrl: activeChat.lastContextChatgptUrl, includeContext: artifacts.context, preferCurrentConversation: true,
          })
          draftCount = prepared.attachmentCount
          autoSubmitted = prepared.submitted
          const bindingAccepted = prepared.conversationUrl ? bindChatGPTURL(prepared.conversationUrl) : true
          if (prepared.includedContext && bindingAccepted) {
            updateChat({
              lastContextSha256: response.session.context.manifest.sha256,
              lastContextChatgptUrl: prepared.conversationUrl || activeChat.chatgptUrl,
            })
          }
          if (requestId) {
            const actualArtifacts = selectedArtifactKinds({ ...artifacts, context: prepared.includedContext, prompt: true })
            setItems((current) => current.map((item) => item.id === messageId ? { ...item, iteration: iterationRef(requestId, prepared.submitted ? 'submitted' : 'prepared', actualArtifacts, prepared.conversationUrl || activeChat.chatgptUrl) } : item))
          }
          updateWorkspaceChat(activeChat.id, response.session.project_path, { artifactSelection: { context: false, result: false, error: false } })
          if (!prepared.submitted) setPreparedDrafts((current) => ({ ...current, [activeChat.id]: prepared.attachmentCount }))
        } catch (prepareError) {
          transportFailure = messageOf(prepareError)
        }
      }
      const immediateConversationalTurn = Boolean(turn && turn.kind !== 'change' && turn.kind !== 'workflow')
      setItems((current) => [...current, {
        id: crypto.randomUUID(), role: 'harness',
        source: immediateConversationalTurn ? 'chatgpt' : 'wharness',
        presentation: immediateConversationalTurn ? 'message' : 'notice',
        createdAt: new Date().toISOString(),
        text: immediateConversationalTurn
          ? turn!.message
          : response.session.plan
            ? (turn?.message || response.session.plan.summary)
          : transportFailure
            ? `O prompt foi preparado, mas não foi possível montar o rascunho no ChatGPT: ${transportFailure}`
            : autoSubmitted
              ? 'Prompt e anexos submetidos automaticamente ao ChatGPT em modo Auto. O Wharness aguarda agora o download validado do bundle.'
            : draftCount
              ? 'A preparação foi enviada ao composer do ChatGPT. Verifique visualmente se o prompt e os anexos aparecem antes de confirmar o envio.'
              : 'Prompt do planner preparado. No ChatGPT, gere o bundle ZIP solicitado e clique em Download; o Desktop irá importá-lo automaticamente.',
        meta: immediateConversationalTurn ? turnMeta(turn!.kind) : (response.session.state === 'applied' ? 'AUTO · Host aplicado' : (response.session.plan ? `Plano ${response.session.plan.plan_id}` : (autoSubmitted ? `${draftCount} anexo(s) transportados · aguardando resultado ZIP` : (draftCount ? `${draftCount} anexo(s) preparados · aguardando confirmação` : 'Aguardando resultado externo')))),
        turnKind: turn?.kind,
      }])
    } catch (e) {
      const msg = messageOf(e); setError(msg)
      setItems((current) => [...current, { id: crypto.randomUUID(), role: 'harness', source: 'wharness', presentation: 'notice', createdAt: new Date().toISOString(), text: `Falha no planeamento: ${msg}` }])
    } finally { setBusy(false) }
  }


  function enqueueMainRequest(message: string, attachments: File[], artifacts: ChatArtifactSelection, requestMode: ChatRequestMode = 'direct') {
    if (!activeChatId) return Promise.resolve()
    const queued: QueuedChatRequest = { id: crypto.randomUUID(), message, attachments, artifacts: { ...artifacts }, requestMode, createdAt: new Date().toISOString() }
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
      queue.splice(index, 2, { ...first, message: `${first.message}\n\n${second.message}`, attachments: mergedAttachments.files, artifacts })
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
    try { await commentOnActiveTask(queued.message, queued.attachments) }
    catch (error) {
      setQueuedRequestsByChat((current) => ({ ...current, [activeChatId]: [queued, ...(current[activeChatId] || [])] }))
      setError(messageOf(error))
    }
  }

  useEffect(() => {
    if (!session || !activeChatId || busy || queueDrainRef.current || requestChainActive(session) || preparedDrafts[activeChatId]) return
    const next = (queuedRequestsByChat[activeChatId] || [])[0]
    if (!next) return
    queueDrainRef.current = true
    setQueuedRequestsByChat((current) => ({ ...current, [activeChatId]: (current[activeChatId] || []).filter((item) => item.id !== next.id) }))
    void send(next.message, next.attachments, next.artifacts, next.requestMode).finally(() => { queueDrainRef.current = false })
    // send intentionally stays outside the dependency array: this effect is a serialized queue dispatcher.
  }, [activeChatId, busy, preparedDrafts, queuedRequestsByChat, session?.state, session?.pending_manual_request_ids])

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
    setBusy(true); setError(undefined)
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

      const updated = await api.manualPlan(targetSession.id, raw)
      const planItem: ChatItem = {
        id: crypto.randomUUID(), role: 'harness', source: 'wharness', presentation: 'notice', createdAt: new Date().toISOString(),
        text: updated.plan?.summary || 'Plano importado do ficheiro JSON.',
        meta: updated.policy?.allowed ? 'Ficheiro importado · Policy validada' : 'Ficheiro importado · Policy bloqueou o plano',
      }

      if (targetChat.id === activeChatId) {
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
    } finally { setBusy(false) }
  }


  async function submitBundleFile(contentBase64: string, requestId: string, filename: string) {
    if (!session) throw new Error('Nenhum workspace ativo.')
    setBusy(true); setError(undefined)
    try {
      let targetSession: Session | undefined = session
      let targetChat = chats.find((chat) => chat.id === activeChatId)
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
      if (!targetSession || !targetChat) throw new Error(`O bundle pertence ao pedido ${requestId}, mas esse pedido não está pendente em nenhum Harness Chat deste workspace.`)

      const submission = await api.executionBundle(targetSession.id, filename, contentBase64)
      const updated = submission.session
      const policyReason = (submission.policy_reasons || updated.policy?.reasons || []).join('; ')
      const workflowRound = submission.workflow_round || updated.workflow_round || 0
      const autoText = submission.policy_blocked
        ? `Bundle bloqueado pela Policy antes da execução: ${policyReason || 'plano não permitido'}.${submission.repair_prepared ? ' O Wharness preparou automaticamente um novo pedido de correção.' : ''}`
        : submission.workflow_prepared
          ? `Passo local ${workflowRound}/6 concluído na sandbox Protected. Os resultados foram incorporados numa continuação para o mesmo ChatGPT; o Wharness vai submetê-la automaticamente.`
          : submission.workflow_executed
            ? `Passo local ${workflowRound}/6 executado na sandbox Protected. Nenhuma alteração deste passo foi aplicada ao host.`
            : submission.auto_applied
              ? (submission.restart_required ? 'Bundle validado. O plano foi verificado na sandbox, aplicado ao próprio Wharness e reconstruído no host. O reinício aguarda confirmação.' : 'Bundle validado. O plano foi executado na sandbox e aplicado automaticamente ao host.')
              : submission.auto_executed
                ? (submission.auto_error ? `Bundle validado e execução automática iniciada, mas falhou: ${submission.auto_error}` : 'Bundle validado e executado automaticamente na sandbox.')
                : 'Bundle ZIP importado e plano validado.'
      const conversational = updated.last_turn && updated.last_turn.kind !== 'change' && updated.last_turn.kind !== 'workflow'
      const isPlanProposal = Boolean(conversational && targetChat.pendingPlan?.requestId === updated.last_turn?.request_id)
      const bundleItem: ChatItem = {
        id: crypto.randomUUID(), role: 'harness', source: submission.policy_blocked || submission.workflow_executed ? 'wharness' : 'chatgpt', presentation: isPlanProposal ? 'plan' : (submission.policy_blocked || submission.workflow_executed ? 'notice' : 'message'), createdAt: new Date().toISOString(), text: submission.policy_blocked ? autoText : (submission.workflow_executed ? `${autoText}${updated.last_turn?.message ? `\n\n${updated.last_turn.message}` : ''}` : (conversational ? updated.last_turn!.message : (updated.last_turn?.message || updated.plan?.summary || autoText))),
        approval: isPlanProposal && targetChat.pendingPlan ? { status: 'pending', requestId: targetChat.pendingPlan.requestId, originalMessage: targetChat.pendingPlan.originalMessage } : undefined,
        meta: submission.policy_blocked
          ? `Policy bloqueada${submission.repair_prepared ? ' · reparação automática preparada' : ''}`
          : submission.workflow_prepared || submission.workflow_executed
            ? `Workflow ${workflowRound}/6 · sandbox Protected`
            : conversational ? turnMeta(updated.last_turn!.kind) : (submission.auto_applied ? (submission.restart_required ? 'AUTO-EVOLUÇÃO · reinício pendente' : 'AUTO · Host aplicado') : (updated.policy?.allowed ? `Bundle ${filename} · Policy validada` : `Bundle ${filename} · Policy bloqueada`)),
        turnKind: updated.last_turn?.kind,
        iteration: updated.last_turn?.request_id ? iterationRef(updated.last_turn.request_id, 'result', updated.last_execution?.success === false ? ['error', 'result'] : ['result'], targetChat.chatgptUrl) : undefined,
      }
      if (targetChat.id === activeChatId) {
        setSession(updated); setManualPrompt(updated.last_manual_prompt || '')
      }
      appendChatItem(targetChat, updated.project_path, bundleItem)
      if (submission.auto_applied) {
        const change = buildChangeSummary(updated.plan)
        if (change) appendChatItem(targetChat, updated.project_path, { id: crypto.randomUUID(), role: 'harness', source: 'wharness', presentation: 'change', createdAt: change.appliedAt, text: 'Resumo das alterações aplicadas ao host.', change })
      }
      if (submission.auto_error) setError(submission.auto_error)
      if (submission.auto_executed && updated.last_execution) updateWorkspaceChat(targetChat.id, updated.project_path, { artifactSelection: { ...targetChat.artifactSelection, result: true, error: updated.last_execution.success === false } })
      if (submission.auto_applied) markContextDirtyForOtherChats(updated.project_path, targetChat.id)
      if (submission.restart_required) setRestartModalOpen(true)
      let workflowSubmitted = false
      if (submission.workflow_prepared && updated.state === 'workflow_pending' && updated.last_manual_prompt) {
        workflowSubmitted = await submitWorkflowPrompt(updated, targetChat)
      } else if (updated.state === 'repair_pending' && updated.last_manual_prompt) {
        await submitRepairPrompt(updated, targetChat)
      }
      return submission.auto_applied
        ? (submission.restart_required ? `Bundle ${filename} aplicado ao próprio Wharness; build do host concluído e reinício pendente de confirmação.` : `Bundle ${filename} executado e aplicado automaticamente no Harness Chat “${targetChat.title}”.`)
        : submission.workflow_prepared
          ? workflowSubmitted
            ? `Passo ${workflowRound}/6 executado e continuação submetida no Harness Chat “${targetChat.title}”.`
            : `Passo ${workflowRound}/6 executado; a continuação ficou pendente no Harness Chat “${targetChat.title}”.`
          : `Bundle ${filename} importado no Harness Chat “${targetChat.title}”.`
    } catch (e) {
      const message = messageOf(e); setError(message); throw new Error(message)
    } finally { setBusy(false) }
  }

  async function execute(approved: boolean) {
    if (!session) return
    const direct = executionMode === 'unprotected'
    if (direct && !window.confirm('Modo UNPROTECTED: executar este plano diretamente no projeto real? As alterações e comandos não passarão pela sandbox.')) return
    setBusy(true); setError(undefined)
    try {
      const response = await api.execute(session.id, approved || direct)
      setSession(response.session)
      const ok = response.session.last_execution?.success
      const warnings = response.session.last_execution?.warnings || []
      if (response.session.last_execution) {
        const active = chats.find((chat) => chat.id === activeChatId)
        if (active) updateWorkspaceChat(active.id, response.session.project_path, { artifactSelection: { ...active.artifactSelection, result: true, error: !ok } })
      }
      setItems((current) => [...current, {
        id: crypto.randomUUID(), role: 'harness', source: 'wharness', presentation: 'notice', createdAt: new Date().toISOString(),
        text: ok ? (direct ? 'Plano executado diretamente no host em modo Unprotected. Não há etapa Apply.' : (warnings.length ? 'Execução concluída na sandbox. As falhas de verificação já existentes na baseline permaneceram inalteradas; o plano não introduziu novas regressões nesses gates.' : 'Execução e verificações concluídas na sandbox. O host ainda não foi alterado.')) : 'A execução terminou com falha.',
        meta: direct && ok ? 'Host alterado diretamente' : (warnings.length ? `${warnings.length} dívida(s) pré-existente(s)` : undefined),
      }])
    } catch (e) {
      const message = messageOf(e)
      setError(message)
      const payload = e instanceof APIError ? e.data as { session?: Session } | undefined : undefined
      const failedSession = payload?.session
      if (failedSession) {
        setSession(failedSession)
        setManualPrompt(failedSession.last_manual_prompt || '')
        const active = chats.find((chat) => chat.id === activeChatId)
        updateChat({ sessionId: failedSession.id, artifactSelection: { ...active?.artifactSelection, result: Boolean(failedSession.last_execution), error: true } })
      } else {
        void refreshSession()
      }

      const activeChat = chats.find((chat) => chat.id === activeChatId)
      if (failedSession?.state === 'repair_pending' && failedSession.last_manual_prompt && activeChat) {
        await submitRepairPrompt(failedSession, activeChat)
      }
    } finally { setBusy(false) }
  }


  async function transportPlannerContinuation(promptSession: Session, targetChat: WorkspaceChat) {
    const text = promptSession.last_manual_prompt || ''
    if (!text) throw new Error('Continuação do planner vazia.')
    if (!isDesktop()) throw new Error('O loop automático com ChatGPT requer Wharness Desktop.')
    await new Promise<void>((resolve) => window.setTimeout(resolve, 220))
    const bridge = desktopBridge()
    if (!bridge) throw new Error('Desktop bridge indisponível')
    const continuationArtifacts = continuationArtifactSelection(promptSession)
    const prepared = await bridge.chatgpt.preparePrompt({
      cacheKey: targetChat.id, text, url: targetChat.chatgptUrl, sessionId: promptSession.id,
      requestId: promptSession.last_request_id || '', attachments: [], artifacts: await encodeSystemArtifacts(promptSession, continuationArtifacts), autoSubmit: true,
      contextSha256: promptSession.context.manifest.sha256, lastContextSha256: targetChat.lastContextSha256,
      lastContextChatgptUrl: targetChat.lastContextChatgptUrl, includeContext: continuationArtifacts.context, preferCurrentConversation: false,
    })
    const patch: Partial<WorkspaceChat> = {}
    if (prepared.conversationUrl) patch.chatgptUrl = prepared.conversationUrl
    if (prepared.includedContext) {
      patch.lastContextSha256 = promptSession.context.manifest.sha256
      patch.lastContextChatgptUrl = prepared.conversationUrl || targetChat.chatgptUrl
    }
    if (Object.keys(patch).length) updateWorkspaceChat(targetChat.id, promptSession.project_path, patch)
    return prepared
  }

  async function submitWorkflowPrompt(workflowSession: Session, targetChat: WorkspaceChat): Promise<boolean> {
    const round = workflowSession.workflow_round || 1
    appendChatItem(targetChat, workflowSession.project_path, {
      id: crypto.randomUUID(), role: 'harness', source: 'wharness', presentation: 'notice', createdAt: new Date().toISOString(),
      text: `O Wharness terminou o passo local ${round}/6 e vai devolver stdout, stderr e códigos de saída ao mesmo ChatGPT para decidir o próximo passo.`,
      meta: workflowSession.last_request_id ? `Workflow ${round}/6 · ${workflowSession.last_request_id}` : `Workflow ${round}/6`,
      turnKind: 'workflow',
      iteration: workflowSession.last_request_id ? iterationRef(workflowSession.last_request_id, 'workflow', selectedArtifactKinds(continuationArtifactSelection(workflowSession)), targetChat.chatgptUrl) : undefined,
    })
    try {
      const prepared = await transportPlannerContinuation(workflowSession, targetChat)
      appendChatItem(targetChat, workflowSession.project_path, {
        id: crypto.randomUUID(), role: 'harness', source: 'wharness', presentation: 'notice', createdAt: new Date().toISOString(),
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

  async function submitRepairPrompt(failedSession: Session, targetChat: WorkspaceChat) {
    const repairPrompt = failedSession.last_manual_prompt || ''
    if (!repairPrompt) return
    const attempt = failedSession.repair_attempt || 1
    appendChatItem(targetChat, failedSession.project_path, {
      id: crypto.randomUUID(), role: 'harness', source: 'wharness', presentation: 'notice', createdAt: new Date().toISOString(),
      text: `O Wharness criou automaticamente a requisição de correção ${attempt}/3 e vai enviá-la ao mesmo ChatGPT vinculado.`,
      meta: failedSession.last_request_id ? `Repair ${failedSession.last_request_id}` : 'Repair automático',
      iteration: failedSession.last_request_id ? iterationRef(failedSession.last_request_id, 'repair', selectedArtifactKinds(continuationArtifactSelection(failedSession)), targetChat.chatgptUrl) : undefined,
    })
    try {
      const prepared = await transportPlannerContinuation(failedSession, targetChat)
      appendChatItem(targetChat, failedSession.project_path, { id: crypto.randomUUID(), role: 'harness', source: 'wharness', presentation: 'notice', createdAt: new Date().toISOString(), text: prepared.submitted ? 'Requisição de correção enviada automaticamente ao ChatGPT em background. O Wharness vigia agora o download do novo bundle ZIP.' : 'Requisição de correção preparada no ChatGPT; confirme o envio para continuar.', meta: prepared.submitted ? 'ChatGPT acionado automaticamente' : 'Confirmação pendente', iteration: failedSession.last_request_id ? iterationRef(failedSession.last_request_id, prepared.submitted ? 'submitted' : 'prepared', selectedArtifactKinds({ ...continuationArtifactSelection(failedSession), context: prepared.includedContext }), prepared.conversationUrl || targetChat.chatgptUrl) : undefined })
    } catch (sendError) {
      appendChatItem(targetChat, failedSession.project_path, { id: crypto.randomUUID(), role: 'harness', source: 'wharness', presentation: 'notice', createdAt: new Date().toISOString(), text: `A requisição de correção foi preparada, mas o envio automático ao ChatGPT falhou: ${messageOf(sendError)}`, meta: 'Abra a aba ChatGPT para retomar', iteration: failedSession.last_request_id ? iterationRef(failedSession.last_request_id, 'failed', selectedArtifactKinds(continuationArtifactSelection(failedSession)), targetChat.chatgptUrl) : undefined })
    }
  }

  async function apply() {
    if (!session || !window.confirm('Aplicar os patches verificados no projeto real?')) return
    setBusy(true); setError(undefined)
    try {
      const updated = await api.apply(session.id)
      setSession(updated)
      markContextDirtyForOtherChats(updated.project_path, activeChatId)
      if (updated.self_evolution && updated.state === 'restart_pending') setRestartModalOpen(true)
      const change = buildChangeSummary(updated.plan)
      setItems((current) => [...current,
        { id: crypto.randomUUID(), role: 'harness', source: 'wharness', presentation: 'notice', createdAt: new Date().toISOString(), text: updated.self_evolution ? 'Auto-evolução aplicada: a sandbox passou e o host foi reconstruído. O novo runtime só será ativado quando confirmar o reinício.' : 'Patch aplicado ao projeto real após a verificação da sandbox.', meta: updated.self_evolution ? 'AUTO-EVOLUÇÃO · reinício pendente' : 'Host alterado' },
        ...(change ? [{ id: crypto.randomUUID(), role: 'harness' as const, source: 'wharness' as const, presentation: 'change' as const, createdAt: change.appliedAt, text: 'Resumo das alterações aplicadas ao host.', change }] : []),
      ])
    } catch (e) { setError(messageOf(e)) } finally { setBusy(false) }
  }

  function openFileFromChat(path: string) {
    setEditorOpenPath(path)
    setEditorOpenNonce((value) => value + 1)
    setMode('editor')
  }

  async function revertChange(item: ChatItem) {
    if (!session || !item.change || item.change.reverted || busy) return
    if (!session.plan || session.plan.plan_id !== item.change.planId) {
      setError('Este resumo pertence a um plano anterior. A reversão segura só está disponível para o último plano aplicado desta sessão.')
      return
    }
    if (!window.confirm(`Reverter as alterações do plano ${item.change.planId} no projeto real?`)) return
    setBusy(true); setError(undefined)
    try {
      const updated = await api.revert(session.id)
      setSession(updated)
      setItems((current) => current.map((candidate) => candidate.change?.planId === item.change?.planId ? { ...candidate, change: { ...candidate.change!, reverted: true } } : candidate))
      markContextDirtyForOtherChats(updated.project_path, activeChatId)
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
      if (!window.confirm(warning)) return
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
    if (next === 'auto' && !window.confirm('Ativar AUTO para este projeto? Somente pedidos classificados como mudança, com plano válido, serão executados na sandbox Protected e aplicados após verificação. Perguntas e análises nunca serão executadas. No ChatGPT web, ainda é necessário iniciar o download do resultado; com provider API não há download.')) return
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

  async function confirmSelfRestart() {
    if (!session || !session.self_evolution || session.state !== 'restart_pending' || busy) return
    setBusy(true); setError(undefined)
    try {
      const updated = await api.restartSelfEvolution(session.id)
      setSession(updated); setRestartModalOpen(false)
      setItems((current) => [...current, { id: crypto.randomUUID(), role: 'harness', source: 'wharness', presentation: 'notice', createdAt: new Date().toISOString(), text: 'Reinício confirmado. O supervisor transacional vai reiniciar o Wharness e validar o novo runtime; se falhar, restaura automaticamente a versão anterior.', meta: 'AUTO-EVOLUÇÃO · reinício confirmado' }])
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
      const result = await bridge.chatgpt.queueComment({ cacheKey: active.id, text: message, url: active.chatgptUrl, requestId, commentId: crypto.randomUUID(), attachments: encoded })
      const item: ChatItem = { id: crypto.randomUUID(), role: 'user', source: 'user', text: message, createdAt: new Date().toISOString(), meta: `${result.queued ? 'Comentário em fila' : 'Comentário enviado'} para a tarefa ativa${attachments.length ? ` · ${attachments.length} anexo(s)` : ''}`, iteration: iterationRef(requestId, 'submitted', ['prompt'], active.chatgptUrl) }
      appendChatItem(active, session.project_path, item)
    } catch (error) {
      setError(messageOf(error))
      throw error
    }
  }

  function handleChatGPTActivity(activity: ChatGPTActivity) {
    const active = chats.find((chat) => chat.id === activeChatId)
    if (!active || (activity.cacheKey && activity.cacheKey !== active.id)) return
    const requestId = session?.last_request_id || ''
    const thoughtId = `chatgpt-thought:${requestId || active.id}`
    setItems((current) => {
      const without = current.filter((item) => item.id !== thoughtId)
      if (activity.state !== 'thinking' && !activity.text) return without
      const text = activity.text || 'ChatGPT está a processar a tarefa…'
      return [...without, { id: thoughtId, role: 'harness', source: 'chatgpt', presentation: 'thought', text, createdAt: activity.capturedAt, meta: 'Conteúdo/estado visível na interface do ChatGPT' }]
    })
  }

  async function approvePlanProposal(item: ChatItem) {
    if (!item.approval || item.approval.status !== 'pending') return
    const active = chats.find((chat) => chat.id === activeChatId)
    if (!active) return
    setItems((current) => current.map((entry) => entry.id === item.id && entry.approval ? { ...entry, approval: { ...entry.approval, status: 'approved' } } : entry))
    updateChat({ pendingPlan: undefined, requestMode: 'direct' })
    await send(`Plano aprovado. Implemente agora o plano proposto para o pedido original: ${item.approval.originalMessage}

Mantenha o escopo aprovado, execute as verificações adequadas e devolva o bundle canónico de implementação.`, [], { context: true, prompt: true, result: false, error: false }, 'direct')
  }

  function rejectPlanProposal(item: ChatItem) {
    setItems((current) => current.map((entry) => entry.id === item.id && entry.approval ? { ...entry, approval: { ...entry.approval, status: 'rejected' } } : entry))
    updateChat({ pendingPlan: undefined, requestMode: 'direct' })
  }

  function changeRequestMode(mode: ChatRequestMode) { updateChat({ requestMode: mode }) }

  async function refreshSession() {
    if (!session) return
    try { setSession(await api.getSession(session.id)) } catch { /* retain last known state */ }
  }

  if (!session) return <Bootstrap config={config} busy={busy} error={error} recent={recent} restoring={restoring} onStart={start} onCreate={createProject} onClone={cloneProject} />
  const activeChat = chats.find((chat) => chat.id === activeChatId)
  const contextArtifactRequired = Boolean(activeChat && (!activeChat.lastContextSha256 || activeChat.lastContextSha256 !== session.context.manifest.sha256 || activeChat.artifactSelection?.context || (activeChat.chatgptUrl && activeChat.lastContextChatgptUrl && !sameChatGPTConversation(activeChat.chatgptUrl, activeChat.lastContextChatgptUrl))))
  const errorArtifactRequired = session.state === 'repair_pending' || session.last_execution?.success === false
  const composerArtifacts: ChatArtifactSelection = {
    context: contextArtifactRequired,
    prompt: true,
    result: Boolean(activeChat?.artifactSelection?.result),
    error: errorArtifactRequired || Boolean(activeChat?.artifactSelection?.error),
  }
  const taskInFlight = requestChainActive(session)
  const restartPending = Boolean(session.self_evolution && session.state === 'restart_pending')
  return <main className="workspace-root">
    <WorkspaceTopbar config={config} session={session} mode={mode} executionMode={executionMode} automationMode={automationMode} restartPending={restartPending} busy={busy} onMode={setMode} onExecutionMode={changeExecutionMode} onAutomationMode={changeAutomationMode} onRestartPending={() => setRestartModalOpen(true)} onSettings={() => setProjectSettingsOpen(true)} onClose={closeWorkspace} />
    {projectSettingsOpen && <ProjectSettings session={session} onClose={() => setProjectSettingsOpen(false)} onSession={setSession} onError={setError} />}
    {restartModalOpen && restartPending && <RestartConfirmation busy={busy} onLater={() => setRestartModalOpen(false)} onRestart={() => void confirmSelfRestart()} />}
    {error && <div className="toast-error" data-chatgpt-overlay-blocker="true" role="alert">{error}<button onClick={() => setError(undefined)}>×</button></div>}
    <div className={`workspace-mode-surface ${mode === 'editor' ? 'active' : ''}`} aria-hidden={mode !== 'editor'}>
      <EditorWorkspace session={session} onError={setError} openPath={editorOpenPath} openNonce={editorOpenNonce} />
    </div>
    <div className={`workspace-mode-surface ${mode === 'agent' ? 'active' : ''}`} aria-hidden={mode !== 'agent'}>
      <div className="agent-workspace">
        <ChatPanel key={activeChatId} session={session} items={items} chats={chats} archivedChats={archivedChats} activeChatId={activeChatId} busy={busy} attachmentsEnabled={isDesktop() && config?.planner === 'manual'} preparedAttachmentCount={preparedDrafts[activeChatId]} artifactSelection={composerArtifacts} artifactRequired={{ context: contextArtifactRequired, error: errorArtifactRequired }} artifactContent={{ context: contextArtifact(session), prompt: manualPrompt || session.last_manual_prompt || '', result: executionArtifact(session), error: errorArtifact(session) }} requestMode={activeChat?.requestMode || 'direct'} taskInFlight={taskInFlight} queuedRequests={queuedRequestsByChat[activeChatId] || []} onToggleArtifact={toggleComposerArtifact} onRequestMode={changeRequestMode} onSend={enqueueMainRequest} onComment={commentOnActiveTask} onQueueEdit={updateQueuedRequest} onQueueMove={moveQueuedRequest} onQueueRemove={removeQueuedRequest} onQueueMerge={mergeQueuedRequest} onQueuePromote={promoteQueuedRequest} onApprovePlan={approvePlanProposal} onRejectPlan={rejectPlanProposal} onConfirmPrepared={confirmPreparedDraft} onDismissPrepared={dismissPreparedDraft} onOpenFile={openFileFromChat} onRevertChange={revertChange} onNewChat={newChat} onSelectChat={selectChat} onArchiveChat={archiveChat} onRestoreChat={restoreArchivedChat} onDeleteArchivedChat={deleteArchivedChat} />
        <Inspector config={config} session={session} events={events} manualPrompt={manualPrompt} busy={busy} chat={activeChat} chatgptSuspended={mode !== 'agent' || projectSettingsOpen || restartModalOpen} onChatGPTURL={bindChatGPTURL} onChatGPTActivity={handleChatGPTActivity} onContextSent={markContextSent} onExecute={execute} onApply={apply} onManualPlan={submitManualPlan} onPlanFile={submitPlanFile} onBundleFile={submitBundleFile} onSession={setSession} />
      </div>
    </div>
  </main>
}

function RestartConfirmation({ busy, onLater, onRestart }: { busy: boolean; onLater: () => void; onRestart: () => void }) {
  return <div className="restart-confirmation-backdrop" role="presentation">
    <section className="restart-confirmation-dialog" role="dialog" aria-modal="true" aria-labelledby="restart-confirmation-title">
      <div className="restart-confirmation-icon"><Icon name="refresh" size={24}/></div>
      <div><span className="panel-kicker">Auto-evolução concluída</span><h2 id="restart-confirmation-title">Ativar a nova versão do Wharness?</h2><p>As alterações já foram verificadas, aplicadas e compiladas. O reinício ativa o novo runtime; o supervisor transacional mantém rollback automático se a nova versão não ficar saudável.</p></div>
      <div className="restart-confirmation-actions"><button className="secondary-button" disabled={busy} onClick={onLater}>Mais tarde</button><button className="apply-button" disabled={busy} onClick={onRestart}><Icon name="refresh" size={14}/> Reiniciar agora</button></div>
    </section>
  </div>
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
  if (session.pending_manual_request_ids?.length) return true
  return new Set(['awaiting_plan', 'workflow_pending', 'workflow_planned', 'workflow_observed', 'repair_pending', 'planned', 'verified', 'restart_pending', 'restart_scheduled']).has(session.state)
}

function executionArtifact(session: Session) {
  const execution = session.last_execution
  if (!execution) return '# Wharness execution result\n\nNo execution result is available.\n'
  const commands = execution.commands.slice(-30).map((command, index) => {
    const stdout = boundedArtifactText(command.stdout)
    const stderr = boundedArtifactText(command.stderr)
    return [`## Command ${index + 1}`, `- argv: ${JSON.stringify(command.argv)}`, `- cwd: ${command.cwd}`, `- exit: ${command.exit_code}`, `- success: ${command.success}`, stdout ? `### stdout\n\n\`\`\`text\n${stdout}\n\`\`\`` : '', stderr ? `### stderr\n\n\`\`\`text\n${stderr}\n\`\`\`` : ''].filter(Boolean).join('\n')
  }).join('\n\n')
  return `# Wharness execution result\n\n- plan: ${execution.plan_id}\n- success: ${execution.success}\n- started: ${execution.started_at}\n- completed: ${execution.completed_at}\n${execution.error ? `- error: ${boundedArtifactText(execution.error)}` : ''}\n\n${commands}\n`
}

function errorArtifact(session: Session) {
  const execution = session.last_execution
  const failed = execution?.commands.filter((command) => !command.success).slice(-12) || []
  const commandText = failed.map((command) => `## Failed command\n\n- argv: ${JSON.stringify(command.argv)}\n- exit: ${command.exit_code}\n\n### stderr\n\n\`\`\`text\n${boundedArtifactText(command.stderr || command.stdout)}\n\`\`\``).join('\n\n')
  return `# Wharness failure evidence\n\n- state: ${session.state}\n- plan: ${execution?.plan_id || session.repair_parent_plan_id || 'unknown'}\n- request: ${session.last_request_id || 'unknown'}\n${session.last_repair_error ? `- repair error: ${boundedArtifactText(session.last_repair_error)}` : ''}\n${execution?.error ? `- execution error: ${boundedArtifactText(execution.error)}` : ''}\n\n${commandText}\n`
}

function boundedArtifactText(value: string, limit = 12000) {
  const text = String(value || '').trim()
  return text.length > limit ? `${text.slice(0, limit)}\n...[truncated by Wharness]` : text
}

function sessionHasPendingRequest(session: Session, requestId: string) {
  return Boolean(session.pending_manual_request_ids?.includes(requestId) || session.last_request_id === requestId)
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

function messageOf(error: unknown) {
  if (error instanceof APIError || error instanceof Error) return error.message
  return 'Erro inesperado'
}
