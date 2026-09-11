import { randomUUID } from 'node:crypto'

export const DEFAULT_CHAT_AGENT_WORKERS = 3
export const DEFAULT_CHAT_AGENT_LEASE_SECONDS = 45
export const DEFAULT_CHAT_AGENT_TASK_COOLDOWN_MS = 2_500

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
    maxWorkers = 6,
    leaseSeconds = DEFAULT_CHAT_AGENT_LEASE_SECONDS,
    idleMs = 750,
    taskCooldownMs = DEFAULT_CHAT_AGENT_TASK_COOLDOWN_MS,
    onState = () => {},
  }) {
    if (!baseURL) throw new Error('chat-agent scheduler baseURL is required')
    if (typeof execute !== 'function') throw new Error('chat-agent scheduler execute callback is required')
    this.baseURL = baseURL
    this.fetchImpl = fetchImpl
    this.execute = execute
    this.maxWorkers = Math.max(1, Math.floor(maxWorkers) || 1)
    this.workerCount = this.#normalizeWorkerCount(workerCount)
    this.leaseSeconds = leaseSeconds
    this.idleMs = idleMs
    this.taskCooldownMs = Math.max(0, Number(taskCooldownMs) || 0)
    this.onState = onState
    this.instanceID = `desktop-${randomUUID()}`
    this.running = false
    this.loops = new Map()
  }

  #normalizeWorkerCount(value) {
    const numeric = Number(value)
    const requested = Number.isFinite(numeric) ? Math.floor(numeric) : DEFAULT_CHAT_AGENT_WORKERS
    return Math.min(this.maxWorkers, Math.max(1, requested))
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
    this.#reconcileLoops()
    this.onState({ kind: 'scaled', workerCount: this.workerCount })
  }

  async stop() {
    this.running = false
    await Promise.allSettled([...this.loops.values()])
    this.loops.clear()
  }

  setWorkerCount(value) {
    const next = this.#normalizeWorkerCount(value)
    if (next === this.workerCount) return this.workerCount
    this.workerCount = next
    if (this.running) this.#reconcileLoops()
    this.onState({ kind: 'scaled', workerCount: this.workerCount })
    return this.workerCount
  }

  #reconcileLoops() {
    for (let index = 1; index <= this.workerCount; index += 1) {
      if (this.loops.has(index)) continue
      this.onState({ kind: 'worker-started', worker: index })
      const loop = this.#workerLoop(index).finally(() => {
        this.loops.delete(index)
        this.onState({ kind: 'worker-stopped', worker: index })
        if (this.running && index <= this.workerCount) this.#reconcileLoops()
      })
      this.loops.set(index, loop)
    }
  }

  async #workerLoop(index) {
    const owner = `${this.instanceID}:worker-${index}`
    while (this.running && index <= this.workerCount) {
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
        if (this.running && index <= this.workerCount && this.taskCooldownMs > 0) await wait(this.taskCooldownMs)
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
        // Claim increments attempt before execution. A task that is put back in
        // WAITING on its final attempt can never be claimed again because the
        // backend intentionally excludes attempt >= max_attempts. Fail it
        // terminally here instead of creating an unreachable queue record.
        if (Number(task.attempt || 0) >= Number(task.max_attempts || 0)) {
          await this.#transition(task.task_id, 'fail', {
            owner, error: String(result.error || 'chat-agent task exhausted maximum attempts while waiting'),
          })
        } else {
          const delay = Number(result.delayMs) || chatAgentBackoff(task.attempt)
          await this.#transition(task.task_id, 'wait', {
            owner,
            not_before: result.notBefore || new Date(Date.now() + delay).toISOString(),
            error: String(result.error || ''),
          })
        }
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
