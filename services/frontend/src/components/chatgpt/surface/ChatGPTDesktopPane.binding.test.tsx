import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ChatGPTDesktopPane } from './ChatGPTDesktopPane'

class TestResizeObserver { observe() {}; disconnect() {}; unobserve() {} }
const readyState = { url: 'https://chatgpt.com/', title: 'ChatGPT', loading: false, canGoBack: false, canGoForward: false, authMode: 'embedded' as const, authWindowOpen: false, authenticated: true }

function bindingBridge() {
  let stateHandler: ((value: DesktopChatGPTState) => void) | undefined
  const noopSubscription = () => () => undefined
  const chatgpt = {
    show: vi.fn().mockResolvedValue({ ok: true }), hide: vi.fn().mockResolvedValue({ ok: true }), setBounds: vi.fn().mockResolvedValue({ ok: true }),
    navigate: vi.fn().mockResolvedValue({ ...readyState, cacheKey: 'chat-1' }), state: vi.fn().mockResolvedValue({ ...readyState, cacheKey: 'chat-1' }),
    reload: vi.fn(), back: vi.fn(), forward: vi.fn(), paste: vi.fn(), openExternal: vi.fn(), openInternal: vi.fn(), openDevTools: vi.fn().mockResolvedValue({ ok: true }),
    onState: vi.fn((callback: (value: DesktopChatGPTState) => void) => { stateHandler = callback; return () => undefined }),
    onExternalAuth: vi.fn(noopSubscription), onAuthComplete: vi.fn(noopSubscription), onAuthError: vi.fn(noopSubscription),
    onPlanDownloaded: vi.fn(noopSubscription), onPlanDownloadError: vi.fn(noopSubscription), onBundleDownloadError: vi.fn(noopSubscription), onActivity: vi.fn(noopSubscription),
  }
  return {
    desktop: {
      platform: 'linux', projects: { pickDirectory: vi.fn() }, chatgpt,
      agents: { state: vi.fn().mockResolvedValue({ instance_id: 'desktop-1', desired_workers: 0, limits: { min_workers: 0, max_workers: 6, supervisors: 2 }, scheduler: { running: true, backend_reachable: true, last_refresh_at: '', last_error: '' }, queue: { total: 0, counts: {}, due: 0, scheduled: 0, blocked: 0, oldest_due_created_at: '', next_not_before: '' }, provider: { provider: 'chatgpt', paused: false, paused_until: '', reason: '', updated_at: '' }, agents: [] }), onState: vi.fn(noopSubscription), closeInteraction: vi.fn().mockResolvedValue({ ok: true }) },
      clipboard: { writeText: vi.fn() },
    } as unknown as WharnessDesktopBridge,
    publishState: (value: DesktopChatGPTState) => stateHandler?.(value),
  }
}

const props = { busy: false, chatId: 'chat-1', chatTitle: 'Chat 1', onChatGPTURL: vi.fn(() => true), onPlanFile: async () => '', onBundleFile: async () => '' }

describe('ChatGPTDesktopPane binding control', () => {
  beforeEach(() => { vi.stubGlobal('ResizeObserver', TestResizeObserver); window.localStorage.clear() })
  afterEach(() => { cleanup(); delete window.wharnessDesktop; vi.unstubAllGlobals(); vi.restoreAllMocks() })

  it('keeps recovery hidden after a prompt reaches a new conversation until the binding icon is clicked', async () => {
    const { desktop, publishState } = bindingBridge(); window.wharnessDesktop = desktop
    render(<ChatGPTDesktopPane {...props} />)
    await waitFor(() => expect(desktop.chatgpt.navigate).toHaveBeenCalled())

    act(() => publishState({ ...readyState, cacheKey: 'chat-1', url: 'https://chatgpt.com/c/new-chat' }))
    expect(screen.queryByText('Este chat perdeu sua conversa')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Vínculo ChatGPT: a vincular' }))
    expect(await screen.findByText('Este chat perdeu sua conversa')).toBeTruthy()
  })

  it('replaces the linked text status with an icon that opens the binding panel', async () => {
    const { desktop } = bindingBridge(); window.wharnessDesktop = desktop
    render(<ChatGPTDesktopPane {...props} chatgptUrl="https://chatgpt.com/c/right" />)

    const button = await screen.findByRole('button', { name: 'Vínculo ChatGPT: vinculado' })
    expect(screen.queryByText('Vinculado')).toBeNull()
    fireEvent.click(button)
    expect(await screen.findByText('Conversa vinculada')).toBeTruthy()
    expect(screen.getByText('https://chatgpt.com/c/right')).toBeTruthy()
  })
})
