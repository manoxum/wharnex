import { afterEach, expect, it, vi } from 'vitest'
import type { ChatItem } from '../../../types'
import { createTranscriptAppender, createTranscriptMutator } from './appender'

vi.mock('../../../lib/transport/http/api', () => ({ api: { saveWorkspaceChat: vi.fn(async () => undefined) } }))
vi.mock('../../../lib/chat/history/workspaceMemory', () => ({
  loadChat: () => [], saveWorkspaceChats: vi.fn(), durableWorkspaceChat: vi.fn(),
}))
afterEach(() => vi.clearAllMocks())

it('converges when the durable event precedes the API request identity', () => {
  let items: ChatItem[] = [
    { id: 'optimistic', role: 'user', text: 'Validate API' },
    { id: 'request:req-live', role: 'user', text: 'Validate API', iteration: { id: 'round', requestId: 'req-live', phase: 'outbound', artifacts: ['prompt'] } },
  ]
  const mutate = createTranscriptMutator({ activeChat: () => 'chat', queueMutation: vi.fn(), setItems: (update) => { items = typeof update === 'function' ? update(items) : update } })
  mutate({ id: 'chat', title: 'Chat', sessionId: 'session', createdAt: '2026-10-08', updatedAt: '2026-10-08' }, '/project', (current) => current.map((item) => item.id === 'optimistic' ? { ...item, iteration: { id: 'round', requestId: 'req-live', phase: 'outbound', artifacts: ['prompt'] } } : item))
  expect(items).toHaveLength(1)
})

it('merges a live durable prompt into current state without duplicating the optimistic request', () => {
  const optimistic: ChatItem = { id: 'optimistic', role: 'user', text: 'Validate API', iteration: { id: 'round', requestId: 'req-live', phase: 'outbound', artifacts: ['prompt'] } }
  let items = [optimistic]
  const append = createTranscriptAppender({
    activeChat: () => 'chat', setChats: vi.fn(), queueMutation: vi.fn(),
    setItems: (update) => { items = typeof update === 'function' ? update(items) : update },
  })
  const durable = { ...optimistic, id: 'request:req-live' }
  append({ id: 'chat', title: 'Chat', sessionId: 'session', createdAt: '2026-10-08', updatedAt: '2026-10-08' }, '/project', durable)
  expect(items).toHaveLength(1)
  expect(items[0].text).toBe('Validate API')
})

it('queues a background owner mutation and leaves the visible chat unchanged', () => {
  const setItems = vi.fn(), queueMutation = vi.fn()
  const append = createTranscriptAppender({ activeChat: () => 'visible', setItems, setChats: vi.fn(), queueMutation })
  append({ id: 'background', title: 'Chat', sessionId: 'session', createdAt: '2026-10-08', updatedAt: '2026-10-08' }, '/project', { id: 'request:background', role: 'user', text: 'Validate API' })
  expect(setItems).not.toHaveBeenCalled()
  expect(queueMutation).toHaveBeenCalledWith('background', '/project', expect.any(Function))
})
