// Global ChatGPT browser topology.
//
// One authenticated Desktop process owns a Supervisor pool plus a small
// autonomous Worker pool. A Supervisor slot is bound to one Harness chat and
// keeps that conversation loaded, so selecting another chat is a visibility
// change rather than a provider navigation; chats still own durable
// conversation ids, and a slot remains an affinity cache, never ownership.
//
// The pool is deliberately supervisor-heavy. Every cross-conversation
// navigation is a real ChatGPT request, and a two-slot Supervisor pool had to
// evict and re-navigate on each chat switch — which is what produced sustained
// HTTP 429 pressure with the Worker pool completely stopped. Six resident
// Supervisors cover the conversations an operator actually alternates between,
// while small account-lifecycle and utility work needs far fewer slots.

export const DEFAULT_SUPERVISOR_SLOTS = 3
export const MIN_SUPERVISOR_SLOTS = 1
export const HARD_MAX_SUPERVISOR_SLOTS = 12
export const MIN_WORKER_SLOTS = 1
export const DEFAULT_WORKER_SLOTS = 2
export const HARD_MAX_WORKER_SLOTS = 6

// Task types the Supervisor pool owns: opening the chat, submitting the
// request bundle, collecting the response bundle, and following the remote
// conversation in real time. They all act on the conversation a Supervisor is
// already resident on, so routing them to a Worker would mean navigating a
// second renderer to a page that is already loaded.
export const SUPERVISOR_TASK_TYPES = Object.freeze([
  'AWAIT_RESPONSE', 'BOT_WRITE', 'RECOVERY_WRITE',
])

// Everything else is Worker work: renaming, organizing, archiving, deleting
// chats and library bundles, title discovery, and the non-executing Markdown
// translation utility.
export function isSupervisorTaskType(taskType) {
  return SUPERVISOR_TASK_TYPES.includes(String(taskType || '').trim().toUpperCase())
}

export function normalizeSupervisorSlotCount(supervisorSlots = DEFAULT_SUPERVISOR_SLOTS) {
  const numeric = Number(supervisorSlots)
  const requested = Number.isFinite(numeric) ? Math.floor(numeric) : DEFAULT_SUPERVISOR_SLOTS
  return Math.min(HARD_MAX_SUPERVISOR_SLOTS, Math.max(MIN_SUPERVISOR_SLOTS, requested))
}

export function normalizeWorkerSlotCount(workerSlots = DEFAULT_WORKER_SLOTS) {
  const numeric = Number(workerSlots)
  const requested = Number.isFinite(numeric) ? Math.floor(numeric) : DEFAULT_WORKER_SLOTS
  return Math.min(HARD_MAX_WORKER_SLOTS, Math.max(MIN_WORKER_SLOTS, requested))
}

export function desiredSlotCount(chatCount, supervisorSlots = DEFAULT_SUPERVISOR_SLOTS, workerSlots = DEFAULT_WORKER_SLOTS) {
  const chats = Math.max(0, Math.floor(Number(chatCount) || 0))
  if (!chats) return 0
  return normalizeSupervisorSlotCount(supervisorSlots) + normalizeWorkerSlotCount(workerSlots)
}

export function slotBlueprints(supervisorSlots = DEFAULT_SUPERVISOR_SLOTS, workerSlots = DEFAULT_WORKER_SLOTS) {
  const supervisors = normalizeSupervisorSlotCount(supervisorSlots)
  const workers = normalizeWorkerSlotCount(workerSlots)
  return [
    ...Array.from({ length: supervisors }, (_, index) => ({ id: `supervisor-${index + 1}`, role: 'supervisor' })),
    ...Array.from({ length: workers }, (_, index) => ({ id: `worker-${index + 1}`, role: 'worker' })),
  ]
}

// A slot is a Supervisor because it was declared or named one, capped at
// the configured supervisor count. Backfilling the cap from undeclared slots
// would now swallow the whole pool — with three Supervisor slots, a list of two
// Supervisors and three Workers would report five Supervisors and no Worker at
// all — so the backfill is limited to guaranteeing one human surface when
// nothing is declared.
export function assignRoles(slots, supervisorSlots = DEFAULT_SUPERVISOR_SLOTS) {
  const supervisorCap = normalizeSupervisorSlotCount(supervisorSlots)
  const live = slots.filter((slot) => !slot.destroyed)
  if (!live.length) return []
  const declared = live
    .filter((slot) => slot.role === 'supervisor' || /^supervisor(?:-|$)/.test(String(slot.id || '')))
    .slice(0, supervisorCap)
  const supervisorIDs = new Set(declared.map((slot) => slot.id))
  if (!supervisorIDs.size) supervisorIDs.add(live[0].id)
  return live.map((slot) => ({ ...slot, role: supervisorIDs.has(slot.id) ? 'supervisor' : 'worker' }))
}

// Scheduler jobs are autonomous by definition. Initial human sends and user
// comments bypass this selector and use the Supervisor directly. Consequently
// no background Worker job can ever fall back to the visible surface.
export function selectSlotForJob(slots, job) {
  const workers = assignRoles(slots).filter((slot) => slot.role === 'worker' && !slot.busy)
  if (!workers.length) return undefined
  const conversationID = String(job?.conversationId || job?.conversation_id || '')
  const chatID = String(job?.chatId || job?.chat_id || '')
  return workers.find((slot) => conversationID && slot.conversationId === conversationID)
    || workers.find((slot) => chatID && slot.chatId === chatID)
    || workers[0]
}

export function selectSlotForEviction(slots) {
  const candidates = assignRoles(slots).filter((slot) => slot.role === 'worker' && !slot.busy)
  if (!candidates.length) return undefined
  return [...candidates].sort((a, b) => (a.lastUsed || 0) - (b.lastUsed || 0))[0]
}

// Which bound Supervisor slot may give its chat up for a chat that is waiting.
//
// A Supervisor unbinds only when it has nothing left to finish — the request
// completed and its valid bundle was collected — and only because another chat
// needs a slot. Releasing on a timer instead would re-create the churn this
// topology exists to remove: the freed conversation is reloaded the next time
// the operator looks at it.
export function selectSupervisorForRebind(slots) {
  const candidates = slots.filter((slot) => !slot.destroyed && !slot.held)
  if (!candidates.length) return undefined
  return [...candidates].sort((a, b) => {
    const leftActive = a.active === true ? 1 : 0
    const rightActive = b.active === true ? 1 : 0
    if (leftActive !== rightActive) return leftActive - rightActive
    return Number(a.lastUsed || 0) - Number(b.lastUsed || 0)
  })[0]
}

export function canonicalConversationID(value = '') {
  const raw = String(value || '').trim()
  const match = raw.match(/\/c\/([^/?#]+)/)
  const id = match ? match[1] : raw
  if (!id || id.includes(':') || !/^[A-Za-z0-9-]+$/.test(id) || id.length > 128) return ''
  return id
}

export function canonicalConversationURL(value = '') {
  const id = canonicalConversationID(value)
  return id ? `https://chatgpt.com/c/${id}` : ''
}
