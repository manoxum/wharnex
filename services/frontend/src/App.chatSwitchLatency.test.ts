import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const source = readFileSync(resolve(process.cwd(), 'src/App.tsx'), 'utf8')
const inspectorSource = readFileSync(resolve(process.cwd(), 'src/components/Inspector.tsx'), 'utf8')
const selectChat = source.slice(source.indexOf('async function selectChat('), source.indexOf('const updateWorkspaceChat ='))
const newChat = source.slice(source.indexOf('async function newChat('), source.indexOf('async function exportActiveChat('))

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

  it('hides the outgoing native Supervisor before exposing another chat', () => {
    const hide = selectChat.indexOf('hideChatGPTSurfaces(')
    const activate = selectChat.indexOf('setActiveChatId(chatId)')
    expect(hide).toBeGreaterThan(-1)
    expect(hide).toBeLessThan(activate)

    const newHide = newChat.indexOf('hideChatGPTSurfaces(')
    const firstAwait = newChat.indexOf('await ')
    expect(newHide).toBeGreaterThan(-1)
    expect(newHide).toBeLessThan(firstAwait)
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

  it('keeps the cache warm only when the session belongs to the active chat', () => {
    expect(source).toMatch(/const activeChatOwnsSession = Boolean\(activeChatRecord && session && activeChatRecord\.sessionId === session\.id\)/)
    expect(source).toMatch(/if \(activeChatOwnsSession && session && activeChatId\) sessionCacheRef\.current\[activeChatId\] = session/)
  })

  it('never derives conflict ownership from a synthetic remote surface', () => {
	expect(source).not.toMatch(/activeConflictKey|conflictChatGPTCacheKey|conflictSurfaces/)
  })

  it('blocks every active-chat automatic dispatcher until session ownership is proven', () => {
    const repairEffect = source.slice(source.indexOf("if (!session || !activeChatOwnsSession || !['repair_pending'"), source.indexOf('async function syncSessionModes'))
    expect(repairEffect.match(/!activeChatOwnsSession/g)?.length).toBe(2)
    expect(source).toContain('if (!session || !activeChatOwnsSession || !activeChatId || activeBusy')
  })

  it('always renders the owning chat conversation in the Engine', () => {
	expect(inspectorSource).toContain('chatgptUrl={activeChat.chatgptUrl}')
	expect(inspectorSource).not.toContain('chatgptSurface')
    expect(inspectorSource).toContain('activeChat.sessionId !== session.id')
  })

  it('evicts a chat from the cache when it is archived', () => {
    expect(source).toMatch(/delete sessionCacheRef\.current\[chatId\]/)
  })

  // Apply can take minutes for a self-evolution build. The operator is free to
  // switch chats while it runs, so every result item must remain owned by the
  // chat/session that initiated the request instead of whichever chat happens
  // to be active when the Promise resolves.
  it('routes a completed Apply back to its initiating chat after a chat switch', () => {
    const apply = source.slice(source.indexOf('async function apply()'), source.indexOf('async function retryDependencyNetwork()'))
    const targetCapture = apply.indexOf('const targetSession = session')
    const request = apply.indexOf('await api.apply(targetSession.id)')

    expect(targetCapture).toBeGreaterThan(-1)
    expect(request).toBeGreaterThan(targetCapture)
    expect(apply).toContain('mutateChatItems(targetChat, updated.project_path')
    expect(apply).not.toMatch(/setItems\(\(current\) => \[\.\.\.current,/)
    expect(apply).not.toContain('markContextDirtyForOtherChats(updated.project_path, activeChatId)')
  })

  it('keeps every long-running chat action off the active transcript directly', () => {
    const asyncActions = source.slice(source.indexOf('async function confirmPreparedDraft()'), source.indexOf('async function commentOnActiveTask('))

    expect(asyncActions).not.toMatch(/setItems\(/)
    expect(asyncActions).toContain('acceptSessionForChat(')
    expect(asyncActions).toMatch(/(?:appendChatItem|mutateChatItems)\(/)
  })

  it('routes ordinary planner continuations to hidden Workers', () => {
    const start = source.indexOf('async function transportPlannerContinuation')
    const end = source.indexOf('\n\tasync function submitConflictPrompt', start)
    const continuation = source.slice(start, end)
	expect(continuation).toMatch(/cacheKey: targetChat\.id, background: true, workspaceChatId: targetChat\.id/)
	expect(continuation).not.toMatch(/dedicatedConflict|surface\?/)
  })
})
