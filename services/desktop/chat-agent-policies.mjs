import { HARD_MAX_WORKER_SLOTS } from './chat-agent-pool.mjs'

export const DEFAULT_CHAT_AGENT_POLICIES = Object.freeze({
  auto_scale: false,
  keep_flowing_global: false,
  keep_flowing_workers: Object.freeze([]),
})

function workerNumber(value) {
  const match = String(value || '').trim().match(/^worker-([1-9][0-9]*)$/)
  return match ? Number(match[1]) : 0
}

export function normalizeChatAgentPolicies(value = {}, maxWorkers = HARD_MAX_WORKER_SLOTS) {
  const limit = Math.max(1, Math.floor(Number(maxWorkers) || HARD_MAX_WORKER_SLOTS))
  const workers = Array.isArray(value?.keep_flowing_workers) ? value.keep_flowing_workers : []
  const keepFlowingWorkers = [...new Set(workers
    .map((item) => workerNumber(item))
    .filter((worker) => worker >= 1 && worker <= limit))]
    .sort((a, b) => a - b)
    .map((worker) => `worker-${worker}`)
  return {
    auto_scale: value?.auto_scale === true,
    keep_flowing_global: value?.keep_flowing_global === true,
    keep_flowing_workers: keepFlowingWorkers,
  }
}

export function keepFlowingForWorker(policies, worker) {
  const normalized = normalizeChatAgentPolicies(policies)
  const id = typeof worker === 'number' ? `worker-${worker}` : String(worker || '').trim()
  return normalized.keep_flowing_global || normalized.keep_flowing_workers.includes(id)
}

export function autoScaleTarget({ enabled, due = 0, available = 0, current, maxWorkers = HARD_MAX_WORKER_SLOTS } = {}) {
  const currentWorkers = Math.max(1, Math.floor(Number(current) || 1))
  const hardMax = Math.max(currentWorkers, Math.floor(Number(maxWorkers) || HARD_MAX_WORKER_SLOTS))
  if (enabled !== true || Number(due || 0) <= 0 || Number(available || 0) > 0 || currentWorkers >= hardMax) return currentWorkers
  return Math.min(hardMax, currentWorkers + 1)
}

export function autoScaleDrainTarget({ enabled, due = 0, configured, current, keepFlowingFloor = 0 } = {}) {
  const base = Math.max(1, Math.floor(Number(configured) || 1))
  const live = Math.max(base, Math.floor(Number(current) || base))
  if (enabled !== true || Number(due || 0) > 0) return live
  return Math.min(live, Math.max(base, Math.floor(Number(keepFlowingFloor) || 0)))
}
