import { describe, expect, it } from 'vitest'
import type { ChatItem } from '../../../types'
import { mergeDurableChatItems } from './chatHistory'

function item(index: number): ChatItem {
  return { id: `item-${index}`, role: index % 2 ? 'user' : 'harness', text: `Mensagem ${index}`, createdAt: new Date(index * 1000).toISOString() }
}

describe('durable chat hydration', () => {
  it('restores the complete backend transcript instead of replacing it with the 80-item cache', () => {
    const durable = Array.from({ length: 140 }, (_, index) => item(index))
    const local = durable.slice(-80)
    expect(mergeDurableChatItems(local, durable)).toEqual(durable)
  })

  it('keeps a local item that has not reached the backend yet without duplicating shared ids', () => {
    const durable = [item(1), item(2)]
    const local = [item(2), item(3)]
    expect(mergeDurableChatItems(local, durable).map((entry) => entry.id)).toEqual(['item-1', 'item-2', 'item-3'])
  })

  it('converges the optimistic user item with the backend request identity', () => {
    const iteration = { id: 'request-ref', requestId: 'req-1', phase: 'outbound' as const, artifacts: [] }
    const optimistic: ChatItem = { id: 'ui-1', role: 'user', text: 'Prompt', iteration, attachments: [{ name: 'notes', size: 10 }] }
    const durable: ChatItem = { id: 'request:req-1', role: 'user', text: 'Prompt', iteration }
    expect(mergeDurableChatItems([optimistic], [durable])).toEqual([optimistic])
  })

  it('keeps repeated text on separate requests and their lifecycle notices', () => {
    const user = (id: string, requestId: string): ChatItem => ({ id, role: 'user', text: 'Repeat', iteration: { id, requestId, phase: 'outbound', artifacts: [] } })
    const notice: ChatItem = { id: 'notice', role: 'harness', text: 'Submitted', iteration: { id: 'notice', requestId: 'req-1', phase: 'submitted', artifacts: [] } }
    expect(mergeDurableChatItems([user('ui-1', 'req-1')], [user('api-1', 'req-1'), user('api-2', 'req-2'), notice]).map((item) => item.id)).toEqual(['ui-1', 'api-2', 'notice'])
  })

  it('rehydrates full durable text over the same item id cached from a bounded event', () => {
    const iteration = { id: 'ref', requestId: 'req-1', phase: 'outbound' as const, artifacts: [] }
    const durable: ChatItem = { id: 'request:req-1', role: 'user', text: 'complete original input', iteration }
    expect(mergeDurableChatItems([{ ...durable, text: 'bounded preview' }], [durable])).toEqual([durable])
  })

  it('keeps optimistic metadata when an early backend event preceded request correlation', () => {
    const iteration = { id: 'ref', requestId: 'req-1', phase: 'outbound' as const, artifacts: [] }
    const optimistic: ChatItem = { id: 'ui', role: 'user', text: 'input', iteration, attachments: [{ name: 'notes', size: 2 }] }
    const backend: ChatItem = { id: 'request:req-1', role: 'user', text: 'input', iteration }
    const current = [optimistic, backend]
    expect(mergeDurableChatItems(current, current)).toEqual([optimistic])
  })
})
