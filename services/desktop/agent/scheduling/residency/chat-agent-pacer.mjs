// One process-wide cadence for autonomous Worker traffic to ChatGPT.
//
// A Worker action is not merely a navigation: uploads, retries and submits all
// reach the same authenticated account.  Serialising only each Worker leaves
// the other slots free to form a burst, so this coordinator owns one shared
// clock for the entire Worker pool.
//
// Priority orders the waiters, never the gap. Served first-come, a pool of
// Workers that claimed together spent every slot on new-task navigation
// before any of them uploaded, so none reached ChatGPT for minutes. An action
// of a task that already reached the provider (priority 1) now takes the next
// slot, then first-come order among equals.
// Healthy-account floor; durable 429 pressure widens it (see main.mjs).
export const CHAT_AGENT_WORKER_ACTION_GAP_MS = 10_000
export const CHAT_AGENT_TRANSLATION_ACTION_GAP_MS = 5_000

export class ChatAgentGlobalPacer {
  constructor({ now = () => Date.now(), wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms)) } = {}) {
    this.now = now
    this.wait = wait
    this.waiters = []
    this.sequence = 0
    this.draining = false
    this.lastActionAt = null
  }

  get pending() {
    return this.waiters.length
  }

  pace(measureGapMs, { minimumGapMs = CHAT_AGENT_WORKER_ACTION_GAP_MS, priority = 0 } = {}) {
    return new Promise((resolve, reject) => {
      this.waiters.push({ measureGapMs, minimumGapMs, priority: Number(priority) || 0, sequence: this.sequence++, resolve, reject })
      void this.drain()
    })
  }

  next() {
    let best = this.waiters[0]
    for (const waiter of this.waiters) {
      if (waiter.priority > best.priority || (waiter.priority === best.priority && waiter.sequence < best.sequence)) best = waiter
    }
    return best
  }

  async drain() {
    if (this.draining) return
    this.draining = true
    try {
      while (this.waiters.length) {
        const waiter = this.next()
        let gap
        try {
          // Evaluate the pressure-derived interval only when this waiter is
          // at the front; a 429 raised by one Worker must protect every one
          // already queued behind it.
          const measured = typeof waiter.measureGapMs === 'function' ? Number(waiter.measureGapMs()) : Number(waiter.measureGapMs)
          gap = Math.max(Math.max(0, Number(waiter.minimumGapMs) || 0), Number.isFinite(measured) ? measured : 0)
        } catch (error) {
          this.waiters.splice(this.waiters.indexOf(waiter), 1)
          waiter.reject(error)
          continue
        }
        const remaining = this.lastActionAt == null ? 0 : gap - (this.now() - this.lastActionAt)
        if (remaining > 0) {
          await this.wait(remaining)
          // Re-select: a higher-priority action may have arrived meanwhile.
          continue
        }
        this.waiters.splice(this.waiters.indexOf(waiter), 1)
        this.lastActionAt = this.now()
        waiter.resolve(this.lastActionAt)
      }
    } finally {
      this.draining = false
    }
  }
}
