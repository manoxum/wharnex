// One process-wide cadence for autonomous Worker traffic to ChatGPT.
//
// A Worker action is not merely a navigation: uploads, retries and submits all
// reach the same authenticated account.  Serialising only each Worker leaves
// the other slots free to form a burst, so this coordinator owns one shared
// tail for the entire Worker pool.
export const CHAT_AGENT_WORKER_ACTION_GAP_MS = 30_000
export const CHAT_AGENT_TRANSLATION_ACTION_GAP_MS = 5_000

export class ChatAgentGlobalPacer {
  constructor({ now = () => Date.now(), wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms)) } = {}) {
    this.now = now
    this.wait = wait
    this.tail = Promise.resolve()
    this.lastActionAt = null
  }

  async pace(measureGapMs, { minimumGapMs = CHAT_AGENT_WORKER_ACTION_GAP_MS } = {}) {
    let release
    const previous = this.tail
    this.tail = new Promise((resolve) => { release = resolve })
    await previous
    try {
      // Evaluate the pressure-derived interval only after prior Workers have
      // finished waiting; a 429 raised by one Worker must protect every one
      // already queued behind it.
      const measured = typeof measureGapMs === 'function' ? Number(measureGapMs()) : Number(measureGapMs)
      const gap = Math.max(Math.max(0, Number(minimumGapMs) || 0), Number.isFinite(measured) ? measured : 0)
      const remaining = this.lastActionAt == null ? 0 : gap - (this.now() - this.lastActionAt)
      if (remaining > 0) await this.wait(remaining)
      this.lastActionAt = this.now()
      return this.lastActionAt
    } finally {
      release()
    }
  }
}
