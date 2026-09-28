import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { desktopBridge, elementBounds } from '../lib/desktop'
import { api } from '../lib/api'
import { confirmDialog } from '../lib/appDialog'
import { observeChatGPTOverlayBlockers } from '../lib/chatGPTOverlay'
import type { ChatAgentTask } from '../types'
import { Icon } from './Icon'
import { ContentSkeleton } from './Skeleton'

type Runtime = DesktopAgentRuntimeState

type Snapshot = { agentId: string; dataUrl: string; capturedAt: string }

type OperationalState = 'idle' | 'writing' | 'listening' | 'waiting' | 'chat-empty' | 'working' | 'loading' | 'error' | 'stopped' | 'draining' | 'paused'

const writingTaskTypes = new Set(['BOT_WRITE', 'RECOVERY_WRITE', 'ORCHESTRATOR_PLAN'])

type WorkerTaskTypeOption = readonly [type: string, label: string]
type WorkerTaskTypeGroup = {
  id: string
  label: string
  description: string
  tasks: readonly WorkerTaskTypeOption[]
}

const workerTaskTypeGroups: readonly WorkerTaskTypeGroup[] = [
  {
    id: 'auxiliary',
    label: 'Auxiliar',
    description: 'Manutenção de chats, bundles e títulos.',
    tasks: [
      ['ORGANIZE_CHAT', 'Organizar chat'],
      ['RENAME_CHAT', 'Renomear chat'],
      ['ARCHIVE_CHAT', 'Arquivar chat'],
      ['DELETE_CHAT', 'Eliminar chat'],
      ['DELETE_TEMP_CHAT', 'Eliminar chat temporário'],
      ['DELETE_BUNDLE', 'Eliminar bundle'],
      ['TITLE_DISCOVER', 'Descobrir título'],
      ['TITLE_GENERATE_TEMP', 'Gerar título temporário'],
      ['TITLE_AWAIT', 'Aguardar título'],
    ],
  },
  {
    id: 'functional',
    label: 'Funcional',
    description: 'Trabalho funcional delegado ao pool de Workers.',
    tasks: [
      ['TODO_CLASSIFY', 'Classificar TODO'],
    ],
  },
]

// One entry per colour the list can show. A running task can be in several
// of them (preparing, sending, waiting for ChatGPT), so each entry names the
// phases it covers rather than the durable task status.
const stateLegend: { key: OperationalState; label: string; hint: string }[] = [
  { key: 'idle', label: 'Ocioso', hint: 'Sem tarefa' },
  { key: 'waiting', label: 'Na fila / a aguardar', hint: 'Na fila de envio do ritmo global, tarefa em espera, ou Worker preso à sua tarefa entre rondas' },
  { key: 'loading', label: 'A abrir conversa', hint: 'A navegar ou a carregar a página do ChatGPT' },
  { key: 'working', label: 'A preparar / validar', hint: 'A iniciar, a preparar o pedido, a descarregar ou a validar a resposta' },
  { key: 'writing', label: 'A enviar ao GPT', hint: 'A carregar o ZIP, a submeter ou a escrever no chat' },
  { key: 'listening', label: 'GPT a processar', hint: 'Pedido submetido; o ChatGPT está a gerar a resposta' },
  { key: 'chat-empty', label: 'Chat sem jobs', hint: 'Supervisor com chat mas sem trabalho' },
  { key: 'paused', label: 'Suspenso', hint: 'Workers suspensos pela política' },
  { key: 'error', label: 'Com erro', hint: 'A última tentativa falhou' },
  { key: 'stopped', label: 'Parado', hint: 'Loop do agente parado' },
  { key: 'draining', label: 'A terminar', hint: 'A sair do pool após reduzir o número de agentes' },
]

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

function statusLabel(agent: DesktopAgentRuntimeAgent) {
  const label = agentOperationalState(agent).label
  return agent.interacting ? `Interação · ${label}` : label
}

