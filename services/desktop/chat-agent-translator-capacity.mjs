// The durable queue counts translations that can be claimed now. Keep one
// scheduler loop per running translation and per due translation; each loop
// creates a browser only after it claims a task and retires it on settlement.
// The backend's canonical translator-N ids stop at 64.
export const MAX_TRANSLATOR_SLOTS = 64

export function translatorCapacityTarget({ due = 0, active = 0, availableWorkers = 0 } = {}) {
  const queued = Math.max(0, Math.floor(Number(due) || 0))
  const running = Math.max(0, Math.floor(Number(active) || 0))
  const free = Math.max(0, Math.floor(Number(availableWorkers) || 0))
  return Math.min(MAX_TRANSLATOR_SLOTS, Math.max(1, queued - free + running))
}
