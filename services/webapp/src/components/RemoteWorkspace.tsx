import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from '../api'
import { encodeFiles } from '../lib/attachments'
import { applyUIPreferences } from '../lib/theme'
import type { AppConfig, ChatItem, PanelName, ProjectHistoryEntry, Session, WorkspaceChat } from '../types'
import { ChatPane } from './ChatPane'
import type { ComposerValue } from './Composer'
import { OrchestratorPane } from './OrchestratorPane'
import { PanelDrawer } from './PanelDrawer'
import { ProjectHub } from './ProjectHub'
import { ProjectSidebar } from './ProjectSidebar'

const terminalStates = new Set(['ready', 'applied', 'verified', 'failed', 'blocked', 'archived', 'restart_pending'])
const projectName = (path: string) => path.split(/[\\/]/).filter(Boolean).at(-1) || path

export function RemoteWorkspace({ onDisconnect }: { onDisconnect: () => Promise<void> }) {
  const [projects, setProjects] = useState<ProjectHistoryEntry[]>([]); const [project, setProject] = useState(''); const [chats, setChats] = useState<WorkspaceChat[]>([])
  const [chat, setChat] = useState<WorkspaceChat>(); const [session, setSession] = useState<Session>(); const [items, setItems] = useState<ChatItem[]>([]); const [config, setConfig] = useState<AppConfig>()
  const [mode, setMode] = useState<'agent' | 'orchestrator'>('agent'); const [panel, setPanel] = useState<PanelName>('notifications'); const [panelOpen, setPanelOpen] = useState(false)
  const [mobileNav, setMobileNav] = useState(false); const [sending, setSending] = useState(false); const [attentionCount, setAttentionCount] = useState(0); const [error, setError] = useState('')
  const turnSeen = useRef(''); const attentionPrimed = useRef(false); const attentionKey = useRef('')

  const fail = useCallback((message: string) => setError(message), [])
  const openChat = useCallback(async (next: WorkspaceChat) => {
    setError(''); let selected = next
    if (next.archived_at) { await api.restoreSession(next.session_id); selected = await api.setWorkspaceChatArchived(next.id, false); setChats((all) => all.map((item) => item.id === selected.id ? selected : item)) }
    setChat(selected); const [active, transcript] = await Promise.all([api.getSession(selected.session_id), api.workspaceChatItems(selected.id)])
    setSession(active); setItems(transcript.items.map((item) => item.payload)); setMobileNav(false); setMode('agent')
  }, [])
  const loadChats = useCallback(async (path: string, preferred = '') => { const result = await api.workspaceChats(path); setChats(result.chats); const next = result.chats.find((item) => item.id === preferred) || result.chats.find((item) => !item.archived_at); if (next) await openChat(next); else { setChat(undefined); setSession(undefined); setItems([]) } }, [openChat])

  useEffect(() => { void Promise.all([api.projectHistory(), api.config()]).then(([history, nextConfig]) => { setConfig(nextConfig); setProjects(history.projects || []) }).catch((cause) => fail(cause instanceof Error ? cause.message : String(cause))) }, [fail])
  useEffect(() => { let active = true; const syncTheme = () => { void api.uiPreferences().then((value) => { if (active) applyUIPreferences(value) }).catch(() => undefined) }; syncTheme(); const timer = window.setInterval(syncTheme, 4000); return () => { active = false; window.clearInterval(timer) } }, [])
  useEffect(() => { if (!session) return; const timer = window.setInterval(() => { void api.getSession(session.id).then(setSession).catch(() => undefined) }, terminalStates.has(session.state) ? 7000 : 2500); return () => window.clearInterval(timer) }, [session?.id, session?.state])
  useEffect(() => {
    attentionPrimed.current = false; attentionKey.current = ''; setAttentionCount(0); if (!project) return
    let active = true
    const poll = () => { void api.attention(project).then(({ records }) => { if (!active) return; const key = records.map((item) => `${item.session_id}:${item.state}:${item.last_request_id || ''}:${item.failure_kind || ''}`).join('|'); setAttentionCount(records.length); if (attentionPrimed.current && key !== attentionKey.current && records.length && 'Notification' in window && Notification.permission === 'granted') new Notification('Wharnex Remote', { body: `${records.length} sinal(is) requerem atenção em ${projectName(project)}.` }); attentionPrimed.current = true; attentionKey.current = key }).catch(() => undefined) }
    poll(); const timer = window.setInterval(poll, 12000); return () => { active = false; window.clearInterval(timer) }
  }, [project])
  useEffect(() => { if (!session?.last_turn?.message || !chat) return; const id = `turn-${session.last_request_id || session.id}-${session.last_turn.kind || 'result'}`; if (turnSeen.current === id || items.some((item) => item.id === id)) return; turnSeen.current = id; const next = [...items, { id, role: 'harness' as const, text: session.last_turn.message, createdAt: new Date().toISOString(), source: 'wharness' }]; setItems(next); void api.replaceWorkspaceChatItems(chat.id, next).catch(() => undefined) }, [chat, items, session])

  async function chooseProject(path: string) { setProject(path); localStorage.setItem('wharnex.remote.project', path); attentionPrimed.current = false; await loadChats(path) }
  function showProjectHub() { setProject(''); setChats([]); setChat(undefined); setSession(undefined); setItems([]); setMobileNav(false); setMode('agent') }
  async function newChat() { if (!project) return; const id = crypto.randomUUID(); const active = await api.createSession(project, id); const now = new Date().toISOString(); const next: WorkspaceChat = { id, project_path: project, session_id: active.id, title: 'Novo chat', created_at: now, updated_at: now }; await api.saveWorkspaceChat(next); setChats((current) => [next, ...current]); setChat(next); setSession(active); setItems([]); setMode('agent'); setMobileNav(false) }
  async function send(value: ComposerValue) {
    if (!session || !chat) return
    if (config?.planner && config.planner !== 'manual') throw new Error('O cockpit remoto exige o planner manual para garantir que o pedido seja executado pelo navegador do Desktop.')
    setSending(true); setError('')
    try {
      const attachments = await encodeFiles(value.files); let currentChat = chat
      if (chat.title === 'Novo chat') { currentChat = { ...chat, title: value.text.replace(/\s+/g, ' ').slice(0, 72), updated_at: new Date().toISOString() }; await api.saveWorkspaceChat(currentChat); setChat(currentChat); setChats((all) => all.map((item) => item.id === chat.id ? currentChat : item)) }
      const userItem: ChatItem = { id: crypto.randomUUID(), role: 'user', text: value.text, createdAt: new Date().toISOString(), source: 'user', attachments: value.files.map((file) => ({ name: file.name, size: file.size, mime: file.type })) }; const transcript = [...items, userItem]; setItems(transcript); await api.replaceWorkspaceChatItems(currentChat.id, transcript)
      const result = await api.message(session.id, value.text, value.mode); setSession(result.session)
      if (result.manual_prompt && result.session.last_request_id) { const dispatch = await api.remoteDispatch(session.id, { request_id: result.session.last_request_id, workspace_chat_id: currentChat.id, bootstrap_text: value.text, chat_title: currentChat.title, conversation_url: currentChat.chatgpt_url, attachments, project_files: value.projectFiles, tunnel_instance_ids: value.tunnelIds, include_context: value.includeContext }); const notice: ChatItem = { id: `dispatch-${dispatch.task.task_id}`, role: 'harness', text: 'Pedido entregue ao Supervisor do Desktop. O webapp continuará a acompanhar esta sessão.', createdAt: new Date().toISOString(), source: 'wharness', presentation: 'notice' }; const withNotice = [...transcript, notice]; setItems(withNotice); await api.replaceWorkspaceChatItems(currentChat.id, withNotice) }
    } catch (cause) { const message = cause instanceof Error ? cause.message : String(cause); setError(message); throw cause } finally { setSending(false) }
  }
  async function saveChat() { if (!chat) return; const next = await api.setWorkspaceChatSaved(chat.id, !chat.saved_at); setChat(next); setChats((all) => all.map((item) => item.id === next.id ? next : item)) }
  async function archiveChat() { if (!chat || !session) return; await api.archiveSession(session.id); const next = await api.setWorkspaceChatArchived(chat.id, true); setChats((all) => all.map((item) => item.id === next.id ? next : item)); setChat(undefined); setSession(undefined); setItems([]) }
  async function sessionSettings(next: Session) { if (!session) return; try { let saved = session; if (next.effort_level !== session.effort_level) saved = await api.setEffort(session.id, next.effort_level); else if (next.reasoning_effort !== session.reasoning_effort) saved = await api.setReasoning(session.id, next.reasoning_effort); else if (next.automation_mode !== session.automation_mode) saved = await api.setAutomationMode(session.id, next.automation_mode); else if (next.execution_mode !== session.execution_mode && next.execution_mode) saved = await api.setExecutionMode(session.id, next.execution_mode); else if (next.debug_enabled !== session.debug_enabled) saved = await api.setDebugMode(session.id, Boolean(next.debug_enabled)); else if (next.chat_transport_mode !== session.chat_transport_mode && next.chat_transport_mode) saved = await api.setChatTransportMode(session.id, next.chat_transport_mode); else if (next.knowledge_sharing_enabled !== session.knowledge_sharing_enabled) saved = await api.setKnowledgeSharing(session.id, next.knowledge_sharing_enabled !== false); setSession(saved) } catch (cause) { fail(cause instanceof Error ? cause.message : String(cause)) } }
  function openPanel(next: PanelName) { setPanel(next); setPanelOpen(true) }
  function navigate(surface: 'plan' | 'files' | 'execution') { if (surface === 'plan') setMode('orchestrator'); else openPanel(surface === 'files' ? 'files' : 'tasks') }
  async function openNotifications() { if ('Notification' in window && Notification.permission === 'default') await Notification.requestPermission().catch(() => undefined); if (project) openPanel('notifications') }

  const busy = sending || Boolean(session && !terminalStates.has(session.state) && session.last_request_id)
  const sidebar = <ProjectSidebar projects={projects} project={project} chats={chats} activeChatID={chat?.id || ''} onProject={(path) => void chooseProject(path)} onChat={(next) => void openChat(next)} onNewChat={() => void newChat()} onHome={showProjectHub}/>
  return <div className="flex min-h-dvh flex-col bg-canvas text-ink">
    <header className="flex h-16 shrink-0 items-center gap-2 border-b border-line bg-surface/95 px-3 shadow-[0_1px_0_var(--theme-border-soft)] backdrop-blur-xl sm:gap-3 sm:px-4">
      {project && <button onClick={() => setMobileNav(true)} className="grid size-9 place-items-center rounded-lg border border-line bg-elevated text-soft hover:bg-hover md:hidden" aria-label="Projetos">☰</button>}
      <button onClick={showProjectHub} className="grid size-9 shrink-0 place-items-center rounded-xl bg-accent text-sm font-black text-accent-ink shadow-[0_8px_24px_var(--theme-shadow)]" aria-label="Todos os projetos">W</button>
      <div className="hidden min-w-0 sm:block"><p className="text-[10px] font-extrabold uppercase tracking-[0.22em] text-accent">Wharnex Remote</p><p className="truncate text-xs text-faint">{project ? projectName(project) : 'Projetos do Desktop'}</p></div>
      {project && <div className="ml-auto flex items-center gap-1 rounded-lg border border-line-soft bg-muted p-1"><button onClick={() => setMode('agent')} className={`rounded-md px-2 py-1.5 text-xs font-semibold sm:px-3 ${mode === 'agent' ? 'bg-elevated text-ink shadow-sm' : 'text-faint hover:text-soft'}`}>Agent</button><button disabled={!session} onClick={() => setMode('orchestrator')} className={`rounded-md px-2 py-1.5 text-xs font-semibold disabled:opacity-40 sm:px-3 ${mode === 'orchestrator' ? 'bg-accent-soft text-accent' : 'text-faint hover:text-soft'}`}><span className="sm:hidden">Orq.</span><span className="hidden sm:inline">Orquestrador</span></button></div>}
      <button onClick={() => void openNotifications()} className={`${project ? '' : 'ml-auto'} relative grid size-9 place-items-center rounded-lg border border-line bg-elevated text-soft hover:bg-hover`} aria-label="Notificações">♢{attentionCount > 0 && <span className="absolute -right-1 -top-1 min-w-4 rounded-full bg-danger px-1 text-center text-[9px] font-bold leading-4 text-white">{Math.min(attentionCount, 99)}</span>}</button>
      {project && <button onClick={() => setPanelOpen(true)} className="rounded-lg border border-line bg-elevated px-2.5 py-2 text-xs font-semibold text-soft hover:bg-hover" aria-label="Abrir painéis"><span className="sm:hidden">◫</span><span className="hidden sm:inline">Painéis</span></button>}
      <button onClick={() => void onDisconnect()} className="hidden rounded-lg px-3 py-2 text-xs text-faint hover:bg-hover hover:text-danger sm:block">Sair</button>
    </header>
    {error && <div role="alert" className="flex items-center border-b border-danger/30 bg-danger/10 px-4 py-2 text-xs text-danger"><span className="mr-2 size-1.5 rounded-full bg-danger"/>{error}<button onClick={() => setError('')} className="ml-auto rounded px-2 py-1 font-semibold hover:bg-danger/10">Fechar</button></div>}
    <div className="min-h-0 flex flex-1">{!project ? <ProjectHub projects={projects} onOpen={(path) => void chooseProject(path)}/> : <><div className="hidden w-64 shrink-0 md:block">{sidebar}</div>{session && chat ? (mode === 'agent' ? <ChatPane chat={chat} session={session} config={config} items={items} busy={busy} onSend={send} onSave={() => void saveChat()} onArchive={() => void archiveChat()} onSessionChange={(next) => void sessionSettings(next)} onNavigate={navigate} onOpenPanel={openPanel}/> : <OrchestratorPane session={session} project={project} config={config} onChatCreated={(next) => { setChats((all) => [next, ...all]); void openChat(next) }} onError={fail}/>) : <main className="grid flex-1 place-items-center bg-canvas p-6 text-center"><div className="max-w-md"><div className="mx-auto grid size-14 place-items-center rounded-2xl border border-line bg-elevated text-2xl text-accent">✦</div><h2 className="mt-5 text-xl font-semibold">Abra um espaço de trabalho</h2><p className="mt-2 text-sm leading-6 text-faint">Escolha um chat existente ou inicie um novo Agent.</p><button onClick={() => void newChat()} className="mt-5 rounded-xl bg-accent px-4 py-2.5 text-sm font-bold text-accent-ink">Iniciar Agent</button></div></main>}</>}</div>
    {mobileNav && <div className="fixed inset-0 z-50 bg-[var(--theme-overlay)] backdrop-blur-sm md:hidden" onClick={() => setMobileNav(false)}><div className="h-full w-[86%] max-w-xs shadow-2xl" onClick={(event) => event.stopPropagation()}>{sidebar}</div></div>}
    {panelOpen && <PanelDrawer panel={panel} project={project} session={session} chats={chats} config={config} onPanel={setPanel} onClose={() => setPanelOpen(false)} onConfig={setConfig} onOpenChat={(next) => void openChat(next)} onError={fail}/>}
  </div>
}
