import { describe, expect, it } from 'vitest'
import { MAX_RESIDENT_CHAT_PANES, residentPoolChats } from './chatPanePool'
import type { WorkspaceChat } from './workspaceMemory'

function chat(id: string, updatedAt: string): WorkspaceChat {
  return { id, title: id, sessionId: `ses-${id}`, createdAt: updatedAt, updatedAt }
}

describe('resident ChatGPT pane pool', () => {
  it('keeps every chat when the workspace is small', () => {
    const chats = [chat('a', '3'), chat('b', '2')]
    expect(residentPoolChats(chats, 'a')).toHaveLength(2)
  })

  // Each pane owns bridge subscriptions and re-renders on remote state, so
  // mounting one per chat made the cost grow with the chat count. A workspace
  // of thirty blocked the renderer's main thread while a ChatGPT surface
  // loaded, and the window was killed and restarted in a loop.
  it('bounds the pool once the workspace grows', () => {
    const chats = Array.from({ length: 30 }, (_, i) => chat(`c${i}`, String(i).padStart(2, '0')))
    expect(residentPoolChats(chats, 'c0')).toHaveLength(MAX_RESIDENT_CHAT_PANES)
  })

  // The chat the user is looking at must never be evicted, however old it is.
  it('always keeps the active chat resident', () => {
    const chats = Array.from({ length: 30 }, (_, i) => chat(`c${i}`, String(i).padStart(2, '0')))
    const resident = residentPoolChats(chats, 'c0')
    expect(resident.map((c) => c.id)).toContain('c0')
    expect(resident[0].id).toBe('c0')
  })

  it('fills the remaining slots with the most recently used chats', () => {
    // Five chats, four slots: the active one plus the three most recent.
    const chats = [chat('oldest', '01'), chat('new', '09'), chat('mid', '05'), chat('active', '02'), chat('newer', '07')]
    const resident = residentPoolChats(chats, 'active')
    expect(resident.map((c) => c.id)).toEqual(['active', 'new', 'newer', 'mid'])
    expect(resident.map((c) => c.id)).not.toContain('oldest')
  })

  // Nothing is reordered while everything fits, so the pool's render order
  // stays stable for the common case.
  it('leaves order untouched when no chat has to be evicted', () => {
    const chats = [chat('a', '01'), chat('b', '09'), chat('c', '05')]
    expect(residentPoolChats(chats, 'a').map((c) => c.id)).toEqual(['a', 'b', 'c'])
  })
})
