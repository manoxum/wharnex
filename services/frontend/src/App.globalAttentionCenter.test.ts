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
})
