import type { ChatItem, ChatIterationRef } from '../../../types'

export function hasRecordedRequest(items: ChatItem[], requestId: string, phases?: ChatIterationRef['phase'][]) {
  if (!requestId) return false
  return items.some((item) => item.iteration?.requestId === requestId && (!phases?.length || phases.includes(item.iteration.phase)))
}
