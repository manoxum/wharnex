import { AgentRuntimeDetails, AgentRuntimeHeader, durationLabel, memoryLabel, short, stateLegend, timeLabel, type OperationalState } from './presentation'
import { AgentRuntimeTabs } from './AgentRuntimeTabs'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { desktopBridge, elementBounds } from '../../../lib/desktop/bridge/desktop'
import { api } from '../../../lib/transport/http/api'
import type { ChatAgentTask } from '../../../types'
import { Icon } from '../../presentation/chrome/Icon'
import { ContentSkeleton } from '../../presentation/chrome/Skeleton'
import { AgentRuntimePolicies } from './AgentRuntimePolicies'
import { WorkerMirror } from '../../chatgpt/mirror/WorkerMirror'

type Runtime = DesktopAgentRuntimeState

type Snapshot = { agentId: string; dataUrl: string; capturedAt: string }

const writingTaskTypes = new Set(['BOT_WRITE', 'RECOVERY_WRITE', 'ORCHESTRATOR_PLAN'])

// What a Worker is actually doing inside its task, reported by the Desktop.
// Inferring it from the task type showed a Worker still waiting its turn at
// the shared pacer as already writing to ChatGPT.
const activityStates: Record<DesktopAgentRuntimeActivityPhase, { key: OperationalState; label: string }> = {
  claimed: { key: 'working', label: 'A iniciar tarefa' },
  waiting_turn: { key: 'waiting', label: 'Na fila de envio' },
  navigating: { key: 'loading', label: 'A abrir conversa' },
  preparing: { key: 'working', label: 'A preparar pedido' },
  uploading: { key: 'writing', label: 'A carregar ZIP' },
  submitting: { key: 'writing', label: 'A submeter pedido' },
  processing: { key: 'listening', label: 'GPT a processar' },
  downloading: { key: 'working', label: 'A descarregar resposta' },
  validating: { key: 'working', label: 'A validar resposta' },
}

function agentOperationalState(agent: DesktopAgentRuntimeAgent): { key: OperationalState; label: string } {
  if (agent.draining) return { key: 'draining', label: 'A terminar' }
  if (agent.status === 'error') return { key: 'error', label: 'Com erro' }
  const activity = agent.activity && activityStates[agent.activity.phase]
  if (activity && agent.task) return activity
  if (agent.status === 'loading' || agent.browser.loading) return { key: 'loading', label: 'A carregar' }
  if (agent.status === 'stopped' || agent.loop_active === false) return { key: 'stopped', label: 'Parado' }

  const task = engagedTask(agent)
  if (agent.role === 'worker' && agent.suspended && !task) return { key: 'paused', label: 'Suspenso' }
  if (task?.type === 'AWAIT_RESPONSE' || agent.binding_hold === 'expected-bundle' || agent.binding_hold === 'bundle-delivery') return { key: 'listening', label: 'A escutar' }
  if (task && writingTaskTypes.has(task.type)) return { key: 'writing', label: 'A escrever' }
  if (agent.pinned_task_id && !agent.task) return { key: 'waiting', label: 'Preso à tarefa' }
  if (task?.status === 'WAITING' || (agent.occupied && !agent.task)) return { key: 'waiting', label: 'A aguardar' }
  if (task || agent.occupied || agent.status === 'running' || agent.status === 'claimed') return { key: 'working', label: 'Em tarefa' }
  if (agent.chat_id) return { key: 'chat-empty', label: 'Chat sem jobs' }
  return { key: 'idle', label: 'Ocioso' }
}

function agentDisplayState(agent: DesktopAgentRuntimeAgent, isForeign = false) {
  // Shared pool status may name the owning project, not the task's activity.
  return isForeign ? { key: 'working' as const, label: 'Ocupado noutro projeto' } : agentOperationalState(agent)
}

function statusLabel(agent: DesktopAgentRuntimeAgent, isForeign = false) {
  const label = agentDisplayState(agent, isForeign).label
  return agent.interacting ? `Interação · ${label}` : label
}

function runtimeErrorMessage(error: unknown, fallback: string) {
  if (typeof error === 'string') return error.trim() || fallback
  if (!error || typeof error !== 'object' || !('message' in error)) return fallback
  const message = String((error as { message?: unknown }).message || '').trim()
  return message || fallback
}

