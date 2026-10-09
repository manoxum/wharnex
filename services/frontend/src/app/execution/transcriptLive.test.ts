import { act, renderHook } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import type { LiveEventStream } from '../../lib/transport/http/liveEventStream'
import { openSessionEvents } from '../../lib/transport/http/sessionEvents'
import { api } from '../../lib/transport/http/api'
import { useEventStreamConnection } from './useEventStreamConnection'

vi.mock('../../lib/transport/http/api', () => ({ api: { eventsURL: () => '/events', getSession: vi.fn(), workspaceChatItems: vi.fn() } }))
vi.mock('../../lib/transport/http/sessionEvents', () => ({ openSessionEvents: vi.fn() }))
vi.mock('../../lib/chat/history/workspaceMemory', () => ({
  loadExecutionHistory: () => [], saveExecutionHistory: vi.fn(),
  loadWorkspaceChats: () => [{ id: 'chat', title: 'Owned chat' }],
}))
afterEach(() => vi.clearAllMocks())

it('projects a durable API prompt live only to its owning chat', async () => {
  const stream: LiveEventStream = { onmessage: null, onerror: null, onopen: null, close: vi.fn() }
  vi.mocked(openSessionEvents).mockReturnValue(stream)
  const params: Parameters<typeof useEventStreamConnection>[0] = {
    sourceRef: { current: null }, coalescerRef: { current: undefined },
    sessionCacheRef: { current: {} }, activeChatIdRef: { current: 'chat' },
    setEvents: vi.fn(), setSession: vi.fn(), setHostAppliedPresentation: vi.fn(),
    setExecutionFIFO: vi.fn(), appendChatItem: vi.fn(),
  }
  const item = { id: 'request:req-api', role: 'user' as const, text: 'Validate live API with the complete durable prompt', createdAt: '2026-10-08T16:35:10Z' }
  vi.mocked(api.workspaceChatItems).mockResolvedValue({ items: [{ id: item.id, chat_id: 'chat', created_at: item.createdAt, payload: item }] })
  const { result, unmount } = renderHook(() => useEventStreamConnection(params))
  act(() => result.current('session', '/project', 'chat'))
  await act(async () => {
    for (const chatId of ['other-chat', 'chat']) {
      stream.onmessage?.({ data: JSON.stringify({ id: `event-${chatId}`, session_id: 'session', type: 'workspace_chat.item_upserted', timestamp: item.createdAt, data: { chat_id: chatId, item: { ...item, text: 'bounded audit snippet' } } }) })
    }
    params.coalescerRef.current?.flushPending()
  })
  expect(params.appendChatItem).toHaveBeenCalledTimes(1)
  expect(api.workspaceChatItems).toHaveBeenCalledOnce()
  expect(params.appendChatItem).toHaveBeenCalledWith({ id: 'chat', title: 'Owned chat' }, '/project', item)
  params.coalescerRef.current?.dispose()
  unmount()
})
