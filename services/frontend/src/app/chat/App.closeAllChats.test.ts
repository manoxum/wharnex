import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const source = [readFileSync(resolve(process.cwd(), 'src/app/workspace/App.tsx'), 'utf8'), readFileSync(resolve(process.cwd(), 'src/app/chat/activeChatLifecycleActions.ts'), 'utf8')].join('\n')

describe('App closing all chats', () => {
  it('ends at zero chats instead of silently recreating a replacement session', () => {
    expect(source).toMatch(/if \(!nextChat\) \{/)
    expect(source).toMatch(/persistChats\(projectPath, \[\]\)/)
    expect(source).toMatch(/activeChatIdRef\.current = ''; setActiveChatId\(''\)/)
  })

  it('renders an empty-state call to action instead of the chat workspace when no chat is open', () => {
    expect(source).toMatch(/chats\.length === 0 \? <div className="agent-empty-workspace">/)
    expect(source).toMatch(/onClick=\{\(\) => void newChat\(\)\}/)
  })
})
