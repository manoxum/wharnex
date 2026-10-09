import { chatAgentLane, orchestratorTaskChat } from '../scheduling/residency/lanes.mjs'

// A Worker that takes an Orchestrator execution stays with that task until the
// task settles. Handing the lane back between attempts made the next attempt
// land on another Worker, which reopened the conversation (several ChatGPT
// reads each time) and kept the account's read throttle alive. While pinned,
// the Worker claims only its task's lane, even when that lane has nothing due
// yet, and no other Worker may claim it.
//
// An attempt that ends DONE (the task left READY/DOING), FAILED or ATTENTION
// ends the run and releases the pin. A lane that stays silent for a long time
// (its queue entry was cancelled or exhausted its attempts in the backend) is
// released too, so a Worker never stays bound to a task nobody will resume.
export const ORCHESTRATION_PIN_IDLE_RELEASE_MS = 15 * 60_000

const TERMINAL = new Set(['done', 'failed', 'attention'])

export class OrchestrationTaskPins {
  constructor({ now = () => Date.now(), idleReleaseMs = ORCHESTRATION_PIN_IDLE_RELEASE_MS } = {}) {
    this.now = now
    this.idleReleaseMs = idleReleaseMs
    this.pins = new Map()
  }

  // Records the outcome of an attempt a slot ran. Returns 'pinned', 'released'
  // or '' when the task is not an Orchestrator execution.
  note(slotId, task, result) {
    // Every round of a task's Main Request (its driver, write, supervision and
    // recovery) keeps the Worker; only the driver's end releases it.
    if (!orchestratorTaskChat(task)) return ''
    const lane = chatAgentLane(task)
    if (!lane) return ''
    const slot = String(slotId || '')
    const status = String(result?.status || '').toLowerCase()
    if (task.type === 'ORCHESTRATOR_EXECUTE' && TERMINAL.has(status)) {
      for (const [holder, pin] of this.pins) if (pin.lane === lane) this.pins.delete(holder)
      return 'released'
    }
    // One lane has one holder: a task that moved to another slot leaves the old one.
    for (const [holder, pin] of this.pins) if (holder !== slot && pin.lane === lane) this.pins.delete(holder)
    const existing = this.pins.get(slot)
    const at = this.now()
    this.pins.set(slot, { lane, taskId: String(task.chat_id || ''), since: existing?.lane === lane ? existing.since : at, lastActivity: at })
    return 'pinned'
  }

  lane(slotId) {
    return this.pins.get(String(slotId || ''))?.lane || ''
  }

  taskId(slotId) {
    return this.pins.get(String(slotId || ''))?.taskId || ''
  }

  lanesHeldByOthers(slotId) {
    const slot = String(slotId || '')
    return [...this.pins].filter(([holder]) => holder !== slot).map(([, pin]) => pin.lane)
  }

  // An empty claim on a pinned lane. Returns true when the pin was released.
  noteIdle(slotId) {
    const slot = String(slotId || '')
    const pin = this.pins.get(slot)
    if (!pin || this.now() - pin.lastActivity < this.idleReleaseMs) return false
    this.pins.delete(slot)
    return true
  }

  // Drops pins of slots that no longer exist (the pool drained).
  retain(slotIds) {
    const live = new Set([...slotIds].map(String))
    for (const holder of [...this.pins.keys()]) if (!live.has(holder)) this.pins.delete(holder)
  }

  snapshot() {
    return Object.fromEntries([...this.pins].map(([slot, pin]) => [slot, { ...pin }]))
  }
}
