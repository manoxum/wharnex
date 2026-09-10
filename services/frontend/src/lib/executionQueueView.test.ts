import { describe, expect, it } from 'vitest'
import { finishExecutionQueueItem, visibleExecutionQueueItems, type ExecutionFIFOItem } from './executionQueueView'

function item(key: string, chatId: string, status: ExecutionFIFOItem['status'], timestamp: number): ExecutionFIFOItem {
  return { key, chatId, chatTitle: chatId, planId: key, status, position: status === 'queued' ? timestamp : undefined, addedAt: timestamp, completedAt: status === 'completed' || status === 'failed' ? timestamp : undefined }
}

describe('execution queue presentation', () => {
  it('keeps active work plus only the five latest terminal entries from non-archived chats', () => {
    const items = [
      item('running', 'chat-a', 'running', 1),
      item('archived', 'chat-archived', 'queued', 2),
      ...Array.from({ length: 6 }, (_, index) => item(`done-${index + 1}`, 'chat-a', 'completed', 10 + index)),
    ]
    const visible = visibleExecutionQueueItems(items, ['chat-a'])
    expect(visible.map((entry) => entry.key)).toEqual(['running', 'done-6', 'done-5', 'done-4', 'done-3', 'done-2'])
    expect(visible.some((entry) => entry.key === 'archived')).toBe(false)
  })

  it('preserves a finished execution as recent history instead of dropping it', () => {
    const current = [item('plan-1', 'chat-a', 'running', 1)]
    const next = finishExecutionQueueItem(current, 'plan-1', 'completed', 99)
    expect(next[0]).toMatchObject({ key: 'plan-1', status: 'completed', completedAt: 99 })
  })
})
