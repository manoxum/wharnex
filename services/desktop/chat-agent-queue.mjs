// The single global request queue shared by every chat-agent slot.
//
// One queue, many agents. Each agent owns exactly one browser instance and pulls
// work from here, so the number of open ChatGPT surfaces is decoupled from the
// number of Wharnex chats: three slots can serve thirty chats.
//
// Two rules govern ordering, and they exist for different reasons:
//
//  - Writes outrank reads. A write is a user waiting on their own prompt; a read
//    is background inspection that is never urgent.
//  - Dispatch is non-preemptive. A running job is never aborted because
//    something better arrived — a half-finished read leaves the surface in an
//    unknown state (a menu open, a navigation mid-flight), and the cost of
//    reasoning about that dwarfs the latency saved.

export const JOB_KINDS = Object.freeze(['write', 'read', 'account'])

// Lower sorts first. `account` sits between write and read: it mutates the
// user's account and is usually the tail of a write, but it is not a user
// waiting on a prompt.
const PRIORITY = Object.freeze({ write: 0, account: 1, read: 2 })

let sequence = 0

export class ChatAgentQueue {
  constructor({ maxDepth = 512, now = () => Date.now() } = {}) {
    this.items = []
    this.maxDepth = maxDepth
    this.now = now
  }

  get depth() { return this.items.length }

  counts() {
    const counts = { write: 0, account: 0, read: 0 }
    for (const item of this.items) counts[item.kind] += 1
    return counts
  }

  /**
   * Enqueues a job and returns a promise that settles when an agent finishes it.
   *
   * `dedupeKey` collapses a repeated request for the same work: re-inspecting a
   * chat that is already queued for inspection is not two jobs. A write is never
   * deduped — two prompts to the same chat are two distinct intents.
   */
  enqueue({ kind, chatId = '', url = '', dedupeKey = '', payload = {}, affinity = '' }) {
    if (!JOB_KINDS.includes(kind)) throw new Error(`Unsupported chat-agent job kind ${kind}`)
    if (this.items.length >= this.maxDepth) throw new Error('Chat agent queue is full')

    if (dedupeKey && kind !== 'write') {
      const existing = this.items.find((item) => item.dedupeKey === dedupeKey)
      if (existing) return existing.promise
    }

    sequence += 1
    const item = {
      id: `job_${sequence}`,
      kind,
      chatId: String(chatId || ''),
      url: String(url || ''),
      dedupeKey: String(dedupeKey || ''),
      // `affinity` asks for a specific slot when one is already on the right
      // conversation, which saves a navigation. It is a preference, never a
      // requirement: an affine slot that is busy must not stall the job.
      affinity: String(affinity || ''),
      payload,
      enqueuedAt: this.now(),
      priority: PRIORITY[kind],
      sequence,
    }
    item.promise = new Promise((resolve, reject) => { item.resolve = resolve; item.reject = reject })
    this.items.push(item)
    return item.promise
  }

  /**
   * Pops the next job for an agent, preferring one already affine to that slot
   * at the same priority level so an idle slot on the right conversation is used
   * before a slot that would have to navigate.
   */
  take(slotId = '') {
    if (!this.items.length) return undefined
    const ordered = [...this.items].sort((a, b) => a.priority - b.priority || a.sequence - b.sequence)
    const topPriority = ordered[0].priority
    const sameBand = ordered.filter((item) => item.priority === topPriority)
    const chosen = (slotId && sameBand.find((item) => item.affinity && item.affinity === slotId)) || sameBand[0]
    this.items.splice(this.items.indexOf(chosen), 1)
    return chosen
  }

  /** Drops every queued job, settling each as cancelled. Running work is untouched. */
  cancelAll(reason = 'Chat agent queue was cleared') {
    const dropped = this.items.splice(0, this.items.length)
    for (const item of dropped) item.reject(new Error(reason))
    return dropped.length
  }

  cancelChat(chatId, reason = 'Chat agent work was superseded') {
    const target = String(chatId || '')
    if (!target) return 0
    const kept = []
    let cancelled = 0
    for (const item of this.items) {
      if (item.chatId === target && item.kind === 'read') { item.reject(new Error(reason)); cancelled += 1 }
      else kept.push(item)
    }
    this.items = kept
    return cancelled
  }
}

export function settleJob(job, error, value) {
  if (!job || job.settled) return
  job.settled = true
  if (error) job.reject(error instanceof Error ? error : new Error(String(error)))
  else job.resolve(value)
}
