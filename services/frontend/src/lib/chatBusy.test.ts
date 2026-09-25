import { describe, expect, it } from 'vitest'
import { activeChatBusy } from './chatBusy'

describe('activeChatBusy', () => {
  it('does not block another chat with an operation owned by a different chat', () => {
    expect(activeChatBusy({
      activeChatId: 'chat-2',
      busyChats: {},
      globalBusy: true,
      globalBusyOwnerChatId: 'chat-1',
    })).toBe(false)
  })

  it('keeps the owning chat and explicitly busy chats blocked', () => {
    expect(activeChatBusy({ activeChatId: 'chat-1', busyChats: {}, globalBusy: true, globalBusyOwnerChatId: 'chat-1' })).toBe(true)
    expect(activeChatBusy({ activeChatId: 'chat-2', busyChats: { 'chat-2': true }, globalBusy: false, globalBusyOwnerChatId: '' })).toBe(true)
  })

  it('treats ownerless global work as project-wide', () => {
    expect(activeChatBusy({ activeChatId: 'chat-2', busyChats: {}, globalBusy: true, globalBusyOwnerChatId: '' })).toBe(true)
  })
})
