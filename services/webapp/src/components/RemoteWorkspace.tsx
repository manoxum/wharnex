import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from '../api'
import { encodeFiles } from '../lib/attachments'
import { applyUIPreferences } from '../lib/theme'
import type { AppConfig, ChatItem, PanelName, ProjectStorage, Session, WorkspaceChat } from '../types'
import { ChatPane } from './ChatPane'
import type { ComposerValue } from './Composer'
import { OrchestratorPane } from './OrchestratorPane'
import { PanelDrawer } from './PanelDrawer'
import { ProjectSidebar } from './ProjectSidebar'

const terminalStates = new Set(['ready', 'applied', 'verified', 'failed', 'blocked', 'archived', 'restart_pending'])
const projectName = (path: string) => path.split(/[\\/]/).filter(Boolean).at(-1) || path

export function RemoteWorkspace({ onDisconnect }: { onDisconnect: () => Promise<void> }) {
  const [projects, setProjects] = useState<ProjectStorage[]>([])
  const [project, setProject] = useState('')
  const [chats, setChats] = useState<WorkspaceChat[]>([])
  const [chat, setChat] = useState<WorkspaceChat>()
  const [session, setSession] = useState<Session>()
  const [items, setItems] = useState<ChatItem[]>([])
  const [config, setConfig] = useState<AppConfig>()
  const [mode, setMode] = useState<'agent' | 'orchestrator'>('agent')
  const [panel, setPanel] = useState<PanelName>('notifications')
  const [panelOpen, setPanelOpen] = useState(false)
  const [mobileNav, setMobileNav] = useState(false)
  const [sending, setSending] = useState(false)
  const [error, setError] = useState('')
  const turnSeen = useRef('')

  const fail = useCallback((message: string) => setError(message), [])
  const openChat = useCallback(async (next: WorkspaceChat) => {
    setError('')
    let selected = next
    if (next.archived_at) {
      await api.restoreSession(next.session_id)
      selected = await api.setWorkspaceChatArchived(next.id, false)
      setChats((all) => all.map((item) => item.id === selected.id ? selected : item))
    }
    setChat(selected)
    const [active, transcript] = await Promise.all([api.getSession(selected.session_id), api.workspaceChatItems(selected.id)])
    setSession(active); setItems(transcript.items.map((item) => item.payload)); setMobileNav(false)
  }, [])

  const loadChats = useCallback(async (path: string, preferred = '') => {
    const result = await api.workspaceChats(path)
    setChats(result.chats)
    const next = result.chats.find((item) => item.id === preferred) || result.chats.find((item) => !item.archived_at)
    if (next) await openChat(next); else { setChat(undefined); setSession(undefined); setItems([]) }
  }, [openChat])

  useEffect(() => {
    void Promise.all([api.storage(), api.config()]).then(async ([storage, nextConfig]) => {
      setConfig(nextConfig); setProjects(storage.projects || [])
      const remembered = localStorage.getItem('wharnex.remote.project') || ''
      const path = storage.projects.some((item) => item.project_path === remembered) ? remembered : storage.projects[0]?.project_path || ''
      setProject(path); if (path) await loadChats(path)
    }).catch((cause) => fail(cause instanceof Error ? cause.message : String(cause)))
  }, [fail, loadChats])

  useEffect(() => {
    let active = true
    const syncTheme = () => { void api.uiPreferences().then((value) => { if (active) applyUIPreferences(value) }).catch(() => undefined) }
    syncTheme()
    const timer = window.setInterval(syncTheme, 4000)
    return () => { active = false; window.clearInterval(timer) }
  }, [])

  useEffect(() => {
    if (!session) return
    const timer = window.setInterval(() => { void api.getSession(session.id).then(setSession).catch(() => undefined) }, terminalStates.has(session.state) ? 7000 : 2500)
    return () => window.clearInterval(timer)
  }, [session?.id, session?.state])

  useEffect(() => {
    if (!session?.last_turn?.message || !chat) return
    const id = `turn-${session.last_request_id || session.id}-${session.last_turn.kind || 'result'}`
    if (turnSeen.current === id || items.some((item) => item.id === id)) return
    turnSeen.current = id
    const next = [...items, { id, role: 'harness' as const, text: session.last_turn.message, createdAt: new Date().toISOString(), source: 'wharness' }]
    setItems(next); void api.replaceWorkspaceChatItems(chat.id, next).catch(() => undefined)
  }, [chat, items, session])

  async function chooseProject(path: string) { setProject(path); localStorage.setItem('wharnex.remote.project', path); await loadChats(path) }
  async function newChat() {
    if (!project) return
    const id = crypto.randomUUID(); const active = await api.createSession(project, id); const now = new Date().toISOString()
    const next: WorkspaceChat = { id, project_path: project, session_id: active.id, title: 'Novo chat', created_at: now, updated_at: now }
    await api.saveWorkspaceChat(next); setChats((current) => [next, ...current]); setChat(next); setSession(active); setItems([]); setMode('agent'); setMobileNav(false)
  }

  async function send(value: ComposerValue) {
    if (!session || !chat) return
    if (config?.planner && config.planner !== 'manual') { setError('O cockpit remoto exige o planner manual para garantir que o pedido seja executado pelo navegador do Desktop.'); return }
    setSending(true); setError('')
    try {
      const attachments = await encodeFiles(value.files)
      let currentChat = chat
      if (chat.title === 'Novo chat') {
        currentChat = { ...chat, title: value.text.replace(/\s+/g, ' ').slice(0, 72), updated_at: new Date().toISOString() }
        await api.saveWorkspaceChat(currentChat); setChat(currentChat); setChats((all) => all.map((item) => item.id === chat.id ? currentChat : item))
      }
      const userItem: ChatItem = { id: crypto.randomUUID(), role: 'user', text: value.text, createdAt: new Date().toISOString(), source: 'user', attachments: value.files.map((file) => ({ name: file.name, size: file.size, mime: file.type })) }
      const transcript = [...items, userItem]; setItems(transcript); await api.replaceWorkspaceChatItems(currentChat.id, transcript)
      const result = await api.message(session.id, value.text, value.mode); setSession(result.session)
      if (result.manual_prompt && result.session.last_request_id) {
        const dispatch = await api.remoteDispatch(session.id, { request_id: result.session.last_request_id, workspace_chat_id: currentChat.id, bootstrap_text: value.text, chat_title: currentChat.title, conversation_url: currentChat.chatgpt_url, attachments, project_files: value.projectFiles, tunnel_instance_ids: value.tunnelIds, include_context: value.includeContext })
        const notice: ChatItem = { id: `dispatch-${dispatch.task.task_id}`, role: 'harness', text: 'Pedido entregue ao Supervisor do Desktop. O webapp continuará a acompanhar esta sessão.', createdAt: new Date().toISOString(), source: 'wharness', presentation: 'notice' }
        const withNotice = [...transcript, notice]; setItems(withNotice); await api.replaceWorkspaceChatItems(currentChat.id, withNotice)
      }
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)) } finally { setSending(false) }
  }

  async function saveChat() { if (!chat) return; const next = await api.setWorkspaceChatSaved(chat.id, !chat.saved_at); setChat(next); setChats((all) => all.map((item) => item.id === next.id ? next : item)) }
  async function archiveChat() { if (!chat || !session) return; await api.archiveSession(session.id); const next = await api.setWorkspaceChatArchived(chat.id, true); setChats((all) => all.map((item) => item.id === next.id ? next : item)); setChat(undefined); setSession(undefined); setItems([]) }
  async function sessionSettings(next: Session) { if (!session) return; try { let saved = session; if (next.effort_level !== session.effort_level) saved = await api.setEffort(session.id, next.effort_level); if (next.reasoning_effort !== session.reasoning_effort) saved = await api.setReasoning(session.id, next.reasoning_effort); setSession(saved) } catch (cause) { fail(cause instanceof Error ? cause.message : String(cause)) } }

  const busy = sending || Boolean(session && !terminalStates.has(session.state) && session.last_request_id)
  const sidebar = <ProjectSidebar projects={projects} project={project} chats={chats} activeChatID={chat?.id || ''} onProject={(path) => void chooseProject(path)} onChat={(next) => void openChat(next)} onNewChat={() => void newChat()}/>
  return <div className="flex min-h-dvh flex-col bg-canvas text-ink">
    <header className="flex h-16 shrink-0 items-center gap-3 border-b border-line bg-surface/95 px-3 shadow-[0_1px_0_var(--theme-border-soft)] backdrop-blur-xl sm:px-4">
      <button onClick={() => setMobileNav(true)} className="grid size-9 place-items-center rounded-lg border border-line bg-elevated text-soft hover:bg-hover md:hidden" aria-label="Projetos">☰</button>
      <div className="grid size-9 shrink-0 place-items-center rounded-xl bg-accent text-sm font-black text-accent-ink shadow-[0_8px_24px_var(--theme-shadow)]">W</div>
      <div className="hidden min-w-0 sm:block"><p className="text-[10px] font-extrabold uppercase tracking-[0.22em] text-accent">Wharnex Remote</p><p className="truncate text-xs text-faint">{project ? projectName(project) : 'Sem projeto indexado'}</p></div>
      <div className="ml-auto flex items-center gap-1 rounded-lg border border-line-soft bg-muted p-1"><button onClick={() => setMode('agent')} className={`rounded-md px-2 py-1.5 text-xs font-semibold transition sm:px-3 ${mode === 'agent' ? 'bg-elevated text-ink shadow-sm' : 'text-faint hover:text-soft'}`}>Agent</button><button disabled={!session} onClick={() => setMode('orchestrator')} className={`rounded-md px-2 py-1.5 text-xs font-semibold transition disabled:opacity-40 sm:px-3 ${mode === 'orchestrator' ? 'bg-accent-soft text-accent' : 'text-faint hover:text-soft'}`}><span className="sm:hidden">Orq.</span><span className="hidden sm:inline">Orquestrador</span></button></div>
      <button onClick={() => setPanelOpen(true)} className="rounded-lg border border-line bg-elevated px-2.5 py-2 text-xs font-semibold text-soft hover:bg-hover hover:text-ink" aria-label="Abrir painéis"><span aria-hidden className="sm:hidden">◫</span><span className="hidden sm:inline">Painéis</span></button>
      <button onClick={() => void onDisconnect()} className="hidden rounded-lg px-3 py-2 text-xs text-faint hover:bg-hover hover:text-danger sm:block">Sair</button>
    </header>
    {error && <div role="alert" className="flex items-center border-b border-danger/30 bg-danger/10 px-4 py-2 text-xs text-danger"><span className="mr-2 size-1.5 rounded-full bg-danger"/>{error}<button onClick={() => setError('')} className="ml-auto rounded px-2 py-1 font-semibold hover:bg-danger/10">Fechar</button></div>}
    <div className="min-h-0 flex flex-1"><div className="hidden w-64 shrink-0 md:block">{sidebar}</div>{session && chat ? (mode === 'agent' ? <ChatPane chat={chat} session={session} config={config} items={items} busy={busy} onSend={send} onSave={() => void saveChat()} onArchive={() => void archiveChat()} onSessionChange={(next) => void sessionSettings(next)}/> : <OrchestratorPane session={session} project={project} config={config} onChatCreated={(next) => { setChats((all) => [next, ...all]); void openChat(next) }} onError={fail}/>) : <main className="grid flex-1 place-items-center bg-canvas p-6 text-center"><div className="max-w-md"><div className="mx-auto grid size-14 place-items-center rounded-2xl border border-line bg-elevated text-2xl text-accent shadow-[0_18px_60px_var(--theme-shadow)]">✦</div><h2 className="mt-5 text-xl font-semibold tracking-tight">Abra um espaço de trabalho</h2><p className="mt-2 text-sm leading-6 text-faint">Escolha um chat existente ou inicie um novo Agent. O estado permanece sincronizado com o Desktop.</p>{project && <button onClick={() => void newChat()} className="mt-5 rounded-xl bg-accent px-4 py-2.5 text-sm font-bold text-accent-ink shadow-[0_10px_28px_var(--theme-shadow)] hover:brightness-105">Iniciar Agent</button>}</div></main>}</div>
    {mobileNav && <div className="fixed inset-0 z-50 bg-[var(--theme-overlay)] backdrop-blur-sm md:hidden" onClick={() => setMobileNav(false)}><div className="h-full w-[86%] max-w-xs shadow-2xl" onClick={(event) => event.stopPropagation()}>{sidebar}</div></div>}
    {panelOpen && <PanelDrawer panel={panel} project={project} session={session} chats={chats} config={config} onPanel={setPanel} onClose={() => setPanelOpen(false)} onConfig={setConfig} onOpenChat={(next) => void openChat(next)} onError={fail}/>}
  </div>
}
