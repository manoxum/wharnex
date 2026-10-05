import { createChatAgentQueueAPI } from './api.mjs'
import { chatAgentBackoff } from './settlement.mjs'

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

// The durable queue as seen by Desktop: enqueueing, lifecycle events and the
// provider state the queue owns. Subclasses wake their claim loops on enqueue.
export class ChatAgentQueueClient {
  constructor({ baseURL, fetchImpl = fetch }) {
    if (!baseURL) throw new Error('chat-agent scheduler baseURL is required')
    this.api = createChatAgentQueueAPI({ baseURL, fetchImpl })
  }

  wake() {}

  async enqueue(task) {
    const queued = await this.api.enqueue(task)
    this.wake()
    return queued
  }

  // A Main Request's only durable trace is the task this enqueues (see
  // AGENTS.md §8: Supervisor-owned types share the same table as Worker
  // types). Swallowing a transient failure here left requests with zero
  // record at all, so this retries a bounded number of times and then
  // surfaces the failure to the caller instead of continuing untracked.
  async enqueueWithRetry(task, { attempts = 3, baseMs = 500 } = {}) {
    let lastError
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      try {
        return await this.enqueue(task)
      } catch (error) {
        lastError = error
        if (attempt < attempts) await wait(chatAgentBackoff(attempt, { baseMs, maxMs: 5_000 }))
      }
    }
    throw lastError instanceof Error ? lastError : new Error(String(lastError))
  }

  // Durably records one decision against a task's own lifecycle (recovery
  // reload, keep-continue wake-up, bundle validated/rejected, human
  // escalation, ...). Best-effort by design: a failure here must never fail
  // the caller's own automation, only the observability trail describing it.
  async recordTaskEvent(taskId, type, data = {}, { requestId = '', rootRequestId = '' } = {}) {
    if (!taskId || !type) return undefined
    try {
      return await this.api.recordTaskEvent(taskId, { type, data, request_id: requestId, root_request_id: rootRequestId })
    } catch (error) {
      console.warn(`[chat-agent] recordTaskEvent failed task=${taskId} type=${type} error=${error instanceof Error ? error.message : error}`)
      return undefined
    }
  }

  list(query) { return this.api.list(query) }
  queueSummary() { return this.api.queueSummary() }
  cancelLineage(rootRequestID) { return this.api.cancelLineage(rootRequestID) }
  providerState() { return this.api.providerState() }
  setProviderPause(paused, options) { return this.api.setProviderPause(paused, options) }
  recordRateLimit(source, kind, cooldownSeconds) { return this.api.recordRateLimit(source, kind, cooldownSeconds) }
  recordValidBundle(sample) { return this.api.recordValidBundle(sample) }
}
