import { request } from '../transport/http/apiRequest'

// `task:<TYPE>` holds one browser task type in every pool; chatgpt_upload is
// the account upload limit the Desktop detected.
export type AutomationHoldName = 'chatgpt_upload' | `task:${string}`

export type AutomationHold = {
  name: AutomationHoldName
  active: boolean
  until?: string
  level: number
  reason: string
  source: string
  default?: boolean
  updated_at: string
}

export type AutomationHolds = { chatgpt_upload?: AutomationHold }

export type TaskPolicyState = 'active' | 'suspended' | 'cooldown'

export type TaskCooldown = { kind: 'rate_limit' | 'upload_limit'; until?: string; reason: string }

// The effective state of one browser task type, computed by the backend so
// every surface shows the same answer.
export type TaskPolicy = {
  type: string
  pool: 'supervisor' | 'worker' | 'ephemeral'
  uploads: boolean
  state: TaskPolicyState
  hold: AutomationHold
  cooldowns: TaskCooldown[]
}

type HoldUpdate = { active: boolean; until?: string; level?: number; reason?: string; source?: string }

export const automationHoldsApi = {
  list: () => request<{ holds: AutomationHolds; task_policies: TaskPolicy[] }>('/api/automation-holds'),
  set: (name: AutomationHoldName, update: HoldUpdate) =>
    request<AutomationHold>(`/api/automation-holds/${name}`, { method: 'PUT', body: JSON.stringify(update) }),
}

// A hold is in force while active and, when it has a deadline, before it.
export function holdInForce(hold: AutomationHold | undefined, now = Date.now()) {
  if (!hold?.active) return false
  const until = Date.parse(hold.until || '')
  return !Number.isFinite(until) || until > now
}

export const taskHold = (type: string): AutomationHoldName => `task:${type}`

export function holdUntilLabel(hold: { until?: string } | undefined) {
  const until = Date.parse(hold?.until || '')
  if (!Number.isFinite(until)) return ''
  return new Date(until).toLocaleTimeString('pt-PT', { hour: '2-digit', minute: '2-digit' })
}
