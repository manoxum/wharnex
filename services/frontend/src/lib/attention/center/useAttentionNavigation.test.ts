import { cleanup, renderHook } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { useAttentionNavigation } from './useAttentionNavigation'
import { collectNativeAttentionItems } from './nativeCompletion'
import { nativeCompletionFixture, nativeChatFixture } from './nativeCompletion.fixtures'
import type { Session } from '../../../types'
import type { AttentionItem } from './attentionCenter'

afterEach(cleanup)

it('acknowledges a newly completed background native chat when a previously registered Desktop handler opens it', async () => {
  const acknowledge = vi.fn(), selectChat = vi.fn(async () => undefined), setMode = vi.fn()
  const session = { id: 'session', project_path: '/project' } as Session
  const { result, rerender } = renderHook(({ items }: { items: AttentionItem[] }) => useAttentionNavigation({
    session, activeChatId: 'foreground', chats: [nativeChatFixture], allAttentionItems: items,
    chatgptHumanActionActive: false, acknowledge, setMode, selectChat,
    openHumanAction: vi.fn(async () => undefined), openRestart: vi.fn(async () => undefined), focusInspector: vi.fn(),
  }), { initialProps: { items: [] as AttentionItem[] } })
  const registeredHandler = result.current.openDesktopNotification
  const items = collectNativeAttentionItems('/project', [nativeChatFixture], [nativeCompletionFixture()])
  rerender({ items })
  await registeredHandler({ id: items[0].id, chatId: 'background', projectPath: '/project', kind: 'task-completed', title: 'Tarefa concluída', body: '', occurredAt: items[0].occurredAt! })
  expect(acknowledge).toHaveBeenCalledWith(items[0])
  expect(selectChat).toHaveBeenCalledWith('background')
  expect(setMode).toHaveBeenCalledWith('agent')
})
