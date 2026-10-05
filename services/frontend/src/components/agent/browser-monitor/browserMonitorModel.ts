import { chatgptConversationURL } from '../../../lib/desktop/bridge/desktop'
import type { BrowserMonitorChat } from '../../../lib/transport/http/browser-monitor/catalog'

export const phaseLabels: Record<DesktopAgentRuntimeActivityPhase, string> = {
  claimed: 'A iniciar tarefa', waiting_turn: 'Na fila de envio', navigating: 'A abrir conversa',
  preparing: 'A preparar pedido', uploading: 'A carregar ZIP', submitting: 'A submeter pedido',
  processing: 'GPT a processar', downloading: 'A descarregar resposta', validating: 'A validar resposta',
}

export function activeTask(agent: DesktopAgentRuntimeAgent) {
  return agent.task || (agent.occupied ? agent.last_task : undefined)
}

export type OperationalState = 'idle' | 'waiting' | 'loading' | 'working' | 'writing' | 'listening' | 'chat-empty' | 'paused' | 'error' | 'stopped' | 'draining'

export const stateLegend: { key: OperationalState; label: string; dot: string }[] = [
  { key: 'idle', label: 'Ocioso', dot: 'bg-slate-400' },
  { key: 'waiting', label: 'Na fila / a aguardar', dot: 'bg-amber-400' },
  { key: 'loading', label: 'A abrir conversa', dot: 'bg-yellow-400' },
  { key: 'working', label: 'A preparar / validar', dot: 'bg-emerald-400' },
  { key: 'writing', label: 'A enviar ao GPT', dot: 'bg-violet-400' },
  { key: 'listening', label: 'GPT a processar', dot: 'bg-cyan-400' },
  { key: 'chat-empty', label: 'Chat sem jobs', dot: 'bg-blue-400' },
  { key: 'paused', label: 'Suspenso', dot: 'bg-amber-300' },
  { key: 'error', label: 'Com erro', dot: 'bg-rose-400' },
  { key: 'stopped', label: 'Parado', dot: 'bg-slate-600' },
  { key: 'draining', label: 'A terminar', dot: 'bg-orange-400' },
]

const phaseState: Record<DesktopAgentRuntimeActivityPhase, OperationalState> = {
  claimed: 'working', waiting_turn: 'waiting', navigating: 'loading', preparing: 'working',
  uploading: 'writing', submitting: 'writing', processing: 'listening', downloading: 'working', validating: 'working',
}

export function operationalState(agent: DesktopAgentRuntimeAgent): { key: OperationalState; label: string } {
  if (agent.draining) return { key: 'draining', label: 'A terminar' }
  if (agent.error || agent.status === 'error') return { key: 'error', label: 'Com erro' }
  if (agent.activity && agent.task) return { key: phaseState[agent.activity.phase], label: phaseLabels[agent.activity.phase] }
  if (agent.browser.loading || agent.status === 'loading') return { key: 'loading', label: 'A abrir conversa' }
  if (agent.status === 'stopped' || agent.loop_active === false) return { key: 'stopped', label: 'Parado' }
  const task = activeTask(agent)
  if (agent.role === 'worker' && agent.suspended && !task) return { key: 'paused', label: 'Suspenso' }
  if (task?.type === 'AWAIT_RESPONSE' || ['expected-bundle', 'bundle-delivery'].includes(agent.binding_hold || '')) return { key: 'listening', label: 'GPT a processar' }
  if (task?.status === 'WAITING') return { key: 'waiting', label: 'A aguardar' }
  if (task && ['BOT_WRITE', 'RECOVERY_WRITE', 'ORCHESTRATOR_PLAN'].includes(task.type)) return { key: 'writing', label: 'A enviar ao GPT' }
  if (agent.pinned_task_id && !agent.task) return { key: 'waiting', label: 'A aguardar próxima ronda' }
  if (task?.status === 'WAITING' || (agent.occupied && !agent.task)) return { key: 'waiting', label: 'A aguardar' }
  if (task || agent.occupied || agent.status === 'running' || agent.status === 'claimed') return { key: 'working', label: 'A preparar / validar' }
  if (agent.chat_id) return { key: 'chat-empty', label: 'Chat sem jobs' }
  return { key: 'idle', label: 'Ocioso' }
}

export function activityLabel(agent: DesktopAgentRuntimeAgent) { return operationalState(agent).label }
export function stateDot(key: OperationalState) { return stateLegend.find((state) => state.key === key)?.dot || 'bg-slate-400' }

export function labelPath(path: string) { return path.split('/').filter(Boolean).at(-1) || path || '—' }

export function browserHasPage(agent: DesktopAgentRuntimeAgent) {
  const url = String(agent.browser.url || '').trim()
  return agent.browser.available && Boolean(url && url !== 'about:blank')
}

export function agentForChat(agents: DesktopAgentRuntimeAgent[], chat: BrowserMonitorChat) {
  return agents.find((agent) => agent.browser.available && chatgptConversationURL(agent.browser.url || '') === chat.url
    && (!agent.project_id || agent.project_id === chat.project_path))
}
