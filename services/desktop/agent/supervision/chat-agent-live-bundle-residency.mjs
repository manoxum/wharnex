const BUNDLE_WORKER_TYPES = new Set(['ORCHESTRATOR_PLAN', 'ORCHESTRATOR_EXECUTE'])

// A settled WAITING result alone does not prove an active response: it can
// also mean cooldown, unavailable transport, or a queued Agent continuation.
// Only the bounded DOM observation that saw generation may pin the lane.
export function chatAgentLiveBundlePending(runtime) {
  if (runtime?.error || runtime?.lastResult?.status !== 'waiting') return false
  if (runtime?.lastTask?.type === 'AWAIT_RESPONSE') return true
  return BUNDLE_WORKER_TYPES.has(runtime?.lastTask?.type)
    && runtime?.lastResult?.liveBundlePending === true
}
