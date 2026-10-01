import { act, renderHook } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import type { LiveEventStream } from '../../lib/transport/http/liveEventStream'
import { api } from '../../lib/transport/http/api'
import { openSessionEvents } from '../../lib/transport/http/sessionEvents'
import { useEventStreamConnection } from './useEventStreamConnection'

vi.mock('../../lib/transport/http/api', () => ({ api: { eventsURL: vi.fn(() => '/events'), getSession: vi.fn() } }))
vi.mock('../../lib/transport/http/sessionEvents', () => ({ openSessionEvents: vi.fn() }))
vi.mock('../../lib/chat/history/workspaceMemory', () => ({
  loadExecutionHistory: () => [], loadWorkspaceChats: () => [], saveExecutionHistory: vi.fn(),
}))
afterEach(() => vi.clearAllMocks())

it.each(['chat', 'another-chat'])('refreshes settled state and projects completion with active chat %s', async (activeChat) => {
  const stream: LiveEventStream = { onmessage: null, onerror: null, onopen: null, close: vi.fn() }
  vi.mocked(openSessionEvents).mockReturnValue(stream)
  // Leave the response pending: this verifies the real stream triggers the read
  // and the completion projection without manufacturing a Session fixture.
  vi.mocked(api.getSession).mockImplementation(() => new Promise(() => {}))
  const params: Parameters<typeof useEventStreamConnection>[0] = {
    sourceRef: { current: null }, coalescerRef: { current: undefined },
    sessionCacheRef: { current: {} }, activeChatIdRef: { current: activeChat },
    setEvents: vi.fn(), setSession: vi.fn(), setHostAppliedPresentation: vi.fn(),
    setExecutionFIFO: vi.fn(), appendChatItem: vi.fn(),
  }
  const { result, unmount } = renderHook(() => useEventStreamConnection(params))
  act(() => result.current('session', '/project', 'chat'))
  await act(async () => {
    stream.onmessage?.({ data: JSON.stringify({ id: 'settled', session_id: 'session', type: 'host.apply_settled', timestamp: '2026-10-01T12:00:20Z', data: { state: 'applied', applied_changes: 1 } }) })
    params.coalescerRef.current?.flushPending()
  })
  params.coalescerRef.current?.dispose()
  unmount()
  expect(api.getSession).toHaveBeenCalledWith('session')
  expect(params.setHostAppliedPresentation).toHaveBeenCalledWith({ eventId: 'settled', sessionId: 'session', projectPath: '/project', chatId: 'chat' })
  expect(params.setExecutionFIFO).not.toHaveBeenCalled()
})
