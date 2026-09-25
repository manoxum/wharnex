const WRITE_TYPES = new Set(['BOT_WRITE', 'RECOVERY_WRITE'])
const ACTIVE_STATUSES = new Set(['PENDING', 'LEASED', 'RUNNING', 'WAITING'])

export function classifyChatGPTRequestDelivery(tasks, chatId) {
  const writes = (Array.isArray(tasks) ? tasks : []).filter(
    (task) => WRITE_TYPES.has(String(task?.type || '')) && String(task?.chat_id || '') === chatId,
  )
  if (writes.some((task) => task.status === 'DONE')) return 'submitted'
  if (writes.some((task) => ACTIVE_STATUSES.has(String(task?.status || '')))) return 'writing'
  if (writes.length) return 'not_submitted'
  return 'untracked'
}
