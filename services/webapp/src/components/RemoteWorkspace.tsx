import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from '../api'
import { encodeFiles } from '../lib/attachments'
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
    if (!session) return
    const timer = window.setInterval(() => {
      void api.getSession(session.id).then(setSession).catch(() => undefined)
    }, terminalStates.has(session.state) ? 7000 : 2500)
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

  async function chooseProject(path: string) {
    setProject(path); localStorage.setItem('wharnex.remote.project', path); await loadChats(path)
  }

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
  return <div className="flex min-h-dvh flex-col bg-slate-950 text-slate-100 [color-scheme:dark]">
    <header className="flex h-14 shrink-0 items-center gap-3 border-b border-slate-800 bg-slate-950 px-3 sm:px-4"><button onClick={() => setMobileNav(true)} className="grid size-9 place-items-center rounded-xl border border-slate-800 md:hidden" aria-label="Projetos">☰</button><div className="min-w-0"><p className="text-[10px] font-bold uppercase tracking-[0.2em] text-cyan-400">Wharnex Remote</p><p className="truncate text-xs text-slate-500">{project ? projectName(project) : 'Sem projeto indexado'}</p></div><div className="ml-auto flex items-center gap-1 rounded-xl bg-slate-900 p-1"><button onClick={() => setMode('agent')} className={`rounded-lg px-3 py-1.5 text-xs font-semibold ${mode === 'agent' ? 'bg-slate-700 text-white' : 'text-slate-500'}`}>Agent</button><button disabled={!session} onClick={() => setMode('orchestrator')} className={`rounded-lg px-3 py-1.5 text-xs font-semibold disabled:opacity-40 ${mode === 'orchestrator' ? 'bg-violet-400/20 text-violet-200' : 'text-slate-500'}`}>Orquestrador</button></div><button onClick={() => setPanelOpen(true)} className="rounded-xl border border-slate-800 px-3 py-2 text-xs font-semibold text-slate-300 hover:bg-slate-900">Painéis</button><button onClick={() => void onDisconnect()} className="hidden rounded-xl border border-slate-800 px-3 py-2 text-xs text-slate-500 hover:text-rose-300 sm:block">Sair</button></header>
    {error && <div role="alert" className="border-b border-rose-900/60 bg-rose-950/50 px-4 py-2 text-xs text-rose-200">{error}<button onClick={() => setError('')} className="ml-3 underline">fechar</button></div>}
    <div className="min-h-0 flex flex-1"><div className="hidden w-60 shrink-0 md:block"><ProjectSidebar projects={projects} project={project} chats={chats} activeChatID={chat?.id || ''} onProject={(path) => void chooseProject(path)} onChat={(next) => void openChat(next)} onNewChat={() => void newChat()}/></div>{session && chat ? (mode === 'agent' ? <ChatPane chat={chat} session={session} config={config} items={items} busy={busy} onSend={send} onSave={() => void saveChat()} onArchive={() => void archiveChat()} onSessionChange={(next) => void sessionSettings(next)}/> : <OrchestratorPane session={session} project={project} config={config} onChatCreated={(next) => { setChats((all) => [next, ...all]); void openChat(next) }} onError={fail}/>) : <main className="grid flex-1 place-items-center p-6 text-center"><div><div className="mx-auto grid size-14 place-items-center rounded-2xl bg-cyan-400/10 text-2xl text-cyan-300">⌂</div><h2 className="mt-4 text-xl font-semibold">Escolha ou inicie um chat</h2><p className="mt-2 text-sm text-slate-500">Projetos indexados no Desktop aparecem aqui automaticamente.</p>{project && <button onClick={() => void newChat()} className="mt-5 rounded-xl bg-cyan-400 px-4 py-2.5 text-sm font-bold text-slate-950">Iniciar Agent</button>}</div></main>}</div>
    {mobileNav && <div className="fixed inset-0 z-50 bg-black/60 md:hidden" onClick={() => setMobileNav(false)}><div className="h-full w-[86%] max-w-xs" onClick={(event) => event.stopPropagation()}><ProjectSidebar projects={projects} project={project} chats={chats} activeChatID={chat?.id || ''} onProject={(path) => void chooseProject(path)} onChat={(next) => void openChat(next)} onNewChat={() => void newChat()}/></div></div>}
    {panelOpen && <PanelDrawer panel={panel} project={project} session={session} chats={chats} config={config} onPanel={setPanel} onClose={() => setPanelOpen(false)} onConfig={setConfig} onOpenChat={(next) => void openChat(next)} onError={fail}/>}
  </div>
}
