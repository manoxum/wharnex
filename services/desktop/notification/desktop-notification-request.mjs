const KINDS = new Set(['restart-pending', 'task-completed'])
const DEFAULT_TITLES = { 'restart-pending': 'Auto-evolução concluída', 'task-completed': 'Tarefa concluída' }
const LIMITS = { id: 512, chatId: 256, title: 160, body: 600, occurredAt: 64 }

function bounded(value, limit) {
  return String(value || '').trim().slice(0, limit)
}

// The renderer supplies this over IPC, so the record the tray keeps is built
// from a closed kind set and bounded text rather than from whatever arrived.
export function completionNotificationRecord(projectPath, request = {}) {
  const id = bounded(request.id, LIMITS.id)
  const chatId = bounded(request.chatId, LIMITS.chatId)
  const kind = KINDS.has(request.kind) ? request.kind : ''
  if (!id || !chatId || !kind) throw new Error('Invalid completion notification')
  return {
    id,
    projectPath,
    chatId,
    kind,
    title: bounded(request.title, LIMITS.title) || DEFAULT_TITLES[kind],
    body: bounded(request.body, LIMITS.body),
    occurredAt: String(request.occurredAt || new Date().toISOString()).slice(0, LIMITS.occurredAt),
  }
}