// The agent pool is global: every open project shares the same Supervisors and
// Workers. An agent busy with another project's task therefore has to say so,
// or this panel reports "0 available" beside cards that all look idle to the
// operator reading it from the project that is *not* running (adr/ADR-0044).
//
// Only the other project's identity is exposed. What its task is belongs to
// that project's own surfaces.
// The project this agent is working for, whichever it is. Prefer the agent-level
// attribution: a Supervisor spends most of a request between observations with
// no lease at all, so reading only the lease left a slot that is demonstrably
// mid-request reported as belonging to nobody.
function agentProject(agent: DesktopAgentRuntimeAgent) {
  const direct = String(agent.project_id || '').trim()
  if (direct) return direct
  const sponsoredTask = agent.task || (agent.occupied || agent.keep_flowing_active ? agent.last_task : undefined)
  return String(sponsoredTask?.project_id || '').trim()
}

function foreignProject(agent: DesktopAgentRuntimeAgent, projectPath: string) {
  const owner = agentProject(agent)
  if (!owner || !projectPath || owner === projectPath) return ''
  return owner
}

// What the slot is engaged with, rather than what it holds a lease on this
// instant. Rendering the lease alone made the task row appear and disappear on
// every observation cycle for the whole length of a request.
function engagedTask(agent: DesktopAgentRuntimeAgent) {
  if (agent.task) return agent.task
  return agent.occupied || agent.keep_flowing_active ? agent.last_task : undefined
}

function projectLabel(projectPath: string) {
  const segments = projectPath.split('/').filter(Boolean)
  return segments[segments.length - 1] || projectPath
}

function interactionBounds(host: HTMLElement) {
  const bounds = elementBounds(host)
  const detail = host.closest('.agent-runtime-detail') as HTMLElement | null
  if (!detail) return bounds
  const clip = elementBounds(detail)
  const left = Math.max(bounds.x, clip.x)
  const top = Math.max(bounds.y, clip.y)
  const right = Math.min(bounds.x + bounds.width, clip.x + clip.width)
  const bottom = Math.min(bounds.y + bounds.height, clip.y + clip.height)
  if (right <= left || bottom <= top) return { x: clip.x, y: clip.y, width: 1, height: 1 }
  return { x: left, y: top, width: right - left, height: bottom - top }
}

export type AgentRuntimeChatRef = { id: string; title: string; sessionId: string }

