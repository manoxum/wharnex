import { AsyncLocalStorage } from 'node:async_hooks'

// What a Worker is doing inside its current task. "Occupied" alone hid the
// difference between a Worker waiting its turn at the global pacer and one
// whose request is already being processed by ChatGPT. The phase is a closed
// code; the renderer owns the wording, and nothing from the page is carried.
export const WORKER_ACTIVITY_PHASES = new Set([
  'claimed', 'waiting_turn', 'navigating', 'preparing', 'uploading',
  'submitting', 'processing', 'downloading', 'validating',
])

export class WorkerActivity {
  constructor({ now = () => Date.now(), onChange = () => {} } = {}) {
    this.now = now
    this.onChange = onChange
    this.storage = new AsyncLocalStorage()
    this.slots = new Map()
  }

  // `priority` raises a whole task above ordinary Worker actions at the pacer;
  // ephemeral utility Workers (translation, planning, release notes) use it.
  run(slotId, taskId, fn, { priority = 0 } = {}) {
    const id = String(slotId || '')
    const context = { slotId: id, taskId: String(taskId || ''), providerActions: 0, priority: Math.max(0, Number(priority) || 0) }
    this.record(context, 'claimed')
    const clear = () => {
      if (this.slots.get(id)?.task_id === context.taskId) {
        this.slots.delete(id)
        this.onChange()
      }
    }
    return this.storage.run(context, async () => {
      try {
        return await fn()
      } finally {
        clear()
      }
    })
  }

  record(context, phase) {
    if (!context?.slotId) return
    this.slots.set(context.slotId, {
      phase: WORKER_ACTIVITY_PHASES.has(phase) ? phase : 'claimed',
      since: new Date(this.now()).toISOString(),
      task_id: context.taskId,
    })
    this.onChange()
  }

  current() {
    return this.storage.getStore()
  }

  set(phase) {
    const context = this.current()
    if (context) this.record(context, phase)
  }

  // For page events (a download starting) that run outside the task's async
  // context. Only a Worker that is running a task may be updated.
  setFor(slotId, phase) {
    const existing = this.slots.get(String(slotId || ''))
    if (existing) this.record({ slotId: String(slotId), taskId: existing.task_id }, phase)
  }

  async during(phase, fn) {
    const context = this.current()
    const previous = context ? this.slots.get(context.slotId)?.phase : undefined
    this.set(phase)
    try {
      return await fn()
    } finally {
      if (context && previous && this.slots.get(context.slotId)?.phase === phase) this.record(context, previous)
    }
  }

  markProviderAction() {
    const context = this.current()
    if (context) context.providerActions += 1
  }

  // A task that already reached ChatGPT finishes before new tasks start.
  pacePriority() {
    const context = this.current()
    return Math.max(context?.priority || 0, (context?.providerActions || 0) > 0 ? 1 : 0)
  }

  snapshot(slotId) {
    const value = this.slots.get(String(slotId || ''))
    return value ? { ...value } : null
  }
}
