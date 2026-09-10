// Slot sizing and role assignment for the chat-agent pool.
//
// The old model gave every Wharnex chat its own ChatGPT WebContentsView, so
// thirty chats meant thirty live Chromium renderers on the same authenticated
// partition. This model pools a small number of instances and rotates them
// across chats, which is why a handful of slots can serve any number of chats.
//
// Roles are not interchangeable:
//
//  - `view` is what the human is looking at. Exactly one slot holds it whenever
//    more than one slot exists, and it follows the active chat. It is never
//    handed background inspection, because a background navigation would yank
//    the page out from under the user.
//  - `worker` slots do everything else: sends, inspection, account operations.
//
// With a single chat there is nothing to inspect in the background, so one slot
// serves both purposes and the pool stays at its floor of one.

export const MIN_SLOTS = 1
export const DEFAULT_MAX_SLOTS = 3
// A slot costs a full Chromium renderer on the shared authenticated partition.
// The ceiling is deliberately small; raising it trades memory for parallelism.
export const HARD_MAX_SLOTS = 6

/**
 * How many slots a workspace with `chatCount` chats should hold.
 *
 * One chat needs one slot. Two or more chats need at least two, so the viewing
 * slot is never the slot doing background work. Beyond that the pool grows
 * towards `maxSlots` but never past the number of chats — a fourth slot with
 * three chats would idle forever.
 */
export function desiredSlotCount(chatCount, maxSlots = DEFAULT_MAX_SLOTS) {
  const ceiling = Math.min(HARD_MAX_SLOTS, Math.max(MIN_SLOTS, Math.floor(maxSlots) || DEFAULT_MAX_SLOTS))
  const chats = Math.max(0, Math.floor(chatCount) || 0)
  if (chats <= 1) return MIN_SLOTS
  return Math.min(ceiling, Math.max(2, Math.min(chats, ceiling)))
}

/**
 * Assigns roles across the live slots.
 *
 * `activeChatId` decides which slot is the viewing slot: a slot already showing
 * the active chat keeps the role, which avoids a needless navigation every time
 * roles are recomputed.
 */
export function assignRoles(slots, activeChatId = '') {
  const live = slots.filter((slot) => !slot.destroyed)
  if (!live.length) return []
  if (live.length === 1) return [{ ...live[0], role: 'view' }]

  const incumbent = live.find((slot) => slot.chatId && slot.chatId === activeChatId)
    || live.find((slot) => slot.role === 'view' && !slot.busy)
    || live.find((slot) => slot.role === 'view')
    || live.find((slot) => !slot.busy)
    || live[0]

  return live.map((slot) => ({ ...slot, role: slot.id === incumbent.id ? 'view' : 'worker' }))
}

/**
 * Picks the slot that should run a job.
 *
 * A write or read for the chat the user is watching goes to the viewing slot —
 * it is already on that conversation, and sending there is exactly what the user
 * expects to see happen. Everything else goes to a free worker, preferring one
 * already parked on the target conversation so no navigation is needed.
 *
 * Returns `undefined` when nothing is free; the caller leaves the job queued
 * rather than preempting a running slot.
 */
export function selectSlotForJob(slots, job, activeChatId = '') {
  const live = assignRoles(slots, activeChatId)
  const idle = live.filter((slot) => !slot.busy)
  if (!idle.length) return undefined

  const viewSlot = idle.find((slot) => slot.role === 'view')
  const workers = idle.filter((slot) => slot.role === 'worker')

  // Work for the visible chat belongs on the visible slot when it is free.
  if (job.chatId && job.chatId === activeChatId && viewSlot) return viewSlot

  const parked = workers.find((slot) => job.chatId && slot.chatId === job.chatId)
  if (parked) return parked

  // A read must never take the viewing slot: it would navigate the page the user
  // is reading. A write may, but only when no worker is free, because the user
  // is waiting on it.
  if (workers.length) return workers[0]
  if (job.kind === 'read') return undefined
  return viewSlot
}

/**
 * Which slot should be evicted when the pool must shrink. Never the viewing
 * slot, never a busy slot, and otherwise the least recently used.
 */
export function selectSlotForEviction(slots, activeChatId = '') {
  const live = assignRoles(slots, activeChatId)
  const candidates = live.filter((slot) => slot.role !== 'view' && !slot.busy)
  if (!candidates.length) return undefined
  return candidates.sort((a, b) => (a.lastUsed || 0) - (b.lastUsed || 0))[0]
}
