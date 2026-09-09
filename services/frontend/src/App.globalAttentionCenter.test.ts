import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const source = readFileSync(resolve(process.cwd(), 'src/App.tsx'), 'utf8')

describe('App global attention session refresh', () => {
  it('refreshes inactive chat sessions on a bounded cadence and feeds the Agent center', () => {
    expect(source).toMatch(/setAttentionSessions/)
    expect(source).toMatch(/chats\.map\(async \(chat\) =>/)
    expect(source).toMatch(/await api\.getSession\(chat\.sessionId\)/)
    expect(source).toMatch(/window\.setInterval\(\(\) => void refresh\(\), 6000\)/)
    expect(source).toMatch(/attentionSessions=\{attentionSessions\}/)
    expect(source).toMatch(/chatgptHumanActions=\{chatgptHumanActions\}/)
  })

  it('never assigns an unrelated chat human-action notice to the active chat', () => {
    expect(source).toContain('chatgptHumanActions[activeConflictKey] || chatgptHumanActions[activeChatId]')
    expect(source).not.toContain('chatgptHumanActions[activeChatId] || Object.values(chatgptHumanActions)[0]')
  })

  it('keeps a chat bound to the replacement session created after a stale alert target', () => {
    expect(source).toMatch(/const next = chats\.map\(\(chat\) => chat\.id === chatId \? \{ \.\.\.chat, sessionId: restored\.id \} : chat\)\s+persistChats\(restored\.project_path, next\)\s+setChats\(next\)/)
  })
})
