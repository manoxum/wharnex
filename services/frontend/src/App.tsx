import { useCallback, useEffect, useRef, useState } from 'react'
import { api, APIError } from './lib/api'
import type { AppConfig, AutomationMode, ChatItem, ExecutionMode, HarnessEvent, Session, WorkspaceMode } from './types'
import { Bootstrap } from './components/Bootstrap'
import { ChatPanel } from './components/ChatPanel'
import { Inspector } from './components/Inspector'
import { EditorWorkspace } from './components/EditorWorkspace'
import { WorkspaceTopbar } from './components/WorkspaceTopbar'
import { ProjectSettings } from './components/ProjectSettings'
import {
  clearActiveWorkspace, deriveChatTitle, loadActiveWorkspace, loadChat, loadLegacyChat,
  loadRecentWorkspaces, loadWorkspaceChats, newWorkspaceChat, rememberRecent, saveActiveWorkspace,
  removeChat as removeStoredChat, saveAutomationMode, saveChat, saveExecutionMode, saveWorkspaceChats, type WorkspaceChat,
} from './lib/workspaceMemory'
import { desktopBridge, isDesktop } from './lib/desktop'
import { attachmentPromptSuffix, encodeChatAttachments } from './lib/chatAttachments'

export default function App() {
  const activeAtLoad = loadActiveWorkspace()
  const [config, setConfig] = useState<AppConfig>()
  const [session, setSession] = useState<Session>()
  const [chats, setChats] = useState<WorkspaceChat[]>([])
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
  const [projectSettingsOpen, setProjectSettingsOpen] = useState(false)
  const sourceRef = useRef<EventSource | null>(null)

  const connectEvents = useCallback((id: string) => {
    sourceRef.current?.close()
    const source = new EventSource(api.eventsURL(id))
    source.onmessage = (event) => {
      try {
        const parsed = JSON.parse(event.data) as HarnessEvent
        setEvents((current) => current.some((item) => item.id === parsed.id) ? current : [...current, parsed].slice(-500))
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
        setChats(nextChats); setActiveChatId(nextChat.id); setSession(restored)
        setMode('agent'); setExecutionMode(projectExecutionMode); setAutomationMode(projectAutomationMode); setManualPrompt(restored.last_manual_prompt || '')
        const chatItems = loadChat(restored.project_path, nextChat.id)
        setItems(chatItems.length ? chatItems : [welcomeItem(restored)])
        connectEvents(restored.id)
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
      setSession(selectedSession); setActiveChatId(selected.id)
      const chatItems = loadChat(created.project_path, selected.id)
      setItems(chatItems.length ? chatItems : [welcomeItem(selectedSession)])
      setManualPrompt(selectedSession.last_manual_prompt || ''); setEvents([]); setMode('agent'); setExecutionMode(projectExecutionMode); setAutomationMode(projectAutomationMode)
      connectEvents(selectedSession.id)
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
    clearActiveWorkspace(); setSession(undefined); setChats([]); setActiveChatId(''); setProjectSettingsOpen(false)
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
      setEvents([]); setManualPrompt(''); connectEvents(created.id)
    } catch (e) { setError(messageOf(e)) } finally { setBusy(false) }
  }

  async function deleteChat(chatId: string) {
    if (!session || busy) return
    const target = chats.find((chat) => chat.id === chatId)
    if (!target) return
    if (!window.confirm(`Remover o Harness Chat "${target.title}"?\n\nA conversa correspondente na tua conta ChatGPT NÃO será apagada; apenas o vínculo local será removido.`)) return

    setBusy(true); setError(undefined)
    try {
      try { await api.deleteSession(target.sessionId) }
      catch (error) { if (!(error instanceof APIError) || error.status !== 404) throw error }
      if (isDesktop()) {
        try { await desktopBridge()?.attachments.removeChat({ cacheKey: chatId }) } catch { /* transcript removal must not be blocked by orphan cleanup */ }
      }

      const projectPath = session.project_path
      const remaining = removeStoredChat(projectPath, chatId)
      setPreparedDrafts((current) => { const next = { ...current }; delete next[chatId]; return next })
      if (chatId !== activeChatId) {
        persistChats(projectPath, remaining)
        return
      }

      sourceRef.current?.close(); sourceRef.current = null
      let nextChats = remaining
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
      connectEvents(restored.id)
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
      connectEvents(restored.id)
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
    if (!session || !activeChatId) return
    setChats((current) => {
      const next = current.map((chat) => chat.id === activeChatId ? {
        ...chat, chatgptUrl: url,
        lastContextChatgptUrl: chat.lastContextSha256 && !chat.lastContextChatgptUrl ? url : chat.lastContextChatgptUrl,
        updatedAt: new Date().toISOString(),
      } : chat)
      saveWorkspaceChats(session.project_path, next)
      return next
    })
  }

  function markContextSent(sha256: string, conversationUrl?: string) {
    updateChat({ lastContextSha256: sha256, lastContextChatgptUrl: conversationUrl || chats.find((chat) => chat.id === activeChatId)?.chatgptUrl })
  }

  async function send(message: string, attachments: File[]) {
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

    const userItem: ChatItem = { id: messageId, role: 'user', text: message, createdAt: new Date().toISOString(), attachments: persistedAttachments }
    setItems((current) => [...current, userItem])
    if (activeChat.title === 'Novo chat' || activeChat.title === 'Chat principal') updateChat({ title: deriveChatTitle(message) })
    try {
      const response = await api.message(session.id, message + attachmentPromptSuffix(attachments))
      setSession(response.session); updateChat({ sessionId: response.session.id })
      const prompt = response.manual_prompt || response.session.last_manual_prompt || ''
      const turn = response.session.last_turn || response.turn
      setManualPrompt(prompt)
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
            requestId: response.session.last_request_id || '', attachments: encoded, autoSubmit: automationMode === 'auto',
            contextSha256: response.session.context.manifest.sha256, lastContextSha256: activeChat.lastContextSha256,
            lastContextChatgptUrl: activeChat.lastContextChatgptUrl, preferCurrentConversation: true,
          })
          draftCount = prepared.attachmentCount
          autoSubmitted = prepared.submitted
          const chatPatch: Partial<WorkspaceChat> = {}
          if (prepared.conversationUrl) chatPatch.chatgptUrl = prepared.conversationUrl
          if (prepared.includedContext) {
            chatPatch.lastContextSha256 = response.session.context.manifest.sha256
            chatPatch.lastContextChatgptUrl = prepared.conversationUrl || activeChat.chatgptUrl
          }
          if (Object.keys(chatPatch).length) updateChat(chatPatch)
          if (!prepared.submitted) setPreparedDrafts((current) => ({ ...current, [activeChat.id]: prepared.attachmentCount }))
        } catch (prepareError) {
          transportFailure = messageOf(prepareError)
        }
      }
      setItems((current) => [...current, {
        id: crypto.randomUUID(), role: 'harness', createdAt: new Date().toISOString(),
        text: turn && turn.kind !== 'change'
          ? turn.message
          : response.session.plan
            ? (turn?.message || response.session.plan.summary)
          : transportFailure
            ? `O prompt foi preparado, mas não foi possível montar o rascunho no ChatGPT: ${transportFailure}`
            : autoSubmitted
              ? 'Prompt e anexos submetidos automaticamente ao ChatGPT em modo Auto. O Wharness aguarda agora o download validado do bundle.'
            : draftCount
              ? 'A preparação foi enviada ao composer do ChatGPT. Verifique visualmente se o prompt e os anexos aparecem antes de confirmar o envio.'
              : 'Prompt do planner preparado. No ChatGPT, gere o bundle ZIP solicitado e clique em Download; o Desktop irá importá-lo automaticamente.',
        meta: turn && turn.kind !== 'change' ? turnMeta(turn.kind) : (response.session.state === 'applied' ? 'AUTO · Host aplicado' : (response.session.plan ? `Plano ${response.session.plan.plan_id}` : (autoSubmitted ? `${draftCount} anexo(s) transportados · aguardando resultado ZIP` : (draftCount ? `${draftCount} anexo(s) preparados · aguardando confirmação` : 'Aguardando resultado externo')))),
        turnKind: turn?.kind,
      }])
    } catch (e) {
      const msg = messageOf(e); setError(msg)
      setItems((current) => [...current, { id: crypto.randomUUID(), role: 'harness', createdAt: new Date().toISOString(), text: `Falha no planeamento: ${msg}` }])
    } finally { setBusy(false) }
  }

  async function confirmPreparedDraft() {
    if (!activeChatId || busy) return
    setBusy(true); setError(undefined)
    try {
      const bridge = desktopBridge()
      if (!bridge) throw new Error('Desktop bridge indisponível')
      await bridge.chatgpt.submitPrepared({ cacheKey: activeChatId })
      setPreparedDrafts((current) => { const next = { ...current }; delete next[activeChatId]; return next })
      setItems((current) => [...current, { id: crypto.randomUUID(), role: 'harness', createdAt: new Date().toISOString(), text: 'Prompt e anexos enviados ao ChatGPT após confirmação.', meta: 'Aguardando bundle do ChatGPT' }])
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
      setSession(updated); setItems((current) => [...current, { id: crypto.randomUUID(), role: 'harness', createdAt: new Date().toISOString(), text: updated.plan?.summary || 'Plano manual validado.', meta: updated.policy?.allowed ? 'Policy validada' : 'Policy bloqueou o plano' }])
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
        id: crypto.randomUUID(), role: 'harness', createdAt: new Date().toISOString(),
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
              ? 'Bundle validado. O plano foi executado na sandbox e aplicado automaticamente ao host.'
              : submission.auto_executed
                ? (submission.auto_error ? `Bundle validado e execução automática iniciada, mas falhou: ${submission.auto_error}` : 'Bundle validado e executado automaticamente na sandbox.')
                : 'Bundle ZIP importado e plano validado.'
      const conversational = updated.last_turn && updated.last_turn.kind !== 'change' && updated.last_turn.kind !== 'workflow'
      const bundleItem: ChatItem = {
        id: crypto.randomUUID(), role: 'harness', createdAt: new Date().toISOString(), text: submission.policy_blocked ? autoText : (submission.workflow_executed ? autoText : (conversational ? updated.last_turn!.message : (updated.last_turn?.message || updated.plan?.summary || autoText))),
        meta: submission.policy_blocked
          ? `Policy bloqueada${submission.repair_prepared ? ' · reparação automática preparada' : ''}`
          : submission.workflow_prepared || submission.workflow_executed
            ? `Workflow ${workflowRound}/6 · sandbox Protected`
            : conversational ? turnMeta(updated.last_turn!.kind) : (submission.auto_applied ? 'AUTO · Host aplicado' : (updated.policy?.allowed ? `Bundle ${filename} · Policy validada` : `Bundle ${filename} · Policy bloqueada`)),
        turnKind: updated.last_turn?.kind,
      }
      if (targetChat.id === activeChatId) {
        setSession(updated); setManualPrompt(updated.last_manual_prompt || '')
      }
      appendChatItem(targetChat, updated.project_path, bundleItem)
      if (submission.auto_error) setError(submission.auto_error)
      let workflowSubmitted = false
      if (submission.workflow_prepared && updated.state === 'workflow_pending' && updated.last_manual_prompt) {
        workflowSubmitted = await submitWorkflowPrompt(updated, targetChat)
      } else if (updated.state === 'repair_pending' && updated.last_manual_prompt) {
        await submitRepairPrompt(updated, targetChat)
      }
      return submission.auto_applied
        ? `Bundle ${filename} executado e aplicado automaticamente no Harness Chat “${targetChat.title}”.`
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
      setItems((current) => [...current, {
        id: crypto.randomUUID(), role: 'harness', createdAt: new Date().toISOString(),
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
        updateChat({ sessionId: failedSession.id })
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
    const prepared = await bridge.chatgpt.preparePrompt({
      cacheKey: targetChat.id, text, url: targetChat.chatgptUrl, sessionId: promptSession.id,
      requestId: promptSession.last_request_id || '', attachments: [], autoSubmit: true,
      contextSha256: promptSession.context.manifest.sha256, lastContextSha256: targetChat.lastContextSha256,
      lastContextChatgptUrl: targetChat.lastContextChatgptUrl, preferCurrentConversation: false,
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
      id: crypto.randomUUID(), role: 'harness', createdAt: new Date().toISOString(),
      text: `O Wharness terminou o passo local ${round}/6 e vai devolver stdout, stderr e códigos de saída ao mesmo ChatGPT para decidir o próximo passo.`,
      meta: workflowSession.last_request_id ? `Workflow ${round}/6 · ${workflowSession.last_request_id}` : `Workflow ${round}/6`,
      turnKind: 'workflow',
    })
    try {
      const prepared = await transportPlannerContinuation(workflowSession, targetChat)
      appendChatItem(targetChat, workflowSession.project_path, {
        id: crypto.randomUUID(), role: 'harness', createdAt: new Date().toISOString(),
        text: prepared.submitted
          ? 'Resultados locais submetidos automaticamente ao ChatGPT. O Wharness aguarda a próxima decisão ou o encerramento do fluxo.'
          : 'A continuação foi preparada no ChatGPT, mas ainda precisa de confirmação manual.',
        meta: prepared.submitted ? `Workflow ${round}/6 · ChatGPT acionado` : `Workflow ${round}/6 · confirmação pendente`,
        turnKind: 'workflow',
      })
      return prepared.submitted
    } catch (sendError) {
      appendChatItem(targetChat, workflowSession.project_path, {
        id: crypto.randomUUID(), role: 'harness', createdAt: new Date().toISOString(),
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
      id: crypto.randomUUID(), role: 'harness', createdAt: new Date().toISOString(),
      text: `O Wharness criou automaticamente a requisição de correção ${attempt}/3 e vai enviá-la ao mesmo ChatGPT vinculado.`,
      meta: failedSession.last_request_id ? `Repair ${failedSession.last_request_id}` : 'Repair automático',
    })
    try {
      const prepared = await transportPlannerContinuation(failedSession, targetChat)
      appendChatItem(targetChat, failedSession.project_path, { id: crypto.randomUUID(), role: 'harness', createdAt: new Date().toISOString(), text: prepared.submitted ? 'Requisição de correção enviada automaticamente ao ChatGPT em background. O Wharness vigia agora o download do novo bundle ZIP.' : 'Requisição de correção preparada no ChatGPT; confirme o envio para continuar.', meta: prepared.submitted ? 'ChatGPT acionado automaticamente' : 'Confirmação pendente' })
    } catch (sendError) {
      appendChatItem(targetChat, failedSession.project_path, { id: crypto.randomUUID(), role: 'harness', createdAt: new Date().toISOString(), text: `A requisição de correção foi preparada, mas o envio automático ao ChatGPT falhou: ${messageOf(sendError)}`, meta: 'Abra a aba ChatGPT e envie o prompt preparado' })
    }
  }

  async function apply() {
    if (!session || !window.confirm('Aplicar os patches verificados no projeto real?')) return
    setBusy(true); setError(undefined)
    try {
      const updated = await api.apply(session.id)
      setSession(updated); setItems((current) => [...current, { id: crypto.randomUUID(), role: 'harness', createdAt: new Date().toISOString(), text: 'Patch aplicado ao projeto real após a verificação da sandbox.', meta: 'Host alterado' }])
    } catch (e) { setError(messageOf(e)) } finally { setBusy(false) }
  }

  async function changeExecutionMode(next: ExecutionMode) {
    if (!session || next === executionMode || busy) return
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
      setItems((current) => [...current, { id: crypto.randomUUID(), role: 'harness', createdAt: new Date().toISOString(), text: next === 'unprotected' ? 'Modo Unprotected ativado. Auto foi desativado; execuções diretas continuam a exigir confirmação.' : 'Modo Protected ativado.', meta: next === 'unprotected' ? 'Host direto' : 'Sandbox ativa' }])
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
      setItems((current) => [...current, { id: crypto.randomUUID(), role: 'harness', createdAt: new Date().toISOString(), text: next === 'auto' ? 'Modo Auto ativado. Respostas e análises continuam sem execução. Somente mudanças com plano válido seguem pela sandbox e são aplicadas após verificação; no ChatGPT web o download do resultado ainda precisa ser iniciado na superfície remota.' : 'Modo Manual ativado. Executar e aplicar mudanças voltam a exigir ação do utilizador.', meta: next === 'auto' ? 'AUTO · Protected' : 'Manual' }])
    } catch (e) { setError(messageOf(e)) } finally { setBusy(false) }
  }

  async function refreshSession() {
    if (!session) return
    try { setSession(await api.getSession(session.id)) } catch { /* retain last known state */ }
  }

  if (!session) return <Bootstrap config={config} busy={busy} error={error} recent={recent} restoring={restoring} onStart={start} onCreate={createProject} onClone={cloneProject} />
  const activeChat = chats.find((chat) => chat.id === activeChatId)
  return <main className="workspace-root">
    <WorkspaceTopbar config={config} session={session} mode={mode} executionMode={executionMode} automationMode={automationMode} busy={busy} onMode={setMode} onExecutionMode={changeExecutionMode} onAutomationMode={changeAutomationMode} onSettings={() => setProjectSettingsOpen(true)} onClose={closeWorkspace} />
    {projectSettingsOpen && <ProjectSettings session={session} onClose={() => setProjectSettingsOpen(false)} onSession={setSession} onError={setError} />}
    {error && <div className="toast-error" role="alert">{error}<button onClick={() => setError(undefined)}>×</button></div>}
    {mode === 'editor'
      ? <EditorWorkspace session={session} onError={setError} />
      : <div className="agent-workspace">
          <ChatPanel session={session} items={items} chats={chats} activeChatId={activeChatId} busy={busy} attachmentsEnabled={isDesktop() && config?.planner === 'manual'} preparedAttachmentCount={preparedDrafts[activeChatId]} onSend={send} onConfirmPrepared={confirmPreparedDraft} onDismissPrepared={dismissPreparedDraft} onNewChat={newChat} onSelectChat={selectChat} onDeleteChat={deleteChat} />
          <Inspector config={config} session={session} events={events} manualPrompt={manualPrompt} busy={busy} chat={activeChat} chatgptSuspended={projectSettingsOpen} onChatGPTURL={bindChatGPTURL} onContextSent={markContextSent} onExecute={execute} onApply={apply} onManualPlan={submitManualPlan} onPlanFile={submitPlanFile} onBundleFile={submitBundleFile} onSession={setSession} />
        </div>}
  </main>
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
  return { id: 'welcome', role: 'harness', text: 'Contexto preparado. Pode perguntar, pedir uma análise, explorar uma ideia, diagnosticar o projecto ou solicitar uma alteração.', createdAt: new Date().toISOString(), meta: `${session.context.manifest.files.length} ficheiros elegíveis no snapshot` }
}

function messageOf(error: unknown) {
  if (error instanceof APIError || error instanceof Error) return error.message
  return 'Erro inesperado'
}
