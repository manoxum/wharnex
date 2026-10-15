import { renderHook } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import type { ChatItem } from '../../../types'
import type { WorkspaceChat } from '../../chat/history/workspaceMemory'
import { useNativeActivity } from './useNativeActivity'

vi.mock('../useCodexStatus', () => ({ useCodexStatus: () => ({ threads: [{
  native: true, status: 'completed', projectPath: '/project', chatId: 'chat', threadId: 'thread', requestId: 'req', completedAt: '2026-10-15T12:00:00Z',
  messages: [{ id: 'answer', role: 'assistant', text: 'Feito.' }, { id: 'req-git-result', role: 'assistant', text: 'commit abc · versão v1.0.0.1' }],
  activities: [{ id: 'native-finalization', type: 'nativeResult', changes: [{ path: 'source.ts', diff: '--- a/source.ts\n+++ b/source.ts\n-old\n+new\n+line' }] }],
}] }) }))

it('restores native completion as the shared diff card with version and commit, without Apply or revert', () => {
  const chat: WorkspaceChat = { id: 'chat', title: 'Native', engine: 'codex', sessionId: 'session', createdAt: '', updatedAt: '' }
  let items: ChatItem[] = []
  const mutate = vi.fn((_chat, _project, change: (previous: ChatItem[]) => ChatItem[]) => { items = change(items) })
  const { rerender } = renderHook(() => useNativeActivity('/project', [chat], mutate))
  expect(items).toHaveLength(2)
  expect(items[1]).toMatchObject({ source: 'codex', presentation: 'change', text: 'commit abc · versão v1.0.0.1',
    change: { canRevert: false, requestId: 'req', files: [{ path: 'source.ts', additions: 2, deletions: 1 }] } })
  rerender()
  expect(items).toHaveLength(2)
})
