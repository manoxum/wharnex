import { useCallback, useEffect, useRef, useState } from 'react'
import { api, APIError } from './lib/api'
import type { AppConfig, ChatItem, ExecutionMode, HarnessEvent, Session, WorkspaceMode } from './types'
import { Bootstrap } from './components/Bootstrap'
import { ChatPanel } from './components/ChatPanel'
import { Inspector } from './components/Inspector'
import { EditorWorkspace } from './components/EditorWorkspace'
import { WorkspaceTopbar } from './components/WorkspaceTopbar'
import {
  clearActiveWorkspace, deriveChatTitle, loadActiveWorkspace, loadChat, loadExecutionMode, loadLegacyChat,
  loadRecentWorkspaces, loadWorkspaceChats, newWorkspaceChat, rememberRecent, saveActiveWorkspace,
  saveChat, saveExecutionMode, saveWorkspaceChats, type WorkspaceChat,
} from './lib/workspaceMemory'

export default function App() {
  const activeAtLoad = loadActiveWorkspace()
  const [config, setConfig] = useState<AppConfig>()
  const [session, setSession] = useState<Session>()
  const [chats, setChats] = useState<WorkspaceChat[]>([])
  const [activeChatId, setActiveChatId] = useState(activeAtLoad?.chatId || '')
  const [items, setItems] = useState<ChatItem[]>([])
  const [events, setEvents] = useState<HarnessEvent[]>([])
  const [manualPrompt, setManualPrompt] = useState('')
  const [mode, setMode] = useState<WorkspaceMode>(activeAtLoad?.mode || 'editor')
  const [executionMode, setExecutionMode] = useState<ExecutionMode>(activeAtLoad?.executionMode || (activeAtLoad ? loadExecutionMode(activeAtLoad.projectPath) : 'protected'))
  const [recent, setRecent] = useState<string[]>(loadRecentWorkspaces())
  const [restoring, setRestoring] = useState(Boolean(activeAtLoad))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
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
        const projectExecutionMode = active.executionMode || loadExecutionMode(active.projectPath)
        let restored: Session
        try {
          restored = await api.getSession(selected?.sessionId || active.sessionId)
          if (restored.execution_mode !== projectExecutionMode) restored = await api.setExecutionMode(restored.id, projectExecutionMode)
        } catch (error) {
          if (!(error instanceof APIError) || error.status !== 404) throw error
          restored = await api.createSession(active.projectPath, projectExecutionMode)
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
        setMode(active.mode || 'editor'); setExecutionMode(projectExecutionMode); setManualPrompt(restored.last_manual_prompt || '')
        const chatItems = loadChat(restored.project_path, nextChat.id)
        setItems(chatItems.length ? chatItems : [welcomeItem(restored)])
        connectEvents(restored.id)
        saveActiveWorkspace({ sessionId: restored.id, projectPath: restored.project_path, mode: active.mode || 'editor', chatId: nextChat.id, executionMode: projectExecutionMode })
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
    saveActiveWorkspace({ sessionId: session.id, projectPath: session.project_path, mode, chatId: activeChatId || undefined, executionMode })
    setRecent(loadRecentWorkspaces())
  }, [session, mode, activeChatId, executionMode])

  useEffect(() => {
    if (session && activeChatId && items.length) saveChat(session.project_path, activeChatId, items)
  }, [session, activeChatId, items])

  async function start(projectPath: string) {
    setBusy(true); setError(undefined)
    try {
      const projectExecutionMode = loadExecutionMode(projectPath)
      const created = await api.createSession(projectPath, projectExecutionMode)
      rememberRecent(created.project_path); setRecent(loadRecentWorkspaces())
      let nextChats = loadWorkspaceChats(created.project_path)
      let selected = nextChats[0]
      let selectedSession = created
      if (selected) {
        try {
          selectedSession = await api.getSession(selected.sessionId)
          if (selectedSession.execution_mode !== projectExecutionMode) selectedSession = await api.setExecutionMode(selectedSession.id, projectExecutionMode)
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
      setManualPrompt(selectedSession.last_manual_prompt || ''); setEvents([]); setMode('editor'); setExecutionMode(projectExecutionMode)
      connectEvents(selectedSession.id)
    } catch (e) { setError(messageOf(e)) } finally { setBusy(false); setRestoring(false) }
  }

  function closeWorkspace() {
    sourceRef.current?.close(); sourceRef.current = null
    clearActiveWorkspace(); setSession(undefined); setChats([]); setActiveChatId('')
    setEvents([]); setManualPrompt(''); setItems([]); setError(undefined); setRecent(loadRecentWorkspaces())
  }

  async function newChat() {
    if (!session || busy) return
    setBusy(true); setError(undefined)
    try {
      const created = await api.createSession(session.project_path, executionMode)
      const chat = newWorkspaceChat(created.id)
      const next = [chat, ...chats]
      persistChats(created.project_path, next)
      setActiveChatId(chat.id); setSession(created); setItems([welcomeItem(created)])
      setEvents([]); setManualPrompt(''); connectEvents(created.id)
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
        if (restored.execution_mode !== executionMode) restored = await api.setExecutionMode(restored.id, executionMode)
      } catch (error) {
        if (!(error instanceof APIError) || error.status !== 404) throw error
        restored = await api.createSession(session.project_path, executionMode)
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

  function updateChat(patch: Partial<WorkspaceChat>) {
    if (!session || !activeChatId) return
    setChats((current) => {
      const next = current.map((chat) => chat.id === activeChatId ? { ...chat, ...patch, updatedAt: new Date().toISOString() } : chat)
      saveWorkspaceChats(session.project_path, next)
      return next
    })
  }

  async function send(message: string) {
    if (!session) return
    const userItem: ChatItem = { id: crypto.randomUUID(), role: 'user', text: message }
    setItems((current) => [...current, userItem]); setBusy(true); setError(undefined)
    const activeChat = chats.find((chat) => chat.id === activeChatId)
    if (activeChat && (activeChat.title === 'Novo chat' || activeChat.title === 'Chat principal')) updateChat({ title: deriveChatTitle(message) })
    try {
      const response = await api.message(session.id, message)
      setSession(response.session); updateChat({ sessionId: response.session.id })
      setManualPrompt(response.manual_prompt || response.session.last_manual_prompt || '')
      setItems((current) => [...current, {
        id: crypto.randomUUID(), role: 'harness',
        text: response.session.plan ? response.session.plan.summary : 'Prompt do planner preparado. Abra a aba ChatGPT para enviar o contexto manualmente, ou configure o provider OpenAI para processamento automático.',
        meta: response.session.plan ? `Plano ${response.session.plan.plan_id}` : 'Aguardando plano externo',
      }])
    } catch (e) {
      const msg = messageOf(e); setError(msg)
      setItems((current) => [...current, { id: crypto.randomUUID(), role: 'harness', text: `Falha no planeamento: ${msg}` }])
    } finally { setBusy(false) }
  }

  async function submitManualPlan(raw: string) {
    if (!session) return
    setBusy(true); setError(undefined)
    try {
      const updated = await api.manualPlan(session.id, raw)
      setSession(updated); setItems((current) => [...current, { id: crypto.randomUUID(), role: 'harness', text: updated.plan?.summary || 'Plano manual validado.', meta: updated.policy?.allowed ? 'Policy validada' : 'Policy bloqueou o plano' }])
    } catch (e) { setError(messageOf(e)) } finally { setBusy(false) }
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
      setItems((current) => [...current, {
        id: crypto.randomUUID(), role: 'harness',
        text: ok ? (direct ? 'Plano executado diretamente no host em modo Unprotected. Não há etapa Apply.' : 'Execução e verificações concluídas na sandbox. O host ainda não foi alterado.') : 'A execução terminou com falha.',
        meta: direct && ok ? 'Host alterado diretamente' : undefined,
      }])
    } catch (e) { setError(messageOf(e)); void refreshSession() } finally { setBusy(false) }
  }

  async function apply() {
    if (!session || !window.confirm('Aplicar os patches verificados no projeto real?')) return
    setBusy(true); setError(undefined)
    try {
      const updated = await api.apply(session.id)
      setSession(updated); setItems((current) => [...current, { id: crypto.randomUUID(), role: 'harness', text: 'Patch aplicado ao projeto real após a verificação da sandbox.', meta: 'Host alterado' }])
    } catch (e) { setError(messageOf(e)) } finally { setBusy(false) }
  }

  async function changeExecutionMode(next: ExecutionMode) {
    if (!session || next === executionMode || busy) return
    if (next === 'unprotected' && !window.confirm('Ativar UNPROTECTED para este projeto? Os planos do Agent poderão alterar ficheiros e executar comandos diretamente no host, sem sandbox e sem etapa Apply.')) return
    setBusy(true); setError(undefined)
    try {
      const updated = await api.setExecutionMode(session.id, next)
      setSession(updated); setExecutionMode(next); saveExecutionMode(updated.project_path, next)
      const otherSessions = chats.filter((chat) => chat.sessionId !== updated.id).map((chat) => api.setExecutionMode(chat.sessionId, next))
      void Promise.allSettled(otherSessions)
      setItems((current) => [...current, {
        id: crypto.randomUUID(), role: 'harness',
        text: next === 'unprotected' ? 'Modo Unprotected ativado para este projeto. Os próximos planos serão executados diretamente no host após confirmação.' : 'Modo Protected ativado. Os próximos planos voltarão a executar primeiro na sandbox.',
        meta: next === 'unprotected' ? 'Host direto' : 'Sandbox ativa',
      }])
    } catch (e) { setError(messageOf(e)) } finally { setBusy(false) }
  }

  async function refreshSession() {
    if (!session) return
    try { setSession(await api.getSession(session.id)) } catch { /* retain last known state */ }
  }

  if (!session) return <Bootstrap config={config} busy={busy} error={error} recent={recent} restoring={restoring} onStart={start} />
  const activeChat = chats.find((chat) => chat.id === activeChatId)
  return <main className="workspace-root">
    <WorkspaceTopbar config={config} session={session} mode={mode} executionMode={executionMode} busy={busy} onMode={setMode} onExecutionMode={changeExecutionMode} onClose={closeWorkspace} />
    {error && <div className="toast-error" role="alert">{error}<button onClick={() => setError(undefined)}>×</button></div>}
    {mode === 'editor'
      ? <EditorWorkspace session={session} onError={setError} />
      : <div className="agent-workspace">
          <ChatPanel session={session} items={items} chats={chats} activeChatId={activeChatId} busy={busy} onSend={send} onNewChat={newChat} onSelectChat={selectChat} />
          <Inspector config={config} session={session} events={events} manualPrompt={manualPrompt} busy={busy} chat={activeChat} onChatGPTURL={(url) => updateChat({ chatgptUrl: url })} onExecute={execute} onApply={apply} onManualPlan={submitManualPlan} onSession={setSession} />
        </div>}
  </main>
}

function welcomeItem(session: Session): ChatItem {
  return { id: 'welcome', role: 'harness', text: 'Contexto preparado. Diga o que precisa alterar, investigar ou validar.', meta: `${session.context.manifest.files.length} ficheiros elegíveis no snapshot` }
}

function messageOf(error: unknown) {
  if (error instanceof APIError || error instanceof Error) return error.message
  return 'Erro inesperado'
}
