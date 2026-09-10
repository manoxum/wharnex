import { randomUUID } from 'node:crypto'

export const DEFAULT_CHAT_AGENT_WORKERS = 3
export const DEFAULT_CHAT_AGENT_LEASE_SECONDS = 45

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function endpoint(baseURL, path) {
  return new URL(path, baseURL).href
}

async function requestJSON(fetchImpl, baseURL, path, init = {}) {
  const response = await fetchImpl(endpoint(baseURL, path), {
    redirect: 'error',
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init.headers || {}) },
  })
  if (!response.ok) {
    let detail = ''
    try { detail = (await response.json())?.error?.message || '' } catch {}
    throw new Error(`chat-agent API ${response.status}${detail ? `: ${detail}` : ''}`)
  }
  return response.json()
}

export function chatAgentBackoff(attempt, { baseMs = 2_000, maxMs = 60_000, jitter = Math.random } = {}) {
  const exp = Math.min(maxMs, baseMs * (2 ** Math.max(0, Number(attempt || 1) - 1)))
  const spread = Math.max(1, Math.floor(exp * 0.2))
  return exp - spread + Math.floor(jitter() * spread * 2)
}

export class ChatAgentSchedulerClient {
  constructor({
    baseURL,
    fetchImpl = fetch,
    execute,
    workerCount = DEFAULT_CHAT_AGENT_WORKERS,
    leaseSeconds = DEFAULT_CHAT_AGENT_LEASE_SECONDS,
    idleMs = 750,
    onState = () => {},
  }) {
    if (!baseURL) throw new Error('chat-agent scheduler baseURL is required')
    if (typeof execute !== 'function') throw new Error('chat-agent scheduler execute callback is required')
    this.baseURL = baseURL
    this.fetchImpl = fetchImpl
    this.execute = execute
    this.workerCount = Math.max(1, Math.floor(workerCount) || DEFAULT_CHAT_AGENT_WORKERS)
    this.leaseSeconds = leaseSeconds
    this.idleMs = idleMs
    this.onState = onState
    this.instanceID = `desktop-${randomUUID()}`
    this.running = false
    this.loops = []
  }

  async enqueue(task) {
    return requestJSON(this.fetchImpl, this.baseURL, '/api/chat-agent/tasks', {
      method: 'POST', body: JSON.stringify(task),
    })
  }

  async list(query = {}) {
    const target = new URL('/api/chat-agent/tasks', this.baseURL)
    for (const [key, value] of Object.entries(query)) if (value !== '' && value != null) target.searchParams.set(key, String(value))
    return requestJSON(this.fetchImpl, this.baseURL, `${target.pathname}${target.search}`)
  }

  async cancelLineage(rootRequestID) {
    return requestJSON(this.fetchImpl, this.baseURL, '/api/chat-agent/tasks/cancel-lineage', {
      method: 'POST', body: JSON.stringify({ root_request_id: rootRequestID }),
    })
  }

  async providerState() {
    return requestJSON(this.fetchImpl, this.baseURL, '/api/chat-agent/provider')
  }

  async setProviderPause(paused, { pausedUntil = null, reason = '' } = {}) {
    return requestJSON(this.fetchImpl, this.baseURL, '/api/chat-agent/provider', {
      method: 'PUT',
      body: JSON.stringify({ paused, paused_until: pausedUntil, reason }),
    })
  }

  start() {
    if (this.running) return
    this.running = true
    this.loops = Array.from({ length: this.workerCount }, (_, index) => this.#workerLoop(index + 1))
  }

  async stop() {
    this.running = false
    await Promise.allSettled(this.loops)
    this.loops = []
  }

  async #workerLoop(index) {
    const owner = `${this.instanceID}:worker-${index}`
    while (this.running) {
      try {
        const claimed = await requestJSON(this.fetchImpl, this.baseURL, '/api/chat-agent/tasks/claim', {
          method: 'POST',
          body: JSON.stringify({ owner, lease_seconds: this.leaseSeconds }),
        })
        const task = claimed?.task
        if (!task) {
          await wait(this.idleMs)
          continue
        }
        await this.#runTask(owner, task, index)
      } catch (error) {
        this.onState({ kind: 'worker-error', worker: index, error })
        await wait(Math.max(this.idleMs, 1_000))
      }
    }
  }

  async #runTask(owner, task, worker) {
    await this.#transition(task.task_id, 'start', { owner })
    this.onState({ kind: 'running', worker, task })
    let heartbeat
    try {
      heartbeat = setInterval(() => {
        void this.#transition(task.task_id, 'heartbeat', {
          owner, lease_seconds: this.leaseSeconds,
        }).catch((error) => this.onState({ kind: 'heartbeat-error', worker, task, error }))
      }, Math.max(5_000, Math.floor(this.leaseSeconds * 500)))

      const result = await this.execute(task, { worker, owner })
      if (!this.running && result?.status !== 'done') {
        await this.#transition(task.task_id, 'wait', {
          owner, not_before: new Date(Date.now() + 1_000).toISOString(), error: 'desktop shutting down',
        })
        return
      }
      if (result?.status === 'waiting') {
        const delay = Number(result.delayMs) || chatAgentBackoff(task.attempt)
        await this.#transition(task.task_id, 'wait', {
          owner,
          not_before: result.notBefore || new Date(Date.now() + delay).toISOString(),
          error: String(result.error || ''),
        })
      } else if (result?.status === 'attention') {
        if (result.providerWide) {
          await this.setProviderPause(true, {
            pausedUntil: result.pausedUntil || null,
            reason: String(result.error || 'ChatGPT requires human attention'),
          })
        }
        await this.#transition(task.task_id, 'attention', { owner, error: String(result.error || '') })
      } else if (result?.status === 'failed') {
        await this.#transition(task.task_id, 'fail', { owner, error: String(result.error || '') })
      } else {
        await this.#transition(task.task_id, 'complete', { owner })
      }
      this.onState({ kind: 'settled', worker, task, result })
    } catch (error) {
      const retryable = task.attempt < task.max_attempts
      const action = retryable ? 'wait' : 'fail'
      const body = retryable
        ? {
            owner,
            not_before: new Date(Date.now() + chatAgentBackoff(task.attempt)).toISOString(),
            error: error instanceof Error ? error.message : String(error),
          }
        : { owner, error: error instanceof Error ? error.message : String(error) }
      await this.#transition(task.task_id, action, body).catch(() => undefined)
      this.onState({ kind: 'task-error', worker, task, error })
    } finally {
      if (heartbeat) clearInterval(heartbeat)
    }
  }

  #transition(taskID, action, body) {
    return requestJSON(this.fetchImpl, this.baseURL, `/api/chat-agent/tasks/${encodeURIComponent(taskID)}/${action}`, {
      method: 'POST', body: JSON.stringify(body),
    })
  }
}
