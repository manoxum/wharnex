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
})