function short(value?: string, fallback = '—') {
  const text = String(value || '').trim()
  return text || fallback
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

function timeLabel(value?: string) {
  const text = String(value || '').trim()
  if (!text) return '—'
  const date = new Date(text)
  return Number.isNaN(date.getTime()) ? text : date.toLocaleString()
}

function durationLabel(value?: number) {
  const ms = Math.max(0, Number(value || 0))
  if (!ms) return '—'
  const seconds = Math.round(ms / 1000)
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  const rest = seconds % 60
  return rest ? `${minutes}m ${rest}s` : `${minutes}m`
}

function memoryLabel(value?: number, available = true) {
  if (!available) return '—'
  const bytes = Math.max(0, Number(value || 0))
  const mib = bytes / (1024 * 1024)
  if (mib >= 1024) return `${(mib / 1024).toFixed(2)} GiB`
  return `${mib >= 100 ? Math.round(mib) : mib.toFixed(1)} MiB`
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
  const [overlayBlocked, setOverlayBlocked] = useState(false)
  const [busy, setBusy] = useState(false)
  const [workerPauseMode, setWorkerPauseMode] = useState<'timed' | 'manual'>('timed')
  const [workerPauseMinutes, setWorkerPauseMinutes] = useState('60')
  const [workerPauseScope, setWorkerPauseScope] = useState<'all' | 'types'>('all')
  const [workerPauseTaskTypes, setWorkerPauseTaskTypes] = useState<string[]>([])
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

  useEffect(() => observeChatGPTOverlayBlockers(window, (blocked) => {
    if (blocked && interactionId) void bridge?.closeInteraction(interactionId).catch(() => {})
    setOverlayBlocked(blocked)
  }), [bridge, interactionId])

  useEffect(() => {
    if (!bridge || !interactionId || selected?.id !== interactionId || selected.role !== 'worker') return
    if (overlayBlocked) {
      void bridge.closeInteraction(interactionId).catch(() => {})
      return
    }
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
      cancelAnimationFrame(frame)
      observer?.disconnect()
      window.removeEventListener('resize', sync)
      window.removeEventListener('scroll', sync, true)
      void bridge.closeInteraction(interactionId).catch(() => {})
    }
  }, [bridge, interactionId, selected?.id, selected?.role, overlayBlocked])

  const scaleSupervisors = async (delta: number) => {
    if (!bridge || !runtime) return
    const configured = runtime.configured_supervisors || runtime.desired_supervisors
    const next = Math.max(runtime.limits.min_supervisors, Math.min(runtime.limits.max_supervisors, configured + delta))
    if (next === configured) return
    setBusy(true)
    try { setRuntime(await bridge.setSupervisorCount(next)) } catch (error) { onError?.(error instanceof Error ? error.message : 'Não foi possível escalar os supervisores') } finally { setBusy(false) }
  }

  const scaleWorkers = async (delta: number) => {
    if (!bridge || !runtime) return
    const configured = runtime.configured_workers || runtime.desired_workers
    const next = Math.max(runtime.limits.min_workers, Math.min(runtime.limits.max_workers, configured + delta))
    if (next === configured) return
    setBusy(true)
    try { setRuntime(await bridge.setWorkerCount(next)) } catch (error) { onError?.(error instanceof Error ? error.message : 'Não foi possível escalar os workers') } finally { setBusy(false) }
  }

  const updatePolicies = async (changes: { auto_scale?: boolean; auto_scale_max_supervisors?: number; auto_scale_max_workers?: number; keep_flowing_global?: boolean; rate_limit_cooldown_minutes?: number }) => {
    if (!bridge) return
    setBusy(true)
    try { setRuntime(await bridge.setPolicies(changes)) } catch (error) { onError?.(error instanceof Error ? error.message : 'Não foi possível atualizar as políticas') } finally { setBusy(false) }
  }

  const scaleAutoScaleCeiling = async (delta: number) => {
    if (!runtime) return
    const ceiling = runtime.policies.auto_scale_max_workers || runtime.limits.max_workers
    const next = Math.max(runtime.limits.min_workers, Math.min(runtime.limits.max_workers, ceiling + delta))
    if (next === ceiling) return
    await updatePolicies({ auto_scale_max_workers: next })
  }

  const scaleAutoScaleSupervisorCeiling = async (delta: number) => {
    if (!runtime) return
    const ceiling = runtime.policies.auto_scale_max_supervisors || runtime.limits.max_supervisors
    const next = Math.max(runtime.limits.min_supervisors, Math.min(runtime.limits.max_supervisors, ceiling + delta))
    if (next === ceiling) return
    await updatePolicies({ auto_scale_max_supervisors: next })
  }

  const setWorkerKeepFlowing = async (agentId: string, enabled: boolean) => {
    if (!bridge) return
    setBusy(true)
    try { setRuntime(await bridge.setWorkerKeepFlowing(agentId, enabled)) } catch (error) { onError?.(error instanceof Error ? error.message : 'Não foi possível atualizar Keep flowing neste Worker') } finally { setBusy(false) }
  }

  const suspendWorkers = async () => {
    if (!bridge) return
    if (workerPauseScope === 'types' && workerPauseTaskTypes.length === 0) {
      onError?.('Selecione pelo menos um tipo de tarefa para suspender.')
      return
    }
    let pausedUntil: string | undefined
    if (workerPauseMode === 'timed') {
      const minutes = Number(workerPauseMinutes)
      if (!Number.isFinite(minutes) || minutes < 1 || minutes > 10_080) {
        onError?.('Defina uma duração dos Workers entre 1 minuto e 7 dias.')
        return
      }
      pausedUntil = new Date(Date.now() + Math.floor(minutes) * 60_000).toISOString()
    }
    setBusy(true)
    try { setRuntime(await bridge.pauseWorkers(pausedUntil, workerPauseScope === 'types' ? workerPauseTaskTypes : [])) } catch (error) { onError?.(error instanceof Error ? error.message : 'Não foi possível suspender os Workers') } finally { setBusy(false) }
  }

  // Releasing early skips the cooldown that protects the account, so it is an
  // explicit, confirmed operator decision.
  const releaseRateLimit = async () => {
    if (!bridge) return
    const confirmed = await confirmDialog({
      title: 'Libertar suspensão por rate limit?',
      message: 'Os Workers voltam a enviar pedidos ao ChatGPT antes do fim do cooldown. Se a conta ainda estiver limitada, um novo HTTP 429 abre outra suspensão.',
      tone: 'warning', confirmLabel: 'Libertar agora', cancelLabel: 'Manter suspensão',
    })
    if (!confirmed) return
    setBusy(true)
    try { setRuntime(await bridge.resumeProvider()) } catch (error) { onError?.(error instanceof Error ? error.message : 'Não foi possível libertar a suspensão por rate limit') } finally { setBusy(false) }
  }

  const resumeWorkers = async () => {
    if (!bridge) return
    setBusy(true)
    try { setRuntime(await bridge.resumeWorkers()) } catch (error) { onError?.(error instanceof Error ? error.message : 'Não foi possível retomar os Workers') } finally { setBusy(false) }
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

  // Following a Worker places it in the Engine area; it does not dismiss this
  // panel. The drawer closes only when the operator asks it to, so watching a
  // Worker never costs them the runtime view they were reading.
  const followWorker = () => {
    if (!bridge || !selected || selected.role !== 'worker' || !selected.browser.available || selectedForeign) return
    const agentId = selected.id
    void (async () => {
      if (interactionId === agentId) {
        await bridge.closeInteraction(agentId)
        setInteractionId(undefined)
      }
      await bridge.openMonitor(agentId)
      window.dispatchEvent(new CustomEvent('wharnex:agent-follow', { detail: { agentId } }))
    })().catch((error) => onErrorRef.current?.(error instanceof Error ? error.message : 'Não foi possível abrir a janela do Worker'))
  }

  const selectRuntimeTab = (tab: 'agents' | 'runtime' | 'policies') => {
    if (tab !== 'agents') setInteractionId(undefined)
    setActiveTab(tab)
  }

  if (!bridge) return <section className="agent-runtime-drawer" aria-label="Gestão de agentes">
    <header className="agent-drawer-heading"><div><span className="panel-kicker">Runtime local</span><strong>Agentes</strong></div><button type="button" className="agent-drawer-icon" onClick={onClose} aria-label="Fechar agentes"><Icon name="close" size={13}/></button></header>
    <div className="agent-drawer-empty"><strong>Bridge preload indisponível.</strong><span>Abra esta área no Wharnex Desktop/Electron. Sem a bridge não é possível distinguir o scheduler, o backend ou os browsers dos Workers.</span></div>
  </section>

  return <section className="agent-runtime-drawer" aria-label="Gestão de agentes">
    <header className="agent-drawer-heading"><div><span className="panel-kicker">Runtime ChatGPT</span><strong>Agentes</strong></div><div className="agent-runtime-heading-actions"><button type="button" className="agent-drawer-icon" onClick={() => void refresh()} aria-label="Atualizar agentes"><Icon name="refresh" size={13}/></button><button type="button" className="agent-drawer-icon" onClick={onClose} aria-label="Fechar agentes"><Icon name="close" size={13}/></button></div></header>
    {!runtime ? <ContentSkeleton label="A carregar instâncias do runtime" rows={6}/> : <>
      <div className="agent-runtime-summary"><span><b>{runtime.agents.length}</b><small>instâncias</small></span><span><b>{running}</b><small>ocupadas</small></span><span><b>{elsewhere}</b><small>noutro projeto</small></span><span><b>{runtime.desired_workers}</b><small>{runtime.policies?.auto_scaled_workers ? `${runtime.configured_workers} base · +${runtime.policies.auto_scaled_workers} auto` : 'workers'}</small></span></div>
      <div className="agent-runtime-tabs" role="tablist" aria-label="Áreas do painel de agentes">
        <button type="button" role="tab" aria-selected={activeTab === 'agents'} className={activeTab === 'agents' ? 'active' : ''} onClick={() => selectRuntimeTab('agents')}><Icon name="agent" size={14}/><span className="semantic-tab-label">Agentes</span><small>{runtime.agents.length}</small></button>
        <button type="button" role="tab" aria-selected={activeTab === 'runtime'} className={activeTab === 'runtime' ? 'active' : ''} onClick={() => selectRuntimeTab('runtime')}><Icon name="monitor" size={14}/><span className="semantic-tab-label">Runtime</span><small>{runtime.scheduler?.running ? 'online' : 'atenção'}</small></button>
        <button type="button" role="tab" aria-selected={activeTab === 'policies'} className={activeTab === 'policies' ? 'active' : ''} onClick={() => selectRuntimeTab('policies')}><Icon name="settings" size={14}/><span className="semantic-tab-label">Políticas</span><small>{runtime.policies.auto_scale ? 'auto' : 'manual'}</small></button>
      </div>
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
        <section className="agent-runtime-policy-section" aria-label="Proteção do provedor">
          <header className="agent-runtime-policy-heading">
            <div><span>Proteção do provedor</span><h3>Retoma e rate limit</h3></div>
            <small>Controla quando os Workers param, retomam e voltam a pressionar o ChatGPT.</small>
          </header>
          <div className="agent-runtime-policy-grid">
            <div className={`agent-runtime-worker-policy agent-runtime-policy-wide${runtime.worker_pause?.paused ? ' is-paused' : ''}`}>
              <div className="agent-runtime-worker-policy-heading">
                <div className="agent-runtime-pause-copy"><span className="agent-runtime-policy-chip">Workers</span><strong>Cooldown durável dos Workers</strong><small>{runtime.worker_pause?.paused ? `${runtime.worker_pause.task_types?.length ? `${runtime.worker_pause.task_types.length} tipos suspensos` : 'Todos os tipos suspensos'} · ${runtime.worker_pause.paused_until ? `retoma automática em ${timeLabel(runtime.worker_pause.paused_until)}` : 'aguardam liberação manual'}` : 'Suspenda todos os novos claims ou apenas famílias de tarefas; o trabalho em curso termina normalmente.'}</small></div>
                {runtime.worker_pause?.paused && <button type="button" className="agent-runtime-icon-button tone-success" disabled={busy} onClick={() => void resumeWorkers()} aria-label="Retomar Workers" title="Retomar Workers"><Icon name="play" size={14}/></button>}
              </div>
              {!runtime.worker_pause?.paused && <>
                <div className="agent-runtime-pause-controls agent-runtime-worker-policy-controls"><select aria-label="Âmbito da suspensão dos Workers" value={workerPauseScope} disabled={busy} onChange={(event) => setWorkerPauseScope(event.target.value === 'types' ? 'types' : 'all')}><option value="all">Todos os tipos</option><option value="types">Tipos selecionados</option></select><select aria-label="Modo de retoma dos Workers" value={workerPauseMode} disabled={busy} onChange={(event) => setWorkerPauseMode(event.target.value === 'manual' ? 'manual' : 'timed')}><option value="timed">Retoma automática</option><option value="manual">Liberação manual</option></select>{workerPauseMode === 'timed' && <label><input aria-label="Minutos até retoma dos Workers" type="number" min="1" max="10080" step="1" value={workerPauseMinutes} disabled={busy} onChange={(event) => setWorkerPauseMinutes(event.target.value)}/><span>min</span></label>}<button type="button" className="agent-runtime-icon-button tone-warning" disabled={busy} onClick={() => void suspendWorkers()} aria-label="Suspender Workers" title="Suspender Workers"><Icon name="pause" size={14}/></button></div>
                {workerPauseScope === 'types' && <fieldset className="agent-runtime-task-suspension"><legend>Tipos de tarefa a suspender</legend><div className="agent-runtime-task-tree"><div className="agent-runtime-task-tree-root"><span className="agent-runtime-task-tree-node-mark" aria-hidden="true"><Icon name="list" size={13}/></span><span><strong>Task</strong><small>Organize a suspensão por finalidade, sem perder o controlo por tipo.</small></span><em>{workerPauseTaskTypes.length} selecionados</em></div><div className="agent-runtime-task-tree-branches">{workerTaskTypeGroups.map((group) => { const selectedCount = group.tasks.filter(([type]) => workerPauseTaskTypes.includes(type)).length; const allSelected = selectedCount === group.tasks.length; return <section key={group.id} className="agent-runtime-task-tree-group" aria-label={group.label}><header><label><input type="checkbox" aria-label={`Suspender grupo ${group.label}`} checked={allSelected} disabled={busy} onChange={(event) => { const checked = event.currentTarget.checked; const types = group.tasks.map(([type]) => type); setWorkerPauseTaskTypes((current) => { const next = new Set(current); for (const type of types) { if (checked) next.add(type); else next.delete(type) } return [...next] }) }}/><span><strong>{group.label}</strong><small>{group.description}</small></span></label><em>{selectedCount}/{group.tasks.length}</em></header><div>{group.tasks.map(([type, label]) => <label key={type} className="agent-runtime-task-tree-leaf"><input type="checkbox" checked={workerPauseTaskTypes.includes(type)} disabled={busy} onChange={(event) => setWorkerPauseTaskTypes((current) => event.target.checked ? [...current, type] : current.filter((item) => item !== type))}/><span>{label}</span><code>{type}</code></label>)}</div></section> })}</div></div></fieldset>}
              </>}
            </div>
            <div className={`agent-runtime-scale-card agent-runtime-rate-limit-policy agent-runtime-policy-wide${runtime.provider?.paused ? ' is-paused' : ''}`}>
              <div><strong>Suspensão automática por rate limit</strong><small>Após HTTP 429 ou gate estrutural, apenas os Workers entram em cooldown; Supervisores e Translator permanecem ativos.</small>{runtime.provider?.paused && <span className="agent-runtime-inline-status">Rate limit ativo · {runtime.provider.paused_until ? `retoma em ${timeLabel(runtime.provider.paused_until)}` : short(runtime.provider.reason, 'aguarda liberação do provider')}</span>}{runtime.provider?.paused && <button type="button" className="agent-runtime-icon-button tone-success" disabled={busy} onClick={() => void releaseRateLimit()} aria-label="Libertar suspensão por rate limit" title="Libertar suspensão por rate limit agora"><Icon name="play" size={14}/></button>}</div>
              <label className="agent-runtime-number-policy"><input key={runtime.policies.rate_limit_cooldown_minutes} aria-label="Minutos de suspensão automática por rate limit" type="number" min="1" max="60" step="0.5" defaultValue={runtime.policies.rate_limit_cooldown_minutes} disabled={busy} onBlur={(event) => { const minutes = Number(event.currentTarget.value); if (!Number.isFinite(minutes) || minutes < 1 || minutes > 60) { event.currentTarget.value = String(runtime.policies.rate_limit_cooldown_minutes); onError?.('Defina a suspensão automática entre 1 e 60 minutos.'); return } void updatePolicies({ rate_limit_cooldown_minutes: minutes }) }}/><span>min</span></label>
            </div>
          </div>
        </section>

        <section className="agent-runtime-policy-section" aria-label="Capacidade dos agentes">
          <header className="agent-runtime-policy-heading">
            <div><span>Capacidade</span><h3>Pool base e limites</h3></div>
            <small>Ajusta a capacidade permanente e os tetos usados pelo crescimento automático.</small>
          </header>
          <div className="agent-runtime-policy-grid">
            <div className="agent-runtime-scale-card"><div><strong>Supervisores</strong><small>Um por chat: abre a conversa, envia e recolhe o bundle, e só liberta o chat quando o pedido termina.</small></div><div className="agent-runtime-stepper"><button disabled={busy || runtime.configured_supervisors <= runtime.limits.min_supervisors} onClick={() => void scaleSupervisors(-1)} aria-label="Diminuir supervisores" title="Diminuir supervisores"><Icon name="minus" size={13}/></button><b>{runtime.configured_supervisors}</b><button disabled={busy || runtime.configured_supervisors >= runtime.limits.max_supervisors} onClick={() => void scaleSupervisors(1)} aria-label="Aumentar supervisores" title="Aumentar supervisores"><Icon name="plus" size={13}/></button></div></div>
            <div className="agent-runtime-scale-card"><div><strong>Workers</strong><small>Base configurada; extras podem ser geridos por Auto scale.</small></div><div className="agent-runtime-stepper"><button disabled={busy || runtime.configured_workers <= runtime.limits.min_workers} onClick={() => void scaleWorkers(-1)} aria-label="Diminuir workers" title="Diminuir workers"><Icon name="minus" size={13}/></button><b>{runtime.configured_workers}</b><button disabled={busy || runtime.configured_workers >= runtime.limits.max_workers} onClick={() => void scaleWorkers(1)} aria-label="Aumentar workers" title="Aumentar workers"><Icon name="plus" size={13}/></button></div></div>
            <div className="agent-runtime-scale-card"><div><strong>Teto Auto scale Supervisores</strong><small>Máximo total de Supervisores que o Auto scale pode atingir; a base manual nunca é reduzida por este teto.</small></div><div className="agent-runtime-stepper"><button disabled={busy || runtime.policies.auto_scale_max_supervisors <= runtime.limits.min_supervisors} onClick={() => void scaleAutoScaleSupervisorCeiling(-1)} aria-label="Diminuir teto Auto scale Supervisores" title="Diminuir teto Auto scale Supervisores"><Icon name="minus" size={13}/></button><b>{runtime.policies.auto_scale_max_supervisors}</b><button disabled={busy || runtime.policies.auto_scale_max_supervisors >= runtime.limits.max_supervisors} onClick={() => void scaleAutoScaleSupervisorCeiling(1)} aria-label="Aumentar teto Auto scale Supervisores" title="Aumentar teto Auto scale Supervisores"><Icon name="plus" size={13}/></button></div></div>
            <div className="agent-runtime-scale-card"><div><strong>Teto Auto scale Workers</strong><small>Máximo total de Workers que o Auto scale pode atingir; a base manual nunca é reduzida por este teto.</small></div><div className="agent-runtime-stepper"><button disabled={busy || runtime.policies.auto_scale_max_workers <= runtime.limits.min_workers} onClick={() => void scaleAutoScaleCeiling(-1)} aria-label="Diminuir teto Auto scale" title="Diminuir teto Auto scale"><Icon name="minus" size={13}/></button><b>{runtime.policies.auto_scale_max_workers}</b><button disabled={busy || runtime.policies.auto_scale_max_workers >= runtime.limits.max_workers} onClick={() => void scaleAutoScaleCeiling(1)} aria-label="Aumentar teto Auto scale" title="Aumentar teto Auto scale"><Icon name="plus" size={13}/></button></div></div>
          </div>
        </section>

        <section className="agent-runtime-policy-section" aria-label="Automação dos Workers">
          <header className="agent-runtime-policy-heading">
            <div><span>Automação</span><h3>Comportamento dos Workers</h3></div>
            <small>Define como o pool cresce e por quanto tempo cada Worker permanece dedicado a um pedido.</small>
          </header>
          <div className="agent-runtime-policy-grid">
            <div className="agent-runtime-scale-card"><div><strong>Auto scale</strong><small>Cria um Worker extra quando chega trabalho executável e todos os Workers ativos estão ocupados, até ao teto configurado.</small></div><button type="button" className="agent-runtime-icon-button agent-runtime-toggle" aria-pressed={runtime.policies.auto_scale} aria-label={runtime.policies.auto_scale ? 'Ativo' : 'Inativo'} title={runtime.policies.auto_scale ? 'Desativar Auto scale' : 'Ativar Auto scale'} disabled={busy} onClick={() => void updatePolicies({ auto_scale: !runtime.policies.auto_scale })}><Icon name="agent" size={14}/></button></div>
            <div className="agent-runtime-scale-card"><div><strong>Keep flowing</strong><small>Globalmente fixa cada Worker ao pedido até existir um bundle válido entregue ao processamento; 429 suspende sem abandonar a tarefa.</small></div><button type="button" className="agent-runtime-icon-button agent-runtime-toggle" aria-pressed={runtime.policies.keep_flowing_global} aria-label={runtime.policies.keep_flowing_global ? 'Global ativo' : 'Global inativo'} title={runtime.policies.keep_flowing_global ? 'Desativar Keep flowing global' : 'Ativar Keep flowing global'} disabled={busy} onClick={() => void updatePolicies({ keep_flowing_global: !runtime.policies.keep_flowing_global })}><Icon name="refresh" size={14}/></button></div>
          </div>
        </section>
      </div>}
      {activeTab === 'agents' && <div className="agent-runtime-tab-panel agents" role="tabpanel">
      <div className="agent-runtime-state-legend" aria-label="Legenda dos estados dos agentes">
        {stateLegend.map(({ key, label, hint }) => <span key={key} title={hint}><i className={`agent-runtime-dot state-${key}`} aria-hidden="true"/>{label}</span>)}
      </div>
      <div className="agent-runtime-body">
        <div className="agent-runtime-list" role="list" aria-label="Instâncias de agentes">{runtime.agents.map((agent) => { const foreign = foreignProject(agent, projectPath); const operational = agentOperationalState(agent); return <button type="button" role="listitem" key={agent.id} className={`${selected?.id === agent.id ? 'active ' : ''}state-${operational.key}${foreign ? ' foreign-project' : ''}`} onClick={() => { setSelectedId(agent.id); setInteractionId(undefined); setSnapshot(undefined) }}>
          <span className={`agent-runtime-dot state-${operational.key}`} aria-hidden="true"/><span><strong>{agent.label}</strong><small>{agent.role === 'supervisor' ? 'Supervisor' : 'Worker'} · {statusLabel(agent)}{agent.keep_flowing_active ? ' · Keep flowing' : ''}</small>{foreign ? <em className="agent-runtime-foreign" title={`Ocupado com uma tarefa do projeto ${foreign}`}>Outro projeto · {projectLabel(foreign)}</em> : null}</span><span className="agent-runtime-agent-stats">{engagedTask(agent) && <code>{engagedTask(agent)?.type}</code>}<code className="agent-runtime-memory-pill">{memoryLabel(agent.memory?.rss_bytes, agent.memory?.available)}</code></span>
        </button> })}</div>
        {selected && <div className="agent-runtime-detail">
          <div className={`agent-runtime-detail-heading state-${agentOperationalState(selected).key}`}><div><span className={`agent-runtime-dot state-${agentOperationalState(selected).key}`} aria-hidden="true"/><strong>{selected.label}</strong></div><span className="agent-runtime-status-pill">{statusLabel(selected)}</span></div>
          {/* Naming the owning project explains the occupancy; nothing else
              about that project's task crosses this boundary. */}
          {selectedForeign ? <p className="agent-runtime-foreign-note" role="status">Ocupado com uma tarefa do projeto <b title={selectedForeign}>{projectLabel(selectedForeign)}</b>. Fica disponível para este projeto quando terminar.</p> : null}
          {(() => { const task = selectedEngagedTask || selected.last_task; return <dl><div><dt>Loop</dt><dd>{selected.loop_active === false ? 'Parado' : 'Ativo'}</dd></div>
            {/* The chat is named, not identified by its opaque id, and the name
                is a way in: the operator reading this panel is looking for the
                conversation, not for the string that addresses it. */}
            <div><dt>Chat</dt><dd className="agent-runtime-link-value">{selectedChat
              ? <><span title={selected.chat_id}>{selectedChat.title}</span><button type="button" className="agent-runtime-inline-link" title={`Abrir o chat ${selectedChat.title}`} aria-label={`Abrir o chat ${selectedChat.title}`} onClick={() => onGoToChat?.(selectedChat.id, selectedChat.sessionId)} disabled={!onGoToChat}><Icon name="external" size={12}/></button></>
              : selectedForeign && selected.chat_id ? <span>Conversa do projeto {projectLabel(selectedForeign)}</span>
              : short(selected.chat_id)}</dd></div>
            {/* The pool is shared, so which project a slot is working for is
                part of reading it — and reaching that project is one click,
                whether it is bound in this window or open in another. */}
            <div><dt>Projeto</dt><dd className="agent-runtime-link-value">{selectedProject
              ? <><span title={selectedProject}>{projectLabel(selectedProject)}</span>{selectedProject !== projectPath && <button type="button" className="agent-runtime-inline-link" title={`Trazer o projeto ${projectLabel(selectedProject)} para foco`} aria-label={`Trazer o projeto ${projectLabel(selectedProject)} para foco`} onClick={() => onFocusProject?.(selectedProject)} disabled={!onFocusProject}><Icon name="workspace" size={12}/></button>}</>
              : '—'}</dd></div>
            {selected.role === 'supervisor' && <div><dt>Vínculo</dt><dd>{selected.binding_hold ? `Retido · ${selected.binding_hold}` : selected.chat_id ? 'Livre para outro chat' : 'Sem chat'}</dd></div>}<div><dt>Tarefa</dt><dd>{task ? `${task.type} · ${task.task_id}${selectedEngagedTask ? '' : ' · última'}` : 'Sem tarefa registada'}</dd></div><div><dt>Task state</dt><dd>{short(task?.status)}</dd></div><div><dt>Pedido</dt><dd>{short(task?.request_id)}</dd></div><div><dt>Lineage</dt><dd>{short(task?.root_request_id)}</dd></div><div><dt>Conversa</dt><dd>{short(task?.conversation_id)}</dd></div><div><dt>Tentativa</dt><dd>{task ? `${task.attempt}/${task.max_attempts}` : '—'}</dd></div><div><dt>Último claim</dt><dd>{timeLabel(selected.last_claim_at)}</dd></div>{selected.residency && <><div><dt>Residência</dt><dd>{short(selected.residency.resident_lane)} · rotação #{selected.residency.rotation_position + 1}</dd></div><div><dt>Dwell mínimo</dt><dd>{timeLabel(selected.residency.min_resident_until)}</dd></div><div><dt>Assignment epoch</dt><dd>{selected.residency.assignment_epoch}{selected.residency.navigation_in_progress ? ' · a navegar' : ''}{selected.residency.non_preemptive ? ' · não preemptível' : ''}</dd></div></>}<div><dt>Lease</dt><dd>{timeLabel(task?.lease_expires_at)}</dd></div><div><dt>not_before</dt><dd>{timeLabel(task?.not_before)}</dd></div><div><dt>Estado</dt><dd>{statusLabel(selected)}{selected.error || task?.last_error ? ` · ${selected.error || task?.last_error}` : ''}</dd></div>{selected.activity && selected.task ? <div><dt>Fase desde</dt><dd>{timeLabel(selected.activity.since)}</dd></div> : null}<div><dt>RAM (RSS)</dt><dd>{memoryLabel(selected.memory?.rss_bytes, selected.memory?.available)}{selected.memory?.shared_process ? ' · processo partilhado' : ''}</dd></div><div><dt>Navegador</dt><dd>{selected.browser.available ? `WebContents #${selected.browser.web_contents_id} · PID ${selected.browser.os_process_id || '—'}` : 'Ainda não criado'}</dd></div><div><dt>Página</dt><dd title={selected.browser.url}>{short(selected.browser.title || selected.browser.url, selected.browser.available ? 'Sem página carregada' : '—')}</dd></div></dl> })()}
          {selected.role === 'worker' && <div className="agent-runtime-worker-actions"><button type="button" className="agent-runtime-icon-button" aria-pressed={selected.keep_flowing || runtime.policies.keep_flowing_global} aria-label={runtime.policies.keep_flowing_global ? 'Keep flowing · global' : selected.keep_flowing ? 'Keep flowing · ativo' : 'Keep flowing · inativo'} title={runtime.policies.keep_flowing_global ? 'Keep flowing global ativo' : selected.keep_flowing ? 'Desativar Keep flowing neste Worker' : 'Ativar Keep flowing neste Worker'} disabled={busy || runtime.policies.keep_flowing_global} onClick={() => void setWorkerKeepFlowing(selected.id, !selected.keep_flowing)}><Icon name="refresh" size={14}/></button>{selected.task && !selectedForeign && !runtime.policies.keep_flowing_global && !selected.keep_flowing && !selected.task.keep_flowing ? <button type="button" className="agent-runtime-icon-button" aria-label="Keep flowing nesta tarefa" title="Keep flowing nesta tarefa" disabled={busy} onClick={() => void enableTaskKeepFlowing()}><Icon name="refresh" size={14}/></button> : null}{!selected.task && selected.status === 'idle' && selected.loop_active !== false && !selected.keep_flowing_active && !selectedForeign ? <button type="button" className="agent-runtime-icon-button" aria-label="Selecionar tarefas" title={taskPickerOpen ? 'Fechar seleção de tarefas' : 'Selecionar tarefas'} disabled={busy} onClick={() => taskPickerOpen ? setTaskPickerOpen(false) : void loadAssignableTasks()}><Icon name="list" size={14}/></button> : null}<button type="button" className="agent-runtime-icon-button" aria-label="Seguir (flow)" title="Seguir Worker no flow" disabled={busy || !selected.browser.available || Boolean(selectedForeign)} onClick={followWorker}><Icon name="monitor" size={14}/></button><button type="button" className="agent-runtime-icon-button" aria-pressed={interactionId === selected.id} aria-label={interactionId === selected.id ? 'Terminar interação' : 'Interagir aqui'} title={interactionId === selected.id ? 'Terminar interação' : selectedEngagedTask ? 'Abrir a instância em tamanho real durante a tarefa' : 'Interagir aqui'} disabled={busy || !selected.browser.available || Boolean(selectedForeign)} onClick={() => selectedEngagedTask ? followWorker() : setInteractionId(interactionId === selected.id ? undefined : selected.id)}><Icon name="cursor" size={14}/></button><button type="button" className="agent-runtime-icon-button" aria-label="Capturar imagem" title="Capturar imagem" disabled={busy || !selected.browser.available || Boolean(selectedForeign)} onClick={() => void capture()}><Icon name="camera" size={14}/></button></div>}
          {selected.role === 'worker' && selected.keep_flowing_active && (selected.task?.keep_flowing || selected.last_task?.keep_flowing) && !selected.keep_flowing && !runtime.policies.keep_flowing_global ? <p className="agent-runtime-task-keep-flowing" role="status">Keep flowing temporário ativo apenas para esta tarefa; mantém-se durante esperas/reclaims da mesma tarefa e termina quando ela concluir.</p> : null}
          {selected.role === 'worker' && taskPickerOpen && selected.status === 'idle' && selected.loop_active !== false && !selected.task && !selected.keep_flowing_active && !selectedForeign ? <div className="agent-runtime-task-picker"><div className="agent-runtime-task-picker-heading"><strong>Atribuir tarefas a {selected.label}</strong><small>O Worker executa uma tarefa de cada vez. Keep flowing temporário mantém a tarefa durante as esperas e termina quando ela concluir.</small></div>{availableTasks.length ? <div className="agent-runtime-task-picker-list">{availableTasks.map((task) => <label key={task.task_id}><input type="checkbox" checked={selectedTaskIds.includes(task.task_id)} onChange={(event) => setSelectedTaskIds((current) => event.target.checked ? [...current, task.task_id] : current.filter((id) => id !== task.task_id))}/><span><b>{task.type}</b><small>{task.task_id}</small></span></label>)}</div> : <p>Não existem tarefas por executar neste projeto.</p>}<div className="agent-runtime-task-picker-actions"><select aria-label="Modo das tarefas atribuídas" value={taskAssignmentMode} disabled={busy} onChange={(event) => setTaskAssignmentMode(event.target.value === 'keep_flowing' ? 'keep_flowing' : 'standard')}><option value="standard">Modo atual do Worker</option><option value="keep_flowing">Keep flowing temporário</option></select><button type="button" className="agent-runtime-icon-button" aria-label={selectedTaskIds.length ? `Atribuir ${selectedTaskIds.length}` : 'Atribuir tarefas'} title={selectedTaskIds.length ? `Atribuir ${selectedTaskIds.length} tarefas` : 'Selecione tarefas para atribuir'} disabled={busy || !selectedTaskIds.length} onClick={() => void assignSelectedTasks()}><Icon name="check" size={14}/></button></div></div> : null}
          {selected.role !== 'worker' && <div className="agent-runtime-worker-actions agent-runtime-browser-actions"><button type="button" className="agent-runtime-icon-button" aria-label="Capturar imagem" title="Capturar imagem" disabled={busy || !selected.browser.available} onClick={() => void capture()}><Icon name="camera" size={14}/></button></div>}
          {interactionId === selected.id && selected.role === 'worker' && <div className="agent-runtime-interaction"><div className="agent-runtime-interaction-heading"><strong>Interação ao vivo</strong><span>{selected.task ? 'O Worker continua a executar a tarefa; ações manuais afetam a mesma instância.' : 'Está a interagir diretamente com esta instância.'}</span></div><div ref={interactionHostRef} className="agent-runtime-interaction-host" aria-label={`Navegador interativo de ${selected.label}`}/></div>}
          {snapshot?.agentId === selected.id && <figure className="agent-runtime-snapshot"><img src={snapshot.dataUrl} alt={`Captura do navegador de ${selected.label}`}/><figcaption>Capturado às {new Date(snapshot.capturedAt).toLocaleTimeString()}</figcaption></figure>}
        </div>}
      </div>
      </div>}
    </>}
  </section>
}
