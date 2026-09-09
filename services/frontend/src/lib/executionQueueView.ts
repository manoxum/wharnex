export type ExecutionFIFOStatus = 'submitting' | 'queued' | 'running' | 'completed' | 'failed'

export type ExecutionFIFOItem = {
  key: string
  chatId: string
  chatTitle: string
  planId: string
  status: ExecutionFIFOStatus
  position?: number
  addedAt: number
  completedAt?: number
}

const RECENT_TERMINAL_LIMIT = 5

export function executionQueueIsActive(item: ExecutionFIFOItem) {
  return item.status === 'submitting' || item.status === 'queued' || item.status === 'running'
}

export function executionQueueActiveCount(items: ExecutionFIFOItem[]) {
  return items.filter(executionQueueIsActive).length
}

export function upsertExecutionQueueItem(current: ExecutionFIFOItem[], next: ExecutionFIFOItem) {
  return compactExecutionQueue([...current.filter((item) => item.key !== next.key), next])
}

export function finishExecutionQueueItem(current: ExecutionFIFOItem[], key: string, status: 'completed' | 'failed', completedAt = Date.now()) {
  const existing = current.find((item) => item.key === key)
  if (!existing) return current
  return compactExecutionQueue([
    ...current.filter((item) => item.key !== key),
    { ...existing, status, position: undefined, completedAt },
  ])
}

export function visibleExecutionQueueItems(items: ExecutionFIFOItem[], chatIds: Iterable<string>) {
  const visibleChats = new Set(chatIds)
  return compactExecutionQueue(items.filter((item) => visibleChats.has(item.chatId)))
}

export function compactExecutionQueue(items: ExecutionFIFOItem[]) {
  const active = items.filter(executionQueueIsActive).sort(compareExecutionQueueItems)
  const recent = items
    .filter((item) => !executionQueueIsActive(item))
    .sort((left, right) => (right.completedAt || right.addedAt) - (left.completedAt || left.addedAt))
    .slice(0, RECENT_TERMINAL_LIMIT)
  return [...active, ...recent]
}

function compareExecutionQueueItems(a: ExecutionFIFOItem, b: ExecutionFIFOItem) {
  const rank = (item: ExecutionFIFOItem) => item.status === 'running' ? 0 : item.status === 'submitting' ? 1 : 2
  const rankDiff = rank(a) - rank(b)
  if (rankDiff) return rankDiff
  const left = a.position || Number.MAX_SAFE_INTEGER
  const right = b.position || Number.MAX_SAFE_INTEGER
  return left === right ? a.addedAt - b.addedAt : left - right
}
