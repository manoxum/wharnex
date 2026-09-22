const TEXT_LIMITS = { status: 120, chatId: 256 }

function boundedText(value, limit) {
  return String(value || '').trim().slice(0, limit)
}

export function projectAccentHSL(projectPath) {
  let hash = 2166136261
  const value = String(projectPath || '')
  for (let index = 0; index < value.length; index += 1) hash = Math.imul(hash ^ value.charCodeAt(index), 16777619)
  const hue = ((hash >>> 0) % 360 + 360) % 360
  return `hsl(${hue} 72% 55%)`
}

export function sanitizeTrayProjectState(projectPath, request = {}) {
  const control = ['active', 'paused', 'suspended'].includes(request.planControl) ? request.planControl : 'active'
  return {
    projectPath: String(projectPath || ''),
    activeChatId: boundedText(request.activeChatId, TEXT_LIMITS.chatId),
    status: boundedText(request.status, TEXT_LIMITS.status) || 'Pronto',
    attentionTotal: Math.max(0, Number(request.attentionTotal) || 0),
    actionable: Math.max(0, Number(request.actionable) || 0),
    tunnelCount: Math.max(0, Number(request.tunnelCount) || 0),
    taskInFlight: Boolean(request.taskInFlight),
    canApproveExecution: Boolean(request.canApproveExecution),
    canContinueRequest: Boolean(request.canContinueRequest),
    canControlExecution: Boolean(request.canControlExecution),
    planControl: control,
  }
}

export function summarizeTrayWorkers(runtime = {}) {
  const workers = Array.isArray(runtime.agents) ? runtime.agents.filter((agent) => agent?.role === 'worker') : []
  const busy = workers.filter((agent) => agent?.occupied || ['claimed', 'running', 'loading'].includes(agent?.status)).length
  const errors = workers.filter((agent) => agent?.status === 'error' || agent?.error).length
  return {
    total: workers.length,
    busy,
    errors,
    paused: Boolean(runtime.worker_pause?.paused),
    workers: workers.slice(0, 8).map((agent) => ({
      id: String(agent?.id || ''),
      label: boundedText(agent?.label, 60) || 'Worker',
      status: boundedText(agent?.status, 32) || 'idle',
      project: boundedText(agent?.project_id, 180),
    })),
  }
}

export function trayStatusLabel(state) {
  if (!state) return 'Pronto'
  if (state.taskInFlight) return 'Pedido em curso'
  if (state.actionable) return `${state.actionable} ${state.actionable === 1 ? 'ação pendente' : 'ações pendentes'}`
  if (state.attentionTotal) return `${state.attentionTotal} notificação${state.attentionTotal === 1 ? '' : 'ões'}`
  return state.status || 'Pronto'
}
