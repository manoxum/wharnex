import { describe, expect, it } from 'vitest'
import { nativeCompletionFixture, nativeChatFixture } from './nativeCompletion.fixtures'
import { collectNativeAttentionItems } from './nativeCompletion'
import { acknowledgeCompletedAttention, filterActiveAttentionItems } from './attentionHistory'

describe('native task completion attention', () => {
  it('projects a successful background/self-evolution turn without claiming host integration', () => {
    const items = collectNativeAttentionItems('/project', [nativeChatFixture], [nativeCompletionFixture({ selfEvolution: true })])
    expect(items).toEqual([expect.objectContaining({
      id: 'background:codex:task-completed:request', chatId: 'background', chatTitle: 'Segundo chat',
      title: 'Tarefa concluída', kind: 'task-completed', tone: 'success', requestId: 'request',
      occurredAt: '2026-10-15T10:00:01Z',
    })])
    expect(items[0].detail).toContain('Codex concluiu')
    expect(items[0].detail).not.toMatch(/verificad|aplicad|integração|ativação/i)
  })

  it.each(['idle', 'submitting', 'running', 'ready', 'attention', 'waiting'] as const)('does not announce %s as successful completion', (status) => {
    expect(collectNativeAttentionItems('/project', [nativeChatFixture], [nativeCompletionFixture({ status })])).toEqual([])
  })

  it('rejects foreign projects, absent chats, legacy threads and incomplete completion identities', () => {
    for (const patch of [{ projectPath: '/other' }, { chatId: 'other' }, { native: false }, { requestId: '' }, { completedAt: '' }, { completedAt: 'invalid' }]) {
      expect(collectNativeAttentionItems('/project', [nativeChatFixture], [nativeCompletionFixture(patch)])).toEqual([])
    }
    expect(collectNativeAttentionItems('', [nativeChatFixture], [nativeCompletionFixture()])).toEqual([])
  })

  it('keeps an alert singular across delivery/poll repetitions and distinct for the next request', () => {
    const first = nativeCompletionFixture()
    const next = nativeCompletionFixture({ requestId: 'next' })
    expect(collectNativeAttentionItems('/project', [nativeChatFixture], [first, first, next])).toHaveLength(2)
  })

  it('uses the shared durable acknowledgment without hiding a subsequent completion', () => {
    const items = collectNativeAttentionItems('/project', [nativeChatFixture], [nativeCompletionFixture(), nativeCompletionFixture({ requestId: 'next' })])
    const history = acknowledgeCompletedAttention('/project', items[0], [])
    expect(filterActiveAttentionItems(items, history)).toEqual([items[1]])
  })
})
