import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const source = readFileSync(resolve(process.cwd(), 'src/App.tsx'), 'utf8')
const selectChat = source.slice(source.indexOf('async function selectChat('), source.indexOf('const updateWorkspaceChat ='))

describe('chat switching stays local and immediate', () => {
  // Everything the user perceives on a switch is already on this machine. The
  // switch used to change the active chat only after a backend round trip plus
  // up to three mode PATCHes, so clicking a tab did nothing visible until the
  // network answered.
  it('changes the active chat before awaiting anything', () => {
    const activate = selectChat.indexOf('setActiveChatId(chatId)')
    const firstAwait = selectChat.indexOf('await ')
    expect(activate).toBeGreaterThan(-1)
    expect(firstAwait).toBeGreaterThan(-1)
    expect(activate).toBeLessThan(firstAwait)
  })

  it('renders the transcript from local storage without waiting for the session', () => {
    const items = selectChat.indexOf('setItems(loadChat(projectPath, chatId))')
    expect(items).toBeGreaterThan(-1)
    expect(items).toBeLessThan(selectChat.indexOf('await '))
  })

  // A global busy flag freezes every chat's controls, including the tabs the
  // user is trying to switch between.
  it('never raises the global busy flag for a switch', () => {
    expect(selectChat).not.toMatch(/setBusy\(true\)/)
    expect(selectChat).toMatch(/setChatBusy\(chatId, true\)/)
  })

  it('serves a known session from cache instead of blocking on the network', () => {
    expect(selectChat).toMatch(/const cached = sessionCacheRef\.current\[chatId\]/)
    expect(selectChat).toMatch(/if \(cached && cached\.id === selected\.sessionId\)/)
  })

  // A slow round trip for a chat the user already left must never overwrite the
  // chat now on screen.
  it('discards a restored session whose chat is no longer active', () => {
    const apply = source.slice(source.indexOf('const applyRestoredSession ='), source.indexOf('async function selectChat('))
    expect(apply).toMatch(/if \(activeChatIdRef\.current !== chatId\) return/)
    expect(apply).toMatch(/sessionCacheRef\.current\[chatId\] = restored/)
  })

  it('keeps the cache warm from every path that establishes a session', () => {
    expect(source).toMatch(/if \(session && activeChatId\) sessionCacheRef\.current\[activeChatId\] = session/)
  })

  it('evicts a chat from the cache when it is archived', () => {
    expect(source).toMatch(/delete sessionCacheRef\.current\[chatId\]/)
  })
})
