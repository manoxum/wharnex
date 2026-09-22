import type { Session } from '../types'
import type { AttentionItem } from './attentionCenter'

export type DesktopTrayStateInput = {
  session: Session
  attentionItems: AttentionItem[]
  activeChatId: string
  tunnelCount: number
  taskInFlight: boolean
}

export function buildDesktopTrayProjectState(input: DesktopTrayStateInput): DesktopTrayProjectState {
  const { session, attentionItems, activeChatId, tunnelCount, taskInFlight } = input
  const activeAttention = attentionItems.filter((item) => item.chatId === activeChatId)
  const plan = session.plan
  const planControl = plan && session.plan_control?.plan_id === plan.plan_id ? session.plan_control.state : 'active'
  const hostApplied = Boolean(plan && session.last_applied_changes?.some((change) => change.plan.plan_id === plan.plan_id))
  const canControlExecution = Boolean(plan
    && session.automation_mode === 'auto_approve'
    && session.execution_mode === 'protected'
    && session.last_turn?.kind !== 'workflow'
    && plan.status === 'ready'
    && !hostApplied)
  return {
    projectPath: session.project_path,
    activeChatId,
    status: taskInFlight ? 'Pedido em curso' : session.state === 'failed' ? 'Atenção necessária' : 'Pronto',
    attentionTotal: attentionItems.length,
    actionable: attentionItems.filter((item) => item.action).length,
    tunnelCount,
    taskInFlight,
    canApproveExecution: activeAttention.some((item) => item.action === 'approve-execution'),
    canContinueRequest: activeAttention.some((item) => item.action === 'retry-transport'),
    canControlExecution,
    planControl,
  }
}

export type DesktopTrayActionHandlers = {
  openNotifications(): void
  openPlan(): void
  openExecution(): void
  approveExecution(): void | Promise<void>
  pauseExecution(): void | Promise<void>
  resumeExecution(): void | Promise<void>
  suspendExecution(): void | Promise<void>
  continueRequest(): void | Promise<void>
  openWorkers(): void
}

export async function dispatchDesktopTrayProjectAction(action: DesktopTrayAction, handlers: DesktopTrayActionHandlers) {
  switch (action) {
    case 'open-notifications': handlers.openNotifications(); return true
    case 'open-plan': handlers.openPlan(); return true
    case 'open-execution': handlers.openExecution(); return true
    case 'approve-execution': await handlers.approveExecution(); return true
    case 'pause-execution': await handlers.pauseExecution(); return true
    case 'resume-execution': await handlers.resumeExecution(); return true
    case 'suspend-execution': await handlers.suspendExecution(); return true
    case 'continue-request': await handlers.continueRequest(); return true
    case 'open-workers': handlers.openWorkers(); return true
    default: return false
  }
}

export function isDesktopTrayTunnelAction(event: DesktopTrayActionEvent, projects: string[]) {
  return event.action === 'open-tunnels' && projects.includes(event.projectPath)
}
