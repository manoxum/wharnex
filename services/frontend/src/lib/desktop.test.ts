import { describe, expect, it } from 'vitest'
import { chatgptConversationURL, formatBytes } from './desktop'

describe('desktop helpers', () => {
  it('formats context bundle sizes', () => {
    expect(formatBytes(900)).toBe('900 B')
    expect(formatBytes(2048)).toBe('2.0 KB')
    expect(formatBytes(2 * 1024 * 1024)).toBe('2.0 MB')
  })

  it('recognizes stable ChatGPT conversation URLs without query data', () => {
    expect(chatgptConversationURL('https://chatgpt.com/c/abc?x=1#frag')).toBe('https://chatgpt.com/c/abc')
    expect(chatgptConversationURL('https://chatgpt.com/library')).toBe('')
    expect(chatgptConversationURL('https://chatgpt.com.evil.example/c/abc')).toBe('')
  })
})
