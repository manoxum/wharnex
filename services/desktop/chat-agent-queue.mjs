// In-process projection of the durable backend scheduler.
//
// PostgreSQL is authoritative. This queue exists only for tests and short-lived
// local dispatch helpers; it mirrors the same typed bands, not_before ordering,
// active semantic deduplication and aging rules.

export const TASK_TYPES = Object.freeze([
  'TRANSLATE_MARKDOWN', 'RELEASE_NOTES', 'TODO_CLASSIFY', 'ORCHESTRATOR_PLAN', 'ORCHESTRATOR_EXECUTE', 'BOT_WRITE', 'RECOVERY_WRITE', 'AWAIT_RESPONSE', 'TITLE_DISCOVER',
  'TITLE_GENERATE_TEMP', 'TITLE_AWAIT', 'ORGANIZE_CHAT', 'RENAME_CHAT',
  'ARCHIVE_CHAT', 'DELETE_CHAT', 'DELETE_BUNDLE', 'DELETE_TEMP_CHAT',
])

export const TASK_PRIORITY = Object.freeze({
  TRANSLATE_MARKDOWN: -3,
  RELEASE_NOTES: -1,
  TODO_CLASSIFY: 5,
  ORCHESTRATOR_PLAN: -2,
  ORCHESTRATOR_EXECUTE: -1,
  BOT_WRITE: 0,
  RECOVERY_WRITE: 0,
  AWAIT_RESPONSE: 1,
  TITLE_DISCOVER: 2,
  TITLE_GENERATE_TEMP: 2,
  TITLE_AWAIT: 2,
  ORGANIZE_CHAT: 2,
  RENAME_CHAT: 2,
  ARCHIVE_CHAT: 3,
  DELETE_CHAT: 3,
  DELETE_BUNDLE: 4,
  DELETE_TEMP_CHAT: 4,
})

export const TASK_STATUSES = Object.freeze([
  'PENDING', 'LEASED', 'RUNNING', 'WAITING', 'DONE', 'FAILED', 'ATTENTION', 'CANCELLED',
])

export const JOB_KINDS = Object.freeze(['write', 'read', 'account'])

let sequence = 0

function legacyType(kind) {
  if (kind === 'write') return 'BOT_WRITE'
  if (kind === 'account') return 'ORGANIZE_CHAT'
  return 'AWAIT_RESPONSE'
}

function effectivePriority(item, now) {
  if (item.priority <= 1) return item.priority
  const aged = Math.floor(Math.max(0, now - item.enqueuedAt) / (15 * 60_000))
  return Math.max(1, item.priority - aged)
}

export class ChatAgentQueue {
  constructor({ maxDepth = 512, now = () => Date.now() } = {}) {
    this.items = []
    this.maxDepth = maxDepth
    this.now = now
  }

  get depth() { return this.items.length }

  counts() {
    const counts = Object.fromEntries(TASK_TYPES.map((type) => [type, 0]))
    for (const item of this.items) counts[item.type] += 1
    return counts
  }

  enqueueTask({
    type, chatId = '', conversationId = '', dedupeKey = '', payload = {},
    affinity = '', notBefore = 0, requestId = '', rootRequestId = '',
  }) {
    const normalized = String(type || '').toUpperCase()
    if (!TASK_TYPES.includes(normalized)) throw new Error(`Unsupported chat-agent task type ${normalized}`)
    if (this.items.length >= this.maxDepth) throw new Error('Chat agent queue is full')
    if (dedupeKey) {
      const existing = this.items.find((item) => item.dedupeKey === dedupeKey)
      if (existing) return existing.promise
    }

    sequence += 1
    const item = {
      id: `job_${sequence}`,
      type: normalized,
      chatId: String(chatId || ''),
      conversationId: String(conversationId || ''),
      requestId: String(requestId || ''),
      rootRequestId: String(rootRequestId || ''),
      dedupeKey: String(dedupeKey || ''),
      affinity: String(affinity || ''),
      payload,
      notBefore: Number(notBefore || 0),
      enqueuedAt: this.now(),
      priority: TASK_PRIORITY[normalized],
      sequence,
    }
    item.promise = new Promise((resolve, reject) => { item.resolve = resolve; item.reject = reject })
    this.items.push(item)
    return item.promise
  }

  // Compatibility for callers/tests from the ADR-0038 prototype.
  enqueue({ kind, ...rest }) {
    return this.enqueueTask({ type: legacyType(kind), ...rest })
  }

  take(slotId = '') {
    const now = this.now()
    const ready = this.items.filter((item) => !item.notBefore || item.notBefore <= now)
    if (!ready.length) return undefined
    const ordered = ready.sort((a, b) =>
      effectivePriority(a, now) - effectivePriority(b, now)
      || a.enqueuedAt - b.enqueuedAt
      || a.sequence - b.sequence)
    const band = effectivePriority(ordered[0], now)
    const sameBand = ordered.filter((item) => effectivePriority(item, now) === band)
    const chosen = (slotId && sameBand.find((item) => item.affinity === slotId)) || sameBand[0]
    this.items.splice(this.items.indexOf(chosen), 1)
    return chosen
  }

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
      if (item.chatId === target && item.type === 'AWAIT_RESPONSE') {
        item.reject(new Error(reason))
        cancelled += 1
      } else kept.push(item)
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