export function AgentRuntimeDrawer({ projectPath, chats = [], onGoToChat, onFocusProject, onClose, onError }: {
  projectPath: string
  // This project's own chats, used to name the chat a slot is bound to. Chats
  // belonging to other projects are deliberately absent: ADR-0044 allows a
  // shared pool to expose another project's *identity* and nothing else about
  // its work, so a foreign slot names its project instead of its conversation.
  chats?: AgentRuntimeChatRef[]
  onGoToChat?: (chatId?: string, sessionId?: string) => void
  onFocusProject?: (projectPath: string) => void
  onClose: () => void
  onError?: (message: string) => void
}) {
  const bridge = desktopBridge()?.agents
  const interactionHostRef = useRef<HTMLDivElement>(null)
  const onErrorRef = useRef(onError)
  onErrorRef.current = onError
  const [runtime, setRuntime] = useState<Runtime>()
  const [selectedId, setSelectedId] = useState('supervisor-1')
  const [interactionId, setInteractionId] = useState<string>()
  const [busy, setBusy] = useState(false)
  const [snapshot, setSnapshot] = useState<Snapshot>()
  const [taskPickerOpen, setTaskPickerOpen] = useState(false)
  const [availableTasks, setAvailableTasks] = useState<ChatAgentTask[]>([])
  const [selectedTaskIds, setSelectedTaskIds] = useState<string[]>([])
  const [taskAssignmentMode, setTaskAssignmentMode] = useState<'standard' | 'keep_flowing'>('standard')
  const [activeTab, setActiveTab] = useState<'agents' | 'runtime' | 'policies'>('agents')

  const refresh = useCallback(async () => {
    if (!bridge) return
    try { setRuntime(await bridge.state()) } catch (error) { onErrorRef.current?.(runtimeErrorMessage(error, 'Não foi possível carregar os agentes')) }
  }, [bridge])

  useEffect(() => {
    if (!bridge) return
    let alive = true
    void bridge.state().then((value) => { if (alive) setRuntime(value) }).catch((error) => {
      if (alive) onErrorRef.current?.(runtimeErrorMessage(error, 'Não foi possível carregar os agentes'))
    })
    const off = bridge.onState((value) => { if (alive) setRuntime(value) })
    const timer = window.setInterval(() => { void refresh() }, 5_000)
    return () => { alive = false; off(); window.clearInterval(timer) }
  }, [bridge, refresh])

  const selected = useMemo(() => runtime?.agents.find((agent) => agent.id === selectedId) || runtime?.agents[0], [runtime, selectedId])
  const running = runtime?.agents.filter((agent) => ['writing', 'listening', 'waiting', 'working', 'draining'].includes(agentOperationalState(agent).key)).length || 0
  const elsewhere = runtime?.agents.filter((agent) => foreignProject(agent, projectPath)).length || 0
  const selectedForeign = selected ? foreignProject(selected, projectPath) : ''
  const chatIndex = useMemo(() => new Map(chats.map((chat) => [chat.id, chat])), [chats])
  // A slot's chat is named only when this project owns it. A foreign slot keeps
  // its conversation to itself and is described by its project instead.
  const selectedChat = selectedForeign ? undefined : chatIndex.get(String(selected?.chat_id || ''))
  const selectedProject = selected ? agentProject(selected) : ''
  const selectedEngagedTask = selected ? engagedTask(selected) : undefined

  useEffect(() => {
    setTaskPickerOpen(false)
    setAvailableTasks([])
    setSelectedTaskIds([])
    setTaskAssignmentMode('standard')
  }, [selected?.id])

  useEffect(() => {
    if (!bridge || !interactionId || selected?.id !== interactionId || selected.role !== 'worker') return
    const host = interactionHostRef.current
    if (!host) return
    let active = true
    let frame = 0
    const sync = () => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => {
        if (active && interactionHostRef.current) void bridge.setInteractionBounds(interactionId, interactionBounds(interactionHostRef.current)).catch(() => {})
      })
    }
    void bridge.openInteraction(interactionId, interactionBounds(host)).catch((error) => {
      if (!active) return
      setInteractionId(undefined)
      onErrorRef.current?.(error instanceof Error ? error.message : 'Não foi possível abrir a interação com o Worker')
    })
    const observer = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(sync)
    observer?.observe(host)
    window.addEventListener('resize', sync)
    window.addEventListener('scroll', sync, true)
    return () => {
      active = false
      observer?.disconnect()
      window.removeEventListener('resize', sync)
      window.removeEventListener('scroll', sync, true)
      void bridge.closeInteraction(interactionId).catch(() => {})
    }
  }, [bridge, interactionId, selected?.id, selected?.role])

  const setWorkerKeepFlowing = async (agentId: string, enabled: boolean) => {
    if (!bridge) return
    setBusy(true)
    try { setRuntime(await bridge.setWorkerKeepFlowing(agentId, enabled)) } catch (error) { onError?.(error instanceof Error ? error.message : 'Não foi possível atualizar Keep flowing neste Worker') } finally { setBusy(false) }
  }

  const loadAssignableTasks = async () => {
    if (!selected || selected.role !== 'worker' || selected.status !== 'idle' || selected.loop_active === false || selected.task || selected.keep_flowing_active || selectedForeign) return
    setBusy(true)
    try {
      const result = await api.chatAgentTasks(true, projectPath)
      setAvailableTasks((Array.isArray(result.tasks) ? result.tasks : []).filter((task) => ['PENDING', 'WAITING'].includes(task.status) && task.attempt < task.max_attempts))
      setTaskPickerOpen(true)
    } catch (error) {
      onError?.(error instanceof Error ? error.message : 'Não foi possível carregar tarefas para este Worker')
    } finally { setBusy(false) }
  }

  const assignSelectedTasks = async () => {
    if (!selected || selected.role !== 'worker' || !selectedTaskIds.length) return
    setBusy(true)
    try {
      for (const taskId of selectedTaskIds) await api.assignChatAgentTask(taskId, selected.id, taskAssignmentMode === 'keep_flowing')
      setSelectedTaskIds([])
      setTaskPickerOpen(false)
      await refresh()
    } catch (error) {
      onError?.(error instanceof Error ? error.message : 'Não foi possível atribuir as tarefas ao Worker')
    } finally { setBusy(false) }
  }

  const enableTaskKeepFlowing = async () => {
    if (!selected?.task || selected.role !== 'worker') return
    setBusy(true)
    try {
      await api.assignChatAgentTask(selected.task.task_id, selected.id, true)
      await refresh()
    } catch (error) {
      onError?.(error instanceof Error ? error.message : 'Não foi possível ativar Keep flowing temporário nesta tarefa')
    } finally { setBusy(false) }
  }

  const capture = async () => {
    if (!bridge || !selected) return
    setBusy(true)
    try {
      const result = await bridge.snapshot(selected.id)
      setSnapshot({ agentId: selected.id, dataUrl: result.dataUrl, capturedAt: result.capturedAt })
    } catch (error) { onError?.(error instanceof Error ? error.message : 'Não foi possível capturar o navegador') } finally { setBusy(false) }
  }

  // Following a Worker only selects it for the Engine. The embedded Engine
  // surface owns openInteraction/closeInteraction, so this drawer never opens
  // a separate native monitor before forwarding the selection.
  const followWorker = () => {
    if (!bridge || !selected || selected.role !== 'worker' || !selected.browser.available || selectedForeign) return
    const agentId = selected.id
    void (async () => {
      if (interactionId === agentId) {
        await bridge.closeInteraction(agentId)
        setInteractionId(undefined)
      }
      window.dispatchEvent(new CustomEvent('wharnex:agent-follow', { detail: { agentId } }))
    })().catch((error) => onErrorRef.current?.(error instanceof Error ? error.message : 'Não foi possível encaminhar o Worker para o Engine'))
  }

  const selectRuntimeTab = (tab: 'agents' | 'runtime' | 'policies') => {
    if (tab !== 'agents') setInteractionId(undefined)
    setActiveTab(tab)
  }

  if (!bridge) return <section className="agent-runtime-drawer !grid-rows-[auto_auto_auto_minmax(0,1fr)]" aria-label="Gestão de agentes">
    <AgentRuntimeHeader onClose={onClose}/>
    <div className="agent-drawer-empty"><strong>Bridge preload indisponível.</strong><span>Abra esta área no Wharnex Desktop/Electron. Sem a bridge não é possível distinguir o scheduler, o backend ou os browsers dos Workers.</span></div>
  </section>

  return <section className="agent-runtime-drawer !grid-rows-[auto_auto_auto_minmax(0,1fr)]" aria-label="Gestão de agentes">
    <AgentRuntimeHeader onClose={onClose} onRefresh={() => void refresh()}/>
    {!runtime ? <ContentSkeleton label="A carregar instâncias do runtime" rows={6}/> : <>
      <div className="agent-runtime-summary"><span><b>{runtime.agents.length}</b><small>instâncias</small></span><span><b>{running}</b><small>ocupadas</small></span><span><b>{elsewhere}</b><small>noutro projeto</small></span><span><b>{runtime.desired_workers}</b><small>{runtime.policies?.auto_scaled_workers ? `${runtime.configured_workers} base · +${runtime.policies.auto_scaled_workers} auto` : 'workers'}</small></span></div>
      <AgentRuntimeTabs value={activeTab} onChange={selectRuntimeTab} agents={runtime.agents.length} running={Boolean(runtime.scheduler?.running)} autoScale={runtime.policies.auto_scale}/>
      {/* The pool is shared deliberately; only the claim is scoped. Saying so
          here is what stops a busy pool from reading as a broken one. */}
      {activeTab === 'runtime' && <div className="agent-runtime-tab-panel runtime" role="tabpanel">
      <p className="agent-runtime-scope">Os agentes são partilhados por todos os projetos abertos, mas só executam tarefas de projetos abertos nalguma janela.</p>
      <div className="agent-runtime-memory-summary" aria-label="Consumo de RAM do runtime">
        <span><small>Total Workers</small><b>{memoryLabel(runtime.memory?.total_workers_bytes, runtime.memory?.available)}</b></span>
        <span><small>Total Supervisores</small><b>{memoryLabel(runtime.memory?.total_supervisors_bytes, runtime.memory?.available)}</b></span>
        <span><small>Total Agent</small><b>{memoryLabel(runtime.memory?.total_agents_bytes, runtime.memory?.available)}</b></span>
        <span><small>Desktop</small><b>{memoryLabel(runtime.memory?.desktop_bytes, runtime.memory?.available)}</b></span>
        <span><small>Total</small><b>{memoryLabel(runtime.memory?.total_bytes, runtime.memory?.available)}</b></span>
      </div>
      <div className="agent-runtime-diagnostics">
        <div className={`agent-runtime-diagnostic-row tone-${runtime.scheduler?.backend_reachable ? (runtime.scheduler.running ? 'success' : 'warning') : 'danger'}`}><div><strong>Scheduler</strong><small>{runtime.scheduler?.backend_reachable ? (runtime.scheduler.running ? 'Online' : 'Parado') : 'Backend indisponível'}</small></div><span title={runtime.scheduler?.last_error || ''}>{runtime.scheduler?.last_error ? short(runtime.scheduler.last_error) : timeLabel(runtime.scheduler?.last_refresh_at)}</span></div>
        <div className={`agent-runtime-diagnostic-row tone-${runtime.provider?.paused ? 'warning' : 'success'}`}><div><strong>Rate limit {runtime.provider?.provider || 'chatgpt'}</strong><small>{runtime.provider?.paused ? 'Workers suspensos' : 'Workers ativos'}</small></div><div className="agent-runtime-provider-action"><span title={runtime.provider?.reason || ''}>{runtime.provider?.paused ? short(runtime.provider.reason, 'Suspensão de Workers ativa') : 'Sem bloqueio por rate limit'}</span></div></div>
        <div className={`agent-runtime-diagnostic-row tone-${(runtime.provider?.rate_limit_level || 0) > 0 ? 'warning' : 'neutral'}`}><div><strong>Pacing</strong><small>{runtime.provider?.valid_sample_count || 0} bundles válidos medidos</small></div><span>espera {durationLabel(runtime.provider?.initial_wait_ms)} · média {durationLabel(runtime.provider?.average_processing_ms)} · 429 L{runtime.provider?.rate_limit_level || 0}</span></div>
        {/* Only work still in the queue. A settled task has left it, and its
            lifetime tally described past throughput while saying nothing about
            what is waiting now. */}
        <div className="agent-runtime-queue">{Object.entries(runtime.queue?.counts || {}).filter(([, count]) => count > 0).map(([state, count]) => <span key={state}><b>{count}</b> {state}</span>)}</div>
        {/* Backlog is only the work a worker could actually claim now. A task
            deferred behind not_before (every bundle-retention cleanup is
            deferred for days by design) is waiting on a clock, not on a worker,
            so it is reported as "agendadas" and never ages the backlog. Work
            protected by provider/account/conversation guards is also not
            claimable merely because another Worker is idle. */}
        <div className="agent-runtime-queue"><span><b>{runtime.queue?.due || 0}</b> por executar</span><span><b>{runtime.queue?.scheduled || 0}</b> agendadas</span>{(runtime.queue?.guarded || 0) > 0 && <span><b>{runtime.queue.guarded}</b> aguardam liberação</span>}{(runtime.queue?.blocked || 0) > 0 && <span><b>{runtime.queue.blocked}</b> sem tentativas</span>}</div>
        <div className="agent-runtime-queue-times"><span>Mais antiga por executar: {timeLabel(runtime.queue?.oldest_due_created_at)}</span><span>Próxima agendada: {timeLabel(runtime.queue?.next_not_before)}</span></div>
      </div>
      </div>}
      {activeTab === 'policies' && <div className="agent-runtime-tab-panel policies" role="tabpanel">
        <AgentRuntimePolicies runtime={runtime} onRuntime={setRuntime} onError={onError} />
      </div>}
      {activeTab === 'agents' && <div className="agent-runtime-tab-panel agents" role="tabpanel">
      <div className="agent-runtime-state-legend" aria-label="Legenda dos estados dos agentes">
        {stateLegend.map(({ key, label, hint }) => <span key={key} title={hint}><i className={`agent-runtime-dot state-${key}`} aria-hidden="true"/>{label}</span>)}
      </div>
      <div className="agent-runtime-body">
        <div className="agent-runtime-list" role="list" aria-label="Instâncias de agentes">{runtime.agents.map((agent) => { const foreign = foreignProject(agent, projectPath); const operational = agentDisplayState(agent, Boolean(foreign)); return <button type="button" role="listitem" key={agent.id} className={`${selected?.id === agent.id ? 'active ' : ''}state-${operational.key}${foreign ? ' foreign-project' : ''}`} onClick={() => { setSelectedId(agent.id); setInteractionId(undefined); setSnapshot(undefined) }}>
          <span className={`agent-runtime-dot state-${operational.key}`} aria-hidden="true"/><span><strong>{agent.label}</strong><small>{agent.role === 'supervisor' ? 'Supervisor' : 'Worker'} · {statusLabel(agent, Boolean(foreign))}{!foreign && agent.keep_flowing_active ? ' · Keep flowing' : ''}</small>{foreign ? <em className="agent-runtime-foreign" title={`Ocupado com uma tarefa do projeto ${foreign}`}>Outro projeto · {projectLabel(foreign)}</em> : null}</span><span className="agent-runtime-agent-stats">{!foreign && engagedTask(agent) && <code>{engagedTask(agent)?.type}</code>}<code className="agent-runtime-memory-pill">{memoryLabel(agent.memory?.rss_bytes, agent.memory?.available)}</code></span>
        </button> })}</div>
        {selected && <div className="agent-runtime-detail">
          <div className={`agent-runtime-detail-heading state-${agentDisplayState(selected, Boolean(selectedForeign)).key}`}><div><span className={`agent-runtime-dot state-${agentDisplayState(selected, Boolean(selectedForeign)).key}`} aria-hidden="true"/><strong>{selected.label}</strong></div><span className="agent-runtime-status-pill">{statusLabel(selected, Boolean(selectedForeign))}</span></div>
          <AgentRuntimeDetails agent={selected} projectPath={projectPath} projectName={projectLabel(selectedProject || selectedForeign || '')} foreignProject={selectedForeign} projectId={selectedProject} chat={selectedChat} task={selectedForeign ? undefined : selectedEngagedTask || selected.last_task} taskIsCurrent={!selectedForeign && Boolean(selectedEngagedTask)} stateLabel={statusLabel(selected, Boolean(selectedForeign))} onGoToChat={onGoToChat} onFocusProject={onFocusProject}/>
          {selected.role === 'worker' && <div className="agent-runtime-worker-actions"><button type="button" className="agent-runtime-icon-button" aria-pressed={selected.keep_flowing || runtime.policies.keep_flowing_global} aria-label={runtime.policies.keep_flowing_global ? 'Keep flowing · global' : selected.keep_flowing ? 'Keep flowing · ativo' : 'Keep flowing · inativo'} title={runtime.policies.keep_flowing_global ? 'Keep flowing global ativo' : selected.keep_flowing ? 'Desativar Keep flowing neste Worker' : 'Ativar Keep flowing neste Worker'} disabled={busy || runtime.policies.keep_flowing_global} onClick={() => void setWorkerKeepFlowing(selected.id, !selected.keep_flowing)}><Icon name="refresh" size={14}/></button>{selected.task && !selectedForeign && !runtime.policies.keep_flowing_global && !selected.keep_flowing && !selected.task.keep_flowing ? <button type="button" className="agent-runtime-icon-button" aria-label="Keep flowing nesta tarefa" title="Keep flowing nesta tarefa" disabled={busy} onClick={() => void enableTaskKeepFlowing()}><Icon name="refresh" size={14}/></button> : null}{!selected.task && selected.status === 'idle' && selected.loop_active !== false && !selected.keep_flowing_active && !selectedForeign ? <button type="button" className="agent-runtime-icon-button" aria-label="Selecionar tarefas" title={taskPickerOpen ? 'Fechar seleção de tarefas' : 'Selecionar tarefas'} disabled={busy} onClick={() => taskPickerOpen ? setTaskPickerOpen(false) : void loadAssignableTasks()}><Icon name="list" size={14}/></button> : null}<button type="button" className="agent-runtime-icon-button" aria-label="Seguir (flow)" title="Seguir Worker no flow" disabled={busy || !selected.browser.available || Boolean(selectedForeign)} onClick={followWorker}><Icon name="monitor" size={14}/></button><button type="button" className="agent-runtime-icon-button" aria-pressed={interactionId === selected.id} aria-label={interactionId === selected.id ? 'Terminar interação' : 'Interagir aqui'} title={interactionId === selected.id ? 'Terminar interação' : selectedEngagedTask ? 'Abrir a instância em tamanho real durante a tarefa' : 'Interagir aqui'} disabled={busy || !selected.browser.available || Boolean(selectedForeign)} onClick={() => selectedEngagedTask ? followWorker() : setInteractionId(interactionId === selected.id ? undefined : selected.id)}><Icon name="cursor" size={14}/></button><button type="button" className="agent-runtime-icon-button" aria-label="Capturar imagem" title="Capturar imagem" disabled={busy || !selected.browser.available || Boolean(selectedForeign)} onClick={() => void capture()}><Icon name="camera" size={14}/></button></div>}
          {selected.role === 'worker' && selected.keep_flowing_active && (selected.task?.keep_flowing || selected.last_task?.keep_flowing) && !selected.keep_flowing && !runtime.policies.keep_flowing_global ? <p className="agent-runtime-task-keep-flowing" role="status">Keep flowing temporário ativo apenas para esta tarefa; mantém-se durante esperas/reclaims da mesma tarefa e termina quando ela concluir.</p> : null}
          {selected.role === 'worker' && taskPickerOpen && selected.status === 'idle' && selected.loop_active !== false && !selected.task && !selected.keep_flowing_active && !selectedForeign ? <div className="agent-runtime-task-picker"><div className="agent-runtime-task-picker-heading"><strong>Atribuir tarefas a {selected.label}</strong><small>O Worker executa uma tarefa de cada vez. Keep flowing temporário mantém a tarefa durante as esperas e termina quando ela concluir.</small></div>{availableTasks.length ? <div className="agent-runtime-task-picker-list">{availableTasks.map((task) => <label key={task.task_id}><input type="checkbox" checked={selectedTaskIds.includes(task.task_id)} onChange={(event) => setSelectedTaskIds((current) => event.target.checked ? [...current, task.task_id] : current.filter((id) => id !== task.task_id))}/><span><b>{task.type}</b><small>{task.task_id}</small></span></label>)}</div> : <p>Não existem tarefas por executar neste projeto.</p>}<div className="agent-runtime-task-picker-actions"><select aria-label="Modo das tarefas atribuídas" value={taskAssignmentMode} disabled={busy} onChange={(event) => setTaskAssignmentMode(event.target.value === 'keep_flowing' ? 'keep_flowing' : 'standard')}><option value="standard">Modo atual do Worker</option><option value="keep_flowing">Keep flowing temporário</option></select><button type="button" className="agent-runtime-icon-button" aria-label={selectedTaskIds.length ? `Atribuir ${selectedTaskIds.length}` : 'Atribuir tarefas'} title={selectedTaskIds.length ? `Atribuir ${selectedTaskIds.length} tarefas` : 'Selecione tarefas para atribuir'} disabled={busy || !selectedTaskIds.length} onClick={() => void assignSelectedTasks()}><Icon name="check" size={14}/></button></div></div> : null}
          {selected.role !== 'worker' && <div className="agent-runtime-worker-actions agent-runtime-browser-actions"><button type="button" className="agent-runtime-icon-button" aria-label="Capturar imagem" title="Capturar imagem" disabled={busy || !selected.browser.available} onClick={() => void capture()}><Icon name="camera" size={14}/></button></div>}
          {interactionId === selected.id && selected.role === 'worker' && <div className="agent-runtime-interaction"><div className="agent-runtime-interaction-heading"><strong>Interação ao vivo</strong><span>{selected.task ? 'O Worker continua a executar a tarefa; ações manuais afetam a mesma instância.' : 'Está a interagir diretamente com esta instância.'}</span></div><div ref={interactionHostRef} className="agent-runtime-interaction-host relative" aria-label={`Navegador interativo de ${selected.label}`}><WorkerMirror agentId={selected.id} label={`Espelho interativo de ${selected.label}`} /></div></div>}
          {snapshot?.agentId === selected.id && <figure className="agent-runtime-snapshot"><img src={snapshot.dataUrl} alt={`Captura do navegador de ${selected.label}`}/><figcaption>Capturado às {new Date(snapshot.capturedAt).toLocaleTimeString()}</figcaption></figure>}
        </div>}
      </div>
      </div>}
    </>}
  </section>
}
