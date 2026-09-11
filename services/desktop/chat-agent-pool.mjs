// Global ChatGPT browser topology.
//
// One authenticated Desktop process owns a small double-buffered Supervisor
// pool plus a bounded number of autonomous workers. Only one Supervisor is
// visible at a time; the second can finish a write or preload the next chat.
// Chats own durable conversation ids, not renderers; slots are affinity caches.

export const SUPERVISOR_SLOTS = 2
export const MIN_WORKER_SLOTS = 1
export const DEFAULT_WORKER_SLOTS = 6
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
    ...Array.from({ length: SUPERVISOR_SLOTS }, (_, index) => ({ id: `supervisor-${index + 1}`, role: 'supervisor' })),
    ...Array.from({ length: workers }, (_, index) => ({ id: `worker-${index + 1}`, role: 'worker' })),
  ]
}

export function assignRoles(slots) {
  const live = slots.filter((slot) => !slot.destroyed)
  if (!live.length) return []
  const supervisorIDs = new Set(live
    .filter((slot) => slot.role === 'supervisor' || /^supervisor(?:-|$)/.test(String(slot.id || '')))
    .slice(0, SUPERVISOR_SLOTS)
    .map((slot) => slot.id))
  for (const slot of live) {
    if (supervisorIDs.size >= SUPERVISOR_SLOTS) break
    supervisorIDs.add(slot.id)
  }
  return live.map((slot) => ({ ...slot, role: supervisorIDs.has(slot.id) ? 'supervisor' : 'worker' }))
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
