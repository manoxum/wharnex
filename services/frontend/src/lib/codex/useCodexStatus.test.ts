import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { CodexStatus, CodexThread } from './contracts'
import { useCodexStatus } from './useCodexStatus'
const fixture = vi.hoisted(() => ({ events: new Set<(thread: CodexThread) => void>(), accounts: new Set<() => void>(), status: vi.fn(), subscribe: vi.fn(async () => {}), unsubscribe: vi.fn(async () => {}) }))
vi.mock('../desktop/bridge/desktop', () => ({ desktopBridge: () => ({ codex: {
  status: fixture.status, subscribe: fixture.subscribe, unsubscribe: fixture.unsubscribe,
  onEvent: (callback: (thread: CodexThread) => void) => { fixture.events.add(callback); return () => { fixture.events.delete(callback) } },
  onAccountChange: (callback: () => void) => { fixture.accounts.add(callback); return () => { fixture.accounts.delete(callback) } },
} }) }))
const status = (projectPath: string): CodexStatus => ({ connected: true, account: { type: 'chatgpt', email: `${projectPath}@test`, planType: 'plus' }, rateLimits: null, usage: null, models: [], threads: [] })
afterEach(() => { cleanup(); vi.clearAllMocks() })
describe('project-scoped native Codex state', () => {
  it('refreshes the newly selected account after an earlier account read is already in flight', async () => {
    let complete!: (data: CodexStatus) => void
    fixture.status.mockImplementationOnce(() => new Promise<CodexStatus>((resolve) => { complete = resolve })).mockResolvedValue({ ...status('/account-switch'), account: { type: 'chatgpt', email: 'new@test', planType: 'plus' } })
    const hook = renderHook(() => useCodexStatus('/account-switch'))
    await waitFor(() => expect(complete).toBeTypeOf('function'))
    act(() => { for (const callback of fixture.accounts) callback() })
    await act(async () => complete(status('/account-switch')))
    await waitFor(() => expect(hook.result.current.data?.account?.email).toBe('new@test'))
    expect(fixture.status).toHaveBeenCalledTimes(2)
  })
  it('keeps native progress arriving before account status and accepts fresh state on later refresh', async () => {
    let complete!: (data: CodexStatus) => void
    fixture.status.mockImplementation(() => new Promise<CodexStatus>((resolve) => { complete = resolve }))
    const projectPath = '/early-native-event'
    const hook = renderHook(() => useCodexStatus(projectPath))
    await waitFor(() => expect(complete).toBeTypeOf('function'))
    const thread: CodexThread = { projectPath, chatId: 'chat', threadId: 'thread', requestId: 'req_native', title: 'Work', native: true, status: 'running', error: '', messages: [], tokenUsage: null }
    act(() => { for (const callback of fixture.events) callback(thread) })
    expect(hook.result.current.threads?.[0].status).toBe('running')
    await act(async () => complete(status(projectPath)))
    expect(hook.result.current.data?.threads[0].status).toBe('running')
    fixture.status.mockResolvedValue({ ...status(projectPath), threads: [{ ...thread, status: 'completed' }] })
    await act(async () => { await hook.result.current.refresh() })
    expect(hook.result.current.threads?.[0].status).toBe('completed')
  })
  it('shares status reads and refreshes immediately after authentication changes', async () => {
    fixture.status.mockImplementation(async (path: string) => status(path))
    renderHook(() => useCodexStatus('/shared-account'))
    const second = renderHook(() => useCodexStatus('/shared-account'))
    await waitFor(() => expect(second.result.current.data?.connected).toBe(true))
    expect(fixture.subscribe).toHaveBeenCalledTimes(1)
    expect(fixture.status).toHaveBeenCalledTimes(1)
    act(() => { for (const callback of fixture.accounts) callback() })
    await waitFor(() => expect(fixture.status).toHaveBeenCalledTimes(2))
  })
  it('does not show another project snapshot while switching projects', async () => {
    fixture.status.mockImplementation(async (path: string) => status(path))
    const hook = renderHook(({ path }) => useCodexStatus(path), { initialProps: { path: '/first' } })
    await waitFor(() => expect(hook.result.current.data?.account?.email).toBe('/first@test'))
    fixture.status.mockImplementation(() => new Promise(() => {}))
    hook.rerender({ path: '/second' })
    expect(hook.result.current.data).toBeUndefined()
    act(() => { for (const callback of fixture.events) callback({ projectPath: '/first', chatId: 'private' } as CodexThread) })
    expect(hook.result.current.data).toBeUndefined()
  })
})
