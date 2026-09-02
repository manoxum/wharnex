import { useCallback, useEffect, useRef, useState } from 'react'
import { api, APIError } from './lib/api'
import type { AppConfig, ChatItem, HarnessEvent, Session, WorkspaceMode } from './types'
import { Bootstrap } from './components/Bootstrap'
import { ChatPanel } from './components/ChatPanel'
import { Inspector } from './components/Inspector'
import { EditorWorkspace } from './components/EditorWorkspace'
import { WorkspaceTopbar } from './components/WorkspaceTopbar'
import { clearActiveWorkspace, loadActiveWorkspace, loadChat, loadRecentWorkspaces, rememberRecent, saveActiveWorkspace, saveChat } from './lib/workspaceMemory'

export default function App() {
  const activeAtLoad = loadActiveWorkspace()
  const [config, setConfig] = useState<AppConfig>()
  const [session, setSession] = useState<Session>()
  const [items, setItems] = useState<ChatItem[]>([])
  const [events, setEvents] = useState<HarnessEvent[]>([])
  const [manualPrompt, setManualPrompt] = useState('')
  const [mode, setMode] = useState<WorkspaceMode>(activeAtLoad?.mode || 'editor')
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

  useEffect(() => {
    let alive = true
    async function initialize() {
      try {
        const value = await api.config()
        if (alive) setConfig(value)
      } catch (e) {
        if (alive) setError(messageOf(e))
      }
      const active = loadActiveWorkspace()
      if (!active) { if (alive) setRestoring(false); return }
      try {
        let restored: Session
        try { restored = await api.getSession(active.sessionId) }
        catch (error) {
          if (!(error instanceof APIError) || error.status !== 404) throw error
          restored = await api.createSession(active.projectPath)
        }
        if (!alive) return
        setSession(restored)
        setMode(active.mode || 'editor')
        setManualPrompt(restored.last_manual_prompt || '')
        const chat = loadChat(restored.project_path)
        setItems(chat.length ? chat : [welcomeItem(restored)])
        connectEvents(restored.id)
        saveActiveWorkspace({ sessionId: restored.id, projectPath: restored.project_path, mode: active.mode || 'editor' })
      } catch (e) {
        if (alive) { clearActiveWorkspace(); setError(`Não foi possível reabrir o workspace: ${messageOf(e)}`) }
      } finally { if (alive) setRestoring(false) }
    }
    void initialize()
    return () => { alive = false }
  }, [connectEvents])

  useEffect(() => {
    return () => {
      sourceRef.current?.close()
      sourceRef.current = null
    }
  }, [])

  useEffect(() => {
    if (!session) return
    saveActiveWorkspace({ sessionId: session.id, projectPath: session.project_path, mode })
    setRecent(loadRecentWorkspaces())
  }, [session, mode])

  useEffect(() => {
    if (session && items.length) saveChat(session.project_path, items)
  }, [session, items])

  async function start(projectPath: string) {
    setBusy(true); setError(undefined)
    try {
      const created = await api.createSession(projectPath)
      rememberRecent(created.project_path)
      setRecent(loadRecentWorkspaces())
      setSession(created); setItems(loadChat(created.project_path).length ? loadChat(created.project_path) : [welcomeItem(created)])
      setManualPrompt(''); setEvents([]); setMode('editor')
      connectEvents(created.id)
    } catch (e) { setError(messageOf(e)) } finally { setBusy(false); setRestoring(false) }
  }

  function closeWorkspace() {
    if (items.length > 1 && !window.confirm('Fechar este workspace? O projeto continuará na lista de recentes.')) return
    sourceRef.current?.close(); sourceRef.current = null
    clearActiveWorkspace(); setSession(undefined); setEvents([]); setManualPrompt(''); setItems([]); setError(undefined); setRecent(loadRecentWorkspaces())
  }

  async function send(message: string) {
    if (!session) return
    const userItem: ChatItem = { id: crypto.randomUUID(), role: 'user', text: message }
    setItems((current) => [...current, userItem]); setBusy(true); setError(undefined)
    try {
      const response = await api.message(session.id, message)
      setSession(response.session)
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
    setBusy(true); setError(undefined)
    try {
      const response = await api.execute(session.id, approved)
      setSession(response.session); setItems((current) => [...current, { id: crypto.randomUUID(), role: 'harness', text: response.session.last_execution?.success ? 'Execução e verificações concluídas na sandbox. O host ainda não foi alterado.' : 'A execução terminou com falha.' }])
    } catch (e) { const msg = messageOf(e); setError(msg); void refreshSession() } finally { setBusy(false) }
  }

  async function apply() {
    if (!session) return
    if (!window.confirm('Aplicar os patches verificados no projeto real?')) return
    setBusy(true); setError(undefined)
    try {
      const updated = await api.apply(session.id)
      setSession(updated); setItems((current) => [...current, { id: crypto.randomUUID(), role: 'harness', text: 'Patch aplicado ao projeto real após a verificação da sandbox.', meta: 'Host alterado' }])
    } catch (e) { setError(messageOf(e)) } finally { setBusy(false) }
  }

  async function refreshSession() {
    if (!session) return
    try { setSession(await api.getSession(session.id)) } catch { /* retain last known state */ }
  }

  if (!session) return <Bootstrap config={config} busy={busy} error={error} recent={recent} restoring={restoring} onStart={start} />
  return <main className="workspace-root">
    <WorkspaceTopbar config={config} session={session} mode={mode} onMode={setMode} onClose={closeWorkspace} />
    {error && <div className="toast-error" role="alert">{error}<button onClick={() => setError(undefined)}>×</button></div>}
    {mode === 'editor'
      ? <EditorWorkspace session={session} onError={setError} />
      : <div className="agent-workspace"><ChatPanel session={session} items={items} busy={busy} onSend={send} /><Inspector config={config} session={session} events={events} manualPrompt={manualPrompt} busy={busy} onExecute={execute} onApply={apply} onManualPlan={submitManualPlan} onSession={setSession} /></div>}
  </main>
}

function welcomeItem(session: Session): ChatItem {
  return { id: 'welcome', role: 'harness', text: 'Contexto preparado. Diga o que precisa alterar, investigar ou validar.', meta: `${session.context.manifest.files.length} ficheiros elegíveis no snapshot` }
}

function messageOf(error: unknown) {
  if (error instanceof APIError || error instanceof Error) return error.message
  return 'Erro inesperado'
}
