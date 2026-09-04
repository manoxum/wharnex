import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ChatGPTDesktopPane } from './ChatGPTDesktopPane'

class TestResizeObserver { observe() {}; disconnect() {}; unobserve() {} }
const state = { url: 'https://chatgpt.com/', title: 'ChatGPT', loading: false, canGoBack: false, canGoForward: false, authMode: 'external' as const, authWindowOpen: false, authenticated: false }

function bridge() {
  const noopSubscription = () => () => undefined
  return {
    platform: 'linux', projects: { pickDirectory: vi.fn() },
    chatgpt: {
      show: vi.fn().mockResolvedValue({ ok: true }), hide: vi.fn().mockResolvedValue({ ok: true }), setBounds: vi.fn().mockResolvedValue({ ok: true }),
      navigate: vi.fn().mockResolvedValue(state), confirmAffinity: vi.fn().mockResolvedValue({ ok: true }), rejectAffinity: vi.fn().mockResolvedValue({ ok: true }), reload: vi.fn(), focus: vi.fn(), back: vi.fn(), forward: vi.fn(), paste: vi.fn(), submitPrompt: vi.fn(), preparePrompt: vi.fn(), attachContext: vi.fn(), attachPrompt: vi.fn(), submitPrepared: vi.fn(),
      state: vi.fn().mockResolvedValue({ ...state, cacheKey: 'chat-1' }), release: vi.fn().mockResolvedValue({ ok: true, released: true }), setAuthMode: vi.fn().mockResolvedValue(state), startAuth: vi.fn().mockResolvedValue(state), openExternal: vi.fn(), resumeEmbedded: vi.fn().mockResolvedValue(state), pickBundle: vi.fn(),
      onState: vi.fn(noopSubscription), onExternalAuth: vi.fn(noopSubscription), onAuthComplete: vi.fn(noopSubscription), onAuthError: vi.fn(noopSubscription),
      onPlanDownloaded: vi.fn(noopSubscription), onPlanDownloadError: vi.fn(noopSubscription), onBundleDownloaded: vi.fn(noopSubscription), onBundleDownloadError: vi.fn(noopSubscription),
      onActivity: vi.fn(noopSubscription),
    },
    attachments: { persist: vi.fn(), preview: vi.fn(), open: vi.fn(), removeChat: vi.fn() }, clipboard: { copyContextZip: vi.fn(), readText: vi.fn(), writeText: vi.fn() },
  } as unknown as WharnessDesktopBridge
}

const props = { busy: false, chatId: 'chat-1', chatTitle: 'Chat 1', onChatGPTURL: () => true, onPlanFile: async () => '', onBundleFile: async () => '' }

describe('ChatGPTDesktopPane', () => {
  beforeEach(() => { vi.stubGlobal('ResizeObserver', TestResizeObserver); window.localStorage.clear() })
  afterEach(() => { cleanup(); delete window.wharnessDesktop; vi.unstubAllGlobals() })

  it('hides the native remote view while a trusted overlay is active and restores it afterwards', async () => {
    const desktop = bridge(); window.wharnessDesktop = desktop
    const view = render(<ChatGPTDesktopPane {...props} suspended />)
    await waitFor(() => expect(desktop.chatgpt.hide).toHaveBeenCalled())
    expect(desktop.chatgpt.show).not.toHaveBeenCalled()
    view.rerender(<ChatGPTDesktopPane {...props} suspended={false} />)
    await waitFor(() => expect(desktop.chatgpt.show).toHaveBeenCalled())
  })

  it('automatically hides the native WebContentsView behind any modal dialog', async () => {
    const desktop = bridge(); window.wharnessDesktop = desktop
    render(<ChatGPTDesktopPane {...props} />)
    await waitFor(() => expect(desktop.chatgpt.show).toHaveBeenCalled())
    const dialog = document.createElement('section')
    dialog.setAttribute('role', 'dialog'); dialog.setAttribute('aria-modal', 'true')
    document.body.appendChild(dialog)
    await waitFor(() => expect(desktop.chatgpt.hide).toHaveBeenCalled())
    const before = vi.mocked(desktop.chatgpt.show).mock.calls.length
    dialog.remove()
    await waitFor(() => expect(vi.mocked(desktop.chatgpt.show).mock.calls.length).toBeGreaterThan(before))
  })

  it('represents an authenticated embedded session with one compact icon and no manual artifact controls', async () => {
    const desktop = bridge(); const authenticatedState = { ...state, authenticated: true }
    desktop.chatgpt.state = vi.fn().mockResolvedValue(authenticatedState); desktop.chatgpt.navigate = vi.fn().mockResolvedValue(authenticatedState); window.wharnessDesktop = desktop
    render(<ChatGPTDesktopPane {...props} />)
    expect(await screen.findByRole('button', { name: 'Sessão ChatGPT autenticada' })).toBeTruthy()
    expect(screen.queryByText('Contexto do projeto')).toBeNull()
    expect(screen.queryByText('Fallback manual')).toBeNull()
    screen.getByRole('button', { name: 'Sessão ChatGPT autenticada' }).click()
    expect(await screen.findByRole('button', { name: 'Incorporado' })).toBeTruthy()
  })

  it('opens compact embedded and external authentication actions', async () => {
    const desktop = bridge(); window.wharnessDesktop = desktop
    render(<ChatGPTDesktopPane {...props} />)
    screen.getByRole('button', { name: 'Incorporado' }).click()
    await waitFor(() => expect(desktop.chatgpt.startAuth).toHaveBeenCalledWith('chat-1', 'embedded'))
    screen.getByRole('button', { name: /Externo/ }).click()
    await waitFor(() => expect(desktop.chatgpt.startAuth).toHaveBeenCalledWith('chat-1', 'external'))
  })

  it('ignores ChatGPT state events owned by another Harness chat', async () => {
    let stateHandler: ((value: DesktopChatGPTState) => void) | undefined
    const desktop = bridge(); desktop.chatgpt.onState = vi.fn((callback) => { stateHandler = callback; return () => undefined }); window.wharnessDesktop = desktop
    render(<ChatGPTDesktopPane {...props} />)
    act(() => stateHandler?.({ ...state, cacheKey: 'chat-2', externalAuthProvider: 'Google' }))
    expect(screen.queryByText('Autenticação Google em curso')).toBeNull()
    expect(desktop.chatgpt.state).toHaveBeenCalledWith('chat-1')
  })

  it('never imports a plan or bundle event owned by another Harness chat', async () => {
    let planHandler: ((value: DesktopPlanDownload) => void) | undefined
    let bundleHandler: ((value: DesktopBundleDownload) => void) | undefined
    const onPlanFile = vi.fn(async () => '')
    const onBundleFile = vi.fn(async () => '')
    const desktop = bridge()
    desktop.chatgpt.onPlanDownloaded = vi.fn((callback) => { planHandler = callback; return () => undefined })
    desktop.chatgpt.onBundleDownloaded = vi.fn((callback) => { bundleHandler = callback; return () => undefined })
    window.wharnessDesktop = desktop
    render(<ChatGPTDesktopPane {...props} onPlanFile={onPlanFile} onBundleFile={onBundleFile} />)

    act(() => planHandler?.({ cacheKey: 'chat-2', filename: 'wharness-plan-req_other.json', requestId: 'req_other', text: '{}', bytes: 2 }))
    act(() => bundleHandler?.({ cacheKey: 'chat-2', filename: 'wharness-bundle-req_other.zip', requestId: 'req_other', contentBase64: 'AA==', bytes: 1 }))

    expect(onPlanFile).not.toHaveBeenCalled()
    expect(onBundleFile).not.toHaveBeenCalled()
  })

  it('suspends the embedded surface while managed external authentication is active', async () => {
    let authHandler: ((value: DesktopExternalAuthState) => void) | undefined
    const desktop = bridge(); desktop.chatgpt.onExternalAuth = vi.fn((callback) => { authHandler = callback; return () => undefined }); window.wharnessDesktop = desktop
    render(<ChatGPTDesktopPane {...props} />)
    act(() => authHandler?.({ cacheKey: 'chat-1', provider: 'Google', url: 'https://accounts.google.com/', authMode: 'external', managedWindow: false, managedBrowser: true }))
    expect(await screen.findByText('Autenticação Google em curso')).toBeTruthy()
    await waitFor(() => expect(desktop.chatgpt.hide).toHaveBeenCalled())
  })
})


