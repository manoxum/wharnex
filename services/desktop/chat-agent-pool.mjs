// Global ChatGPT browser topology.
//
// One authenticated Desktop process owns exactly one human-facing Supervisor
// plus a bounded number of autonomous workers. Chats own durable conversation
// ids, not renderers; slots are parked on conversations only as an affinity
// cache.

export const SUPERVISOR_SLOTS = 1
export const MIN_WORKER_SLOTS = 1
export const DEFAULT_WORKER_SLOTS = 3
export const DEFAULT_TOTAL_SLOTS = SUPERVISOR_SLOTS + DEFAULT_WORKER_SLOTS
export const HARD_MAX_WORKER_SLOTS = 6

export function normalizeWorkerSlotCount(workerSlots = DEFAULT_WORKER_SLOTS) {
  const numeric = Number(workerSlots)
  const requested = Number.isFinite(numeric) ? Math.floor(numeric) : DEFAULT_WORKER_SLOTS
  return Math.min(HARD_MAX_WORKER_SLOTS, Math.max(MIN_WORKER_SLOTS, requested))
}

export function desiredSlotCount(chatCount, workerSlots = DEFAULT_WORKER_SLOTS) {
  const chats = Math.max(0, Math.floor(Number(chatCount) || 0))
  if (!chats) return 0
  return SUPERVISOR_SLOTS + normalizeWorkerSlotCount(workerSlots)
}

export function slotBlueprints(workerSlots = DEFAULT_WORKER_SLOTS) {
  const workers = normalizeWorkerSlotCount(workerSlots)
  return [
    { id: 'supervisor', role: 'supervisor' },
    ...Array.from({ length: workers }, (_, index) => ({ id: `worker-${index + 1}`, role: 'worker' })),
  ]
}

export function assignRoles(slots) {
  const live = slots.filter((slot) => !slot.destroyed)
  if (!live.length) return []
  let supervisor = live.find((slot) => slot.id === 'supervisor' || slot.role === 'supervisor')
  if (!supervisor) supervisor = live[0]
  return live.map((slot) => ({ ...slot, role: slot.id === supervisor.id ? 'supervisor' : 'worker' }))
}

// Scheduler jobs are autonomous by definition. Initial human sends and user
// comments bypass this selector and use the Supervisor directly. Consequently
// no background job can ever fall back to the visible surface.
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
