import { randomUUID } from 'node:crypto'
import { ChatAgentQueueClient } from './queue-client.mjs'
import { chatAgentIdleDelay, DEFAULT_CHAT_AGENT_IDLE_CEILING_MS } from './idle-backoff.mjs'
import { settleTaskError, settleTaskResult } from './settlement.mjs'

export const DEFAULT_CHAT_AGENT_WORKERS = 3
export const DEFAULT_CHAT_AGENT_LEASE_SECONDS = 45
export const DEFAULT_CHAT_AGENT_TASK_COOLDOWN_MS = 2_500

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const list = (value) => (Array.isArray(value) ? value : [])

// Runs a bounded pool of claim loops against the durable queue. The queue owns
// task state; this client only claims, executes, heartbeats and settles.
export class ChatAgentSchedulerClient extends ChatAgentQueueClient {
  constructor({
    baseURL, fetchImpl = fetch, execute,
    workerCount = DEFAULT_CHAT_AGENT_WORKERS, maxWorkers = 3,
    leaseSeconds = DEFAULT_CHAT_AGENT_LEASE_SECONDS, idleMs = 750, idleCeilingMs = DEFAULT_CHAT_AGENT_IDLE_CEILING_MS,
    taskCooldownMs = DEFAULT_CHAT_AGENT_TASK_COOLDOWN_MS, claimOptions = () => ({}), onIdle = () => {}, onState = () => {},
    // Pool identity. The durable queue partitions task types by pool role and
    // enforces Worker pins by canonical agent id, so a second pool driving the
    // same queue must name itself rather than inherit the Worker namespace.
    role = '', agentID = (index) => `worker-${index}`,
  }) {
    super({ baseURL, fetchImpl })
    if (typeof execute !== 'function') throw new Error('chat-agent scheduler execute callback is required')
    this.execute = execute
    this.role = String(role || '')
    this.agentID = typeof agentID === 'function' ? agentID : (index) => `worker-${index}`
    this.maxWorkers = Math.max(1, Math.floor(maxWorkers) || 1)
    this.workerCount = this.#boundedCount(workerCount, DEFAULT_CHAT_AGENT_WORKERS)
    this.leaseSeconds = leaseSeconds
    this.idleMs = idleMs
    this.idleCeilingMs = idleCeilingMs
    this.wakeEpoch = 0
    this.taskCooldownMs = Math.max(0, Number(taskCooldownMs) || 0)
    this.claimOptions = typeof claimOptions === 'function' ? claimOptions : () => ({})
    // Reported on every claim that found nothing. A worker that keeps claiming
    // an empty lane is the only evidence available that the lane has no work,
    // and it is what lets residency expire instead of pinning the slot forever.
    this.onIdle = typeof onIdle === 'function' ? onIdle : () => {}
    this.onState = onState
    this.instanceID = `desktop-${randomUUID()}`
    this.running = false
    this.loops = new Map()
    this.idleWaiters = new Set()
  }

  #boundedCount(value, fallback) {
    const numeric = Number(value)
    return Math.min(this.maxWorkers, Math.max(1, Number.isFinite(numeric) ? Math.floor(numeric) : fallback))
  }

  start() {
    if (this.running) return
    this.running = true
    this.#reconcileLoops()
    this.onState({ kind: 'scaled', workerCount: this.workerCount })
  }

  async stop() {
    this.running = false
    this.wake()
    await Promise.allSettled([...this.loops.values()])
    this.loops.clear()
  }

  setWorkerCount(value) { return this.#resize(this.#boundedCount(value, DEFAULT_CHAT_AGENT_WORKERS)) }
  setSupervisorCount(value) { return this.#resize(this.#boundedCount(value, 1)) }

  #resize(next) {
    if (next === this.workerCount) return this.workerCount
    this.workerCount = next
    if (this.running) this.#reconcileLoops()
    this.wake()
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

  wake() {
    this.wakeEpoch++
    for (const resolve of this.idleWaiters) resolve()
    this.idleWaiters.clear()
  }

  #waitForWork(milliseconds) {
    return new Promise((resolve) => {
      let settled = false
      const finish = () => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        this.idleWaiters.delete(finish)
        resolve()
      }
      const timer = setTimeout(finish, Math.max(0, Number(milliseconds) || 0))
      this.idleWaiters.add(finish)
    })
  }

  #claimBody(owner, agent, claim) {
    return {
      owner, lease_seconds: this.leaseSeconds, worker_id: agent, role: this.role,
      preferred_lane: String(claim.preferred_lane || ''),
      excluded_lanes: list(claim.excluded_lanes),
      excluded_types: list(claim.excluded_types),
      fallback_mode: String(claim.fallback_mode || 'any'),
      // project_scoped is separate from the list because "no project is open"
      // and "this caller cannot know the window topology" are opposite
      // instructions that an empty list cannot distinguish.
      project_scoped: claim.project_scoped === true,
      open_projects: list(claim.open_projects),
    }
  }

  async #workerLoop(index) {
    const agent = String(this.agentID(index) || `worker-${index}`)
    const owner = `${this.instanceID}:${agent}`
    let emptyClaims = 0
    let seenWake = this.wakeEpoch
    while (this.running && index <= this.workerCount) {
      try {
        const claim = await this.claimOptions(index) || {}
        if (claim.skip === true) { await wait(this.idleMs); continue }
        const task = (await this.api.claim(this.#claimBody(owner, agent, claim)))?.task
        if (!task) {
          this.onIdle(index)
          if (seenWake !== this.wakeEpoch) { seenWake = this.wakeEpoch; emptyClaims = 0 }
          emptyClaims++
          await this.#waitForWork(chatAgentIdleDelay(emptyClaims, this.idleMs, this.idleCeilingMs))
          continue
        }
        emptyClaims = 0
        const result = await this.#runTask(owner, task, index)
        // A passive observation never touched the provider: it read an
        // already-resident page and handed the slot straight back. Charging it
        // the provider cooldown spent real pool capacity protecting a request
        // that was never made. The cooldown exists for work that reached ChatGPT.
        const cooled = result?.observation === true ? 0 : this.taskCooldownMs
        if (this.running && index <= this.workerCount && cooled > 0) await wait(cooled)
      } catch (error) {
        this.onState({ kind: 'worker-error', worker: index, error })
        await wait(Math.max(this.idleMs, 1_000))
      }
    }
  }

  async #runTask(owner, task, worker) {
    await this.api.transition(task.task_id, 'start', { owner })
    this.onState({ kind: 'running', worker, task })
    const heartbeat = setInterval(() => {
      void this.api.transition(task.task_id, 'heartbeat', { owner, lease_seconds: this.leaseSeconds })
        .catch((error) => this.onState({ kind: 'heartbeat-error', worker, task, error }))
    }, Math.max(5_000, Math.floor(this.leaseSeconds * 500)))
    try {
      const result = await this.execute(task, { worker, owner })
      const running = this.running
      await settleTaskResult(this.api, task, owner, result, { running })
      if (running || result?.status === 'done') this.onState({ kind: 'settled', worker, task, result })
      return result
    } catch (error) {
      const outcome = await settleTaskError(this.api, task, owner, error)
      this.onState({ kind: 'task-error', worker, task, error })
      return outcome
    } finally {
      clearInterval(heartbeat)
    }
  }
}