describe('ChatGPTDesktopPane affinity events', () => {
  beforeEach(() => { vi.stubGlobal('ResizeObserver', TestResizeObserver); window.localStorage.clear() })
  afterEach(() => { cleanup(); delete window.wharnessDesktop; vi.unstubAllGlobals() })

  it('ignores delayed state from another Harness chat and accepts the desktop-owned candidate for the active chat', async () => {
    let stateHandler: ((value: DesktopChatGPTState) => void) | undefined
    const desktop = bridge()
    desktop.chatgpt.onState = vi.fn((callback) => { stateHandler = callback; return () => undefined })
    const onChatGPTURL = vi.fn(() => true)
    window.wharnessDesktop = desktop
    render(<ChatGPTDesktopPane {...props} onChatGPTURL={onChatGPTURL} />)
    await waitFor(() => expect(stateHandler).toBeTypeOf('function'))

    act(() => stateHandler?.({ ...state, cacheKey: 'chat-old', url: 'https://chatgpt.com/c/wrong', bindingCandidate: 'https://chatgpt.com/c/wrong' }))
    expect(onChatGPTURL).not.toHaveBeenCalled()

    act(() => stateHandler?.({ ...state, cacheKey: 'chat-1', url: 'https://chatgpt.com/c/right', bindingCandidate: 'https://chatgpt.com/c/right', affinityPhase: 'candidate' }))
    expect(onChatGPTURL).toHaveBeenCalledTimes(1)
    expect(onChatGPTURL).toHaveBeenCalledWith('https://chatgpt.com/c/right')
    expect(desktop.chatgpt.confirmAffinity).not.toHaveBeenCalled()
    expect(desktop.chatgpt.rejectAffinity).not.toHaveBeenCalled()
  })

  it('rejects a desktop-owned candidate when the frontend one-to-one validator reports a conflict', async () => {
    let stateHandler: ((value: DesktopChatGPTState) => void) | undefined
    const desktop = bridge()
    desktop.chatgpt.onState = vi.fn((callback) => { stateHandler = callback; return () => undefined })
    const onChatGPTURL = vi.fn(() => false)
    window.wharnessDesktop = desktop
    render(<ChatGPTDesktopPane {...props} onChatGPTURL={onChatGPTURL} />)
    await waitFor(() => expect(stateHandler).toBeTypeOf('function'))

    act(() => stateHandler?.({ ...state, cacheKey: 'chat-1', url: 'https://chatgpt.com/c/conflict', bindingCandidate: 'https://chatgpt.com/c/conflict', affinityPhase: 'candidate' }))
    expect(desktop.chatgpt.confirmAffinity).not.toHaveBeenCalled()
    expect(desktop.chatgpt.rejectAffinity).not.toHaveBeenCalled()
  })
})
