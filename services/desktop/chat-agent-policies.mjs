import { HARD_MAX_WORKER_SLOTS, HARD_MAX_SUPERVISOR_SLOTS } from './chat-agent-pool.mjs'

export const DEFAULT_CHAT_AGENT_POLICIES = Object.freeze({
  auto_scale: true,
  auto_scale_max_workers: HARD_MAX_WORKER_SLOTS,
  auto_scale_max_supervisors: HARD_MAX_SUPERVISOR_SLOTS,
  keep_flowing_global: true,
  keep_flowing_workers: Object.freeze([]),
  workers_suspended: false,
  workers_suspended_until: '',
})

function workerNumber(value) {
  const match = String(value || '').trim().match(/^worker-([1-9][0-9]*)$/)
  return match ? Number(match[1]) : 0
}

export function normalizeChatAgentPolicies(value = DEFAULT_CHAT_AGENT_POLICIES, maxWorkers = HARD_MAX_WORKER_SLOTS, maxSupervisors = HARD_MAX_SUPERVISOR_SLOTS) {
  const workerLimit = Math.max(1, Math.floor(Number(maxWorkers) || HARD_MAX_WORKER_SLOTS))
  const supervisorLimit = Math.max(1, Math.floor(Number(maxSupervisors) || HARD_MAX_SUPERVISOR_SLOTS))
  const workers = Array.isArray(value?.keep_flowing_workers) ? value.keep_flowing_workers : []
  const keepFlowingWorkers = [...new Set(workers
    .map((item) => workerNumber(item))
    .filter((worker) => worker >= 1 && worker <= workerLimit))]
    .sort((a, b) => a - b)
    .map((worker) => `worker-${worker}`)
  const requestedAutoScaleMaxWorkers = Number(value?.auto_scale_max_workers)
  const autoScaleMaxWorkers = Number.isFinite(requestedAutoScaleMaxWorkers)
    ? Math.min(workerLimit, Math.max(1, Math.floor(requestedAutoScaleMaxWorkers)))
    : Math.min(workerLimit, DEFAULT_CHAT_AGENT_POLICIES.auto_scale_max_workers)
  const requestedAutoScaleMaxSupervisors = Number(value?.auto_scale_max_supervisors)
  const autoScaleMaxSupervisors = Number.isFinite(requestedAutoScaleMaxSupervisors)
    ? Math.min(supervisorLimit, Math.max(1, Math.floor(requestedAutoScaleMaxSupervisors)))
    : Math.min(supervisorLimit, DEFAULT_CHAT_AGENT_POLICIES.auto_scale_max_supervisors)
  const rawSuspendedUntil = String(value?.workers_suspended_until || '').trim()
  const suspendedDeadline = rawSuspendedUntil ? Date.parse(rawSuspendedUntil) : NaN
  const workersSuspendedUntil = Number.isFinite(suspendedDeadline) ? new Date(suspendedDeadline).toISOString() : ''
  return {
    auto_scale: value?.auto_scale == null ? DEFAULT_CHAT_AGENT_POLICIES.auto_scale : value.auto_scale === true,
    auto_scale_max_workers: autoScaleMaxWorkers,
    auto_scale_max_supervisors: autoScaleMaxSupervisors,
    keep_flowing_global: value?.keep_flowing_global === true,
    keep_flowing_workers: keepFlowingWorkers,
    workers_suspended: value?.workers_suspended === true,
    workers_suspended_until: workersSuspendedUntil,
  }
}

export function workerSuspensionState(policies, now = Date.now()) {
  const normalized = normalizeChatAgentPolicies(policies)
  if (!normalized.workers_suspended) return { paused: false, paused_until: '' }
  if (!normalized.workers_suspended_until) return { paused: true, paused_until: '' }
  const deadline = Date.parse(normalized.workers_suspended_until)
  if (!Number.isFinite(deadline) || deadline <= Number(now || 0)) return { paused: false, paused_until: '' }
  return { paused: true, paused_until: normalized.workers_suspended_until }
}

export function keepFlowingForWorker(policies, worker) {
  const normalized = normalizeChatAgentPolicies(policies)
  const id = typeof worker === 'number' ? `worker-${worker}` : String(worker || '').trim()
  return normalized.keep_flowing_global || normalized.keep_flowing_workers.includes(id)
}

export function autoScaleTarget({ enabled, due = 0, available = 0, current, maxWorkers = HARD_MAX_WORKER_SLOTS } = {}) {
  const currentWorkers = Math.max(1, Math.floor(Number(current) || 1))
  const hardMax = Math.max(currentWorkers, Math.floor(Number(maxWorkers) || HARD_MAX_WORKER_SLOTS))
  const demand = Math.max(0, Math.floor(Number(due) || 0))
  const free = Math.max(0, Math.floor(Number(available) || 0))
  const shortage = Math.max(0, demand - free)
  if (enabled !== true || shortage <= 0 || currentWorkers >= hardMax) return currentWorkers
  return Math.min(hardMax, currentWorkers + shortage)
}

export function autoScaleDrainTarget({ enabled, due = 0, configured, current, keepFlowingFloor = 0 } = {}) {
  const base = Math.max(1, Math.floor(Number(configured) || 1))
  const live = Math.max(base, Math.floor(Number(current) || base))
  if (enabled !== true || Number(due || 0) > 0) return live
  return Math.min(live, Math.max(base, Math.floor(Number(keepFlowingFloor) || 0)))
}

// Supervisors scale on lanes, not on tasks.
//
// A Supervisor is bound to one Harness chat for the life of its request, so the
// demand is the number of distinct conversations holding claimable
// Supervisor-owned work that no current slot can serve. Sizing the pool from the
// shared `due` total would grow it because a library cleanup is queued, and
// sizing it from supervisor *tasks* would grow it against three tasks one
// resident slot already serves.
export function autoScaleSupervisorTarget({ enabled, dueLanes = 0, available = 0, current, maxSupervisors = HARD_MAX_SUPERVISOR_SLOTS } = {}) {
  const currentSupervisors = Math.max(1, Math.floor(Number(current) || 1))
  const hardMax = Math.max(currentSupervisors, Math.floor(Number(maxSupervisors) || HARD_MAX_SUPERVISOR_SLOTS))
  const demand = Math.max(0, Math.floor(Number(dueLanes) || 0))
  const free = Math.max(0, Math.floor(Number(available) || 0))
  const shortage = Math.max(0, demand - free)
  if (enabled !== true || shortage <= 0 || currentSupervisors >= hardMax) return currentSupervisors
  return Math.min(hardMax, currentSupervisors + shortage)
}

// Retiring an auto-scaled Supervisor is not free: the slot above the configured
// base may still hold a conversation, and dropping the cap under the number of
// bound renderers is what makes the next chat switch a reload. So the floor is
// the larger of the operator's base and what is actually bound right now, and
// the drain happens only while no Supervisor lane is waiting for a slot.
export function autoScaleSupervisorDrainTarget({ enabled, dueLanes = 0, configured, current, boundSupervisors = 0 } = {}) {
  const base = Math.max(1, Math.floor(Number(configured) || 1))
  const live = Math.max(base, Math.floor(Number(current) || base))
  if (enabled !== true || Number(dueLanes || 0) > 0) return live
  return Math.min(live, Math.max(base, Math.floor(Number(boundSupervisors) || 0)))
}
