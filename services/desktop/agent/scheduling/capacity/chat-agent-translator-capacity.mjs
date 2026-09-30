// The durable queue counts ephemeral tasks (translation, Orchestrator planning,
// release notes) that can be claimed now. Keep one scheduler loop per running
// task and per due task; each loop creates a browser only after it claims a
// task and retires it once that task settles. Orchestrator execution Workers
// are never counted as capacity: these tasks do not wait for them. The
// backend's canonical translator-N ids stop at 64.
export const MAX_TRANSLATOR_SLOTS = 64

export function translatorCapacityTarget({ due = 0, active = 0 } = {}) {
  const queued = Math.max(0, Math.floor(Number(due) || 0))
  const running = Math.max(0, Math.floor(Number(active) || 0))
  return Math.min(MAX_TRANSLATOR_SLOTS, Math.max(1, queued + running))
}
