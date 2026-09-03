import { describe, expect, it } from 'vitest'
import { chatgptAutoBindingDecision, chatgptConversationURL, formatBytes, isChatGPTNewChatURL, sameChatGPTConversation } from './desktop'

describe('desktop helpers', () => {
  it('formats context bundle sizes', () => {
    expect(formatBytes(900)).toBe('900 B')
    expect(formatBytes(2048)).toBe('2.0 KB')
    expect(formatBytes(2 * 1024 * 1024)).toBe('2.0 MB')
  })

  it('recognizes stable ChatGPT conversation URLs without query data', () => {
    expect(chatgptConversationURL('https://chatgpt.com/c/abc?x=1#frag')).toBe('https://chatgpt.com/c/abc')
    expect(chatgptConversationURL('https://chatgpt.com/c/abc/')).toBe('https://chatgpt.com/c/abc')
    expect(chatgptConversationURL('https://foo.chatgpt.com/c/abc/extra?x=1')).toBe('https://chatgpt.com/c/abc')
    expect(chatgptConversationURL('https://chatgpt.com/library')).toBe('')
    expect(chatgptConversationURL('https://chatgpt.com.evil.example/c/abc')).toBe('')
  })

  it('compares linked conversations by canonical conversation id', () => {
    expect(sameChatGPTConversation('https://chatgpt.com/c/abc', 'https://chatgpt.com/c/abc/?model=x')).toBe(true)
    expect(sameChatGPTConversation('https://foo.chatgpt.com/c/abc', 'https://chatgpt.com/c/abc')).toBe(true)
    expect(sameChatGPTConversation('https://chatgpt.com/c/abc', 'https://chatgpt.com/c/xyz')).toBe(false)
    expect(sameChatGPTConversation('https://chatgpt.com/', 'https://chatgpt.com/c/abc')).toBe(false)
  })
})


describe('ChatGPT new Harness-chat binding', () => {
  it('recognizes only the trusted home surface as an unbound new-chat surface', () => {
    expect(isChatGPTNewChatURL('https://chatgpt.com/')).toBe(true)
    expect(isChatGPTNewChatURL('https://chatgpt.com/?model=auto')).toBe(true)
    expect(isChatGPTNewChatURL('https://chatgpt.com/c/existing')).toBe(false)
    expect(isChatGPTNewChatURL('https://chatgpt.com/library')).toBe(false)
  })

  it('does not bind a conversation that was already open before the new-chat surface is observed', () => {
    const initial = chatgptAutoBindingDecision(undefined, 'https://chatgpt.com/c/existing', false, false)
    expect(initial).toEqual({ newChatSurfaceSeen: false, bindURL: '' })
  })

  it('binds only after home/new-chat is observed and ChatGPT assigns a concrete conversation URL', () => {
    const home = chatgptAutoBindingDecision(undefined, 'https://chatgpt.com/', false, false)
    expect(home).toEqual({ newChatSurfaceSeen: true, bindURL: '' })
    const created = chatgptAutoBindingDecision(undefined, 'https://chatgpt.com/c/new-conversation?model=auto', false, home.newChatSurfaceSeen)
    expect(created.bindURL).toBe('https://chatgpt.com/c/new-conversation')
  })

  it('never auto-rebinds a Harness chat that already has a linked conversation', () => {
    const decision = chatgptAutoBindingDecision('https://chatgpt.com/c/linked', 'https://chatgpt.com/c/other', false, true)
    expect(decision.bindURL).toBe('')
  })
})
