import { renderHook, cleanup } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { useCompletionNotifications } from './useCompletionNotifications'
import { collectNativeAttentionItems } from '../../lib/attention'
import { nativeCompletionFixture, nativeChatFixture } from '../../lib/attention/center/nativeCompletion.fixtures'
import type { AttentionItem } from '../../lib/attention'
import type { CodexThread } from '../../lib/codex/contracts'

const { publish } = vi.hoisted(() => ({ publish: vi.fn(async (notice: DesktopCompletionNotification) => ({ ok: true, duplicate: false, id: notice.id })) }))
vi.mock('../../lib/desktop/bridge/desktop', () => ({ desktopBridge: () => ({ notifications: { publish } }) }))
const items = (thread: CodexThread) => collectNativeAttentionItems('/project', [nativeChatFixture], [thread])

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-15T10:00:00Z')); publish.mockClear() })
afterEach(() => { cleanup(); vi.useRealTimers() })

it('publishes a native background completion once through the same channel as Scraper', () => {
  const { rerender } = renderHook(({ threads }) => useCompletionNotifications('/project', threads.flatMap(items)), {
    initialProps: { threads: [nativeCompletionFixture({ status: 'running' })] },
  })
  expect(publish).not.toHaveBeenCalled()
  const completed = nativeCompletionFixture({ selfEvolution: true })
  rerender({ threads: [completed] })
  rerender({ threads: [{ ...completed }] })
  expect(publish).toHaveBeenCalledTimes(1)
  expect(publish).toHaveBeenCalledWith({
    id: 'background:codex:task-completed:request', projectPath: '/project', chatId: 'background',
    kind: 'task-completed', title: 'Tarefa concluída', body: expect.stringContaining('Codex concluiu'),
    occurredAt: completed.completedAt,
  })
  rerender({ threads: [nativeCompletionFixture({ requestId: 'next' })] })
  expect(publish).toHaveBeenCalledTimes(2)
})

it('does not replay restored completions or announce failures, interruptions or pending finalization', () => {
  const { rerender } = renderHook(({ thread }) => useCompletionNotifications('/project', items(thread)), {
    initialProps: { thread: nativeCompletionFixture({ completedAt: '2026-10-15T09:00:00Z' }) },
  })
  for (const status of ['attention', 'idle', 'waiting', 'running'] as const) rerender({ thread: nativeCompletionFixture({ status }) })
  expect(publish).not.toHaveBeenCalled()
})

it('preserves the shared Scraper completion and restart behavior', () => {
  const completion: AttentionItem = { id: 'scraper', chatId: 'scraper-chat', chatTitle: 'Scraper', kind: 'task-completed', title: 'Tarefa concluída', detail: 'Host integrado', tone: 'success', occurredAt: '2026-10-15T10:00:01Z' }
  renderHook(() => useCompletionNotifications('/project', [completion, { ...completion, id: 'restart', kind: 'restart-pending', occurredAt: '2026-10-15T09:00:00Z' }]))
  expect(publish).toHaveBeenCalledTimes(2)
  expect(publish.mock.calls.map(([notice]) => notice.id)).toEqual(['scraper', 'restart'])
})

it('absorbs notification service failures without disrupting the task or resending it', async () => {
  publish.mockRejectedValueOnce(new Error('OS unavailable'))
  const completed = items(nativeCompletionFixture())
  const { rerender } = renderHook(() => useCompletionNotifications('/project', completed))
  await Promise.resolve()
  rerender()
  expect(publish).toHaveBeenCalledTimes(1)
})
