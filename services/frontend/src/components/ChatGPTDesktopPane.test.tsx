import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ChatGPTDesktopPane } from './ChatGPTDesktopPane'
import { chatGPTOverlayDocuments } from '../lib/chatGPTOverlay'

class TestResizeObserver { observe() {}; disconnect() {}; unobserve() {} }
const state = { url: 'https://chatgpt.com/', title: 'ChatGPT', loading: false, canGoBack: false, canGoForward: false, authMode: 'embedded' as const, authWindowOpen: false, authenticated: false }

function bridge() {
  const noopSubscription = () => () => undefined
  return {
    platform: 'linux', projects: { pickDirectory: vi.fn() },
    chatgpt: {
      show: vi.fn().mockResolvedValue({ ok: true }), hide: vi.fn().mockResolvedValue({ ok: true }), setBounds: vi.fn().mockResolvedValue({ ok: true }),
      navigate: vi.fn().mockResolvedValue(state), confirmAffinity: vi.fn().mockResolvedValue({ ok: true }), rejectAffinity: vi.fn().mockResolvedValue({ ok: true }), reload: vi.fn(), focus: vi.fn(), back: vi.fn(), forward: vi.fn(), paste: vi.fn(), openDevTools: vi.fn().mockResolvedValue({ ok: true }), submitPrompt: vi.fn(), preparePrompt: vi.fn(), attachContext: vi.fn(), attachPrompt: vi.fn(), submitPrepared: vi.fn(), continueExpectedBundle: vi.fn().mockResolvedValue({ ok: true }), resumeExpectedBundle: vi.fn().mockResolvedValue({ ok: true, cacheKey: 'chat-1', requestId: 'req_pending123', expectedFilename: 'bundle.zip' }), stopConversation: vi.fn().mockResolvedValue({ ok: true, state: 'stopped' }), cancelRequest: vi.fn().mockResolvedValue({ ok: true, cacheKey: 'chat-1', requestId: 'req_pending123', cleared: true }),
      state: vi.fn().mockResolvedValue({ ...state, cacheKey: 'chat-1' }), release: vi.fn().mockResolvedValue({ ok: true, released: true }), setAuthMode: vi.fn().mockResolvedValue(state), startAuth: vi.fn().mockResolvedValue(state), openExternal: vi.fn(), openInternal: vi.fn(), resumeEmbedded: vi.fn().mockResolvedValue(state), pickBundle: vi.fn(),
      onState: vi.fn(noopSubscription), onExternalAuth: vi.fn(noopSubscription), onAuthComplete: vi.fn(noopSubscription), onAuthError: vi.fn(noopSubscription),
      onPlanDownloaded: vi.fn(noopSubscription), onPlanDownloadError: vi.fn(noopSubscription), onBundleDownloaded: vi.fn(noopSubscription), onBundleDownloadError: vi.fn(noopSubscription),
      onActivity: vi.fn(noopSubscription),
    },
    agents: {
      state: vi.fn().mockResolvedValue({ instance_id: 'desktop-1', desired_workers: 2, limits: { min_workers: 1, max_workers: 6, supervisors: 2 }, scheduler: { running: true, backend_reachable: true, last_refresh_at: '', last_error: '' }, queue: { total: 0, counts: {}, due: 0, scheduled: 0, blocked: 0, oldest_due_created_at: '', next_not_before: '' }, provider: { provider: 'chatgpt', paused: false, paused_until: '', reason: '', updated_at: '' }, agents: [{ id: 'worker-1', label: 'Worker 1', role: 'worker', status: 'idle', draining: false, chat_id: '', error: '', browser: { available: true, web_contents_id: 11, url: 'https://chatgpt.com/', title: 'ChatGPT', loading: false } }, { id: 'worker-2', label: 'Worker 2', role: 'worker', status: 'running', draining: false, chat_id: 'chat-2', error: '', browser: { available: true, web_contents_id: 12, url: 'https://chatgpt.com/c/worker', title: 'Worker', loading: false } }] }),
      setWorkerCount: vi.fn(), setPolicies: vi.fn(), setWorkerKeepFlowing: vi.fn(), resumeProvider: vi.fn(), snapshot: vi.fn(), openDevTools: vi.fn().mockResolvedValue({ ok: true, agentId: 'worker-1' }), openInteraction: vi.fn().mockResolvedValue({ ok: true }), setInteractionBounds: vi.fn().mockResolvedValue({ ok: true }), closeInteraction: vi.fn().mockResolvedValue({ ok: true }), onState: vi.fn(noopSubscription),
    },
    attachments: { persist: vi.fn(), preview: vi.fn(), open: vi.fn(), removeChat: vi.fn() }, clipboard: { copyContextZip: vi.fn(), readText: vi.fn(), writeText: vi.fn() },
  } as unknown as WharnessDesktopBridge
}

const props = { busy: false, chatId: 'chat-1', chatTitle: 'Chat 1', onChatGPTURL: () => true, onPlanFile: async () => '', onBundleFile: async () => '' }

describe('ChatGPTDesktopPane', () => {
  beforeEach(() => { vi.stubGlobal('ResizeObserver', TestResizeObserver); window.localStorage.clear() })
  afterEach(() => { cleanup(); delete window.wharnessDesktop; vi.unstubAllGlobals() })

  it('offers stopping the supervised request and reports its immutable id', async () => {
    const desktop = bridge(); window.wharnessDesktop = desktop
    const onCancel = vi.fn().mockResolvedValue(undefined)
    render(<ChatGPTDesktopPane {...props} pendingRequestId="req_pending123" onCancelPendingRequest={onCancel} />)
    screen.getByRole('button', { name: 'Parar pedido' }).click()
    await waitFor(() => expect(desktop.chatgpt.stopConversation).toHaveBeenCalledWith('chat-1'))
    await waitFor(() => expect(desktop.chatgpt.cancelRequest).toHaveBeenCalledWith('chat-1', 'req_pending123'))
    await waitFor(() => expect(onCancel).toHaveBeenCalledWith('req_pending123'))
  })

  it('still cancels the durable request when the remote stop control fails', async () => {
    const desktop = bridge()
    desktop.chatgpt.stopConversation = vi.fn().mockRejectedValue(new Error('remote stop unavailable'))
    window.wharnessDesktop = desktop
    const onCancel = vi.fn().mockResolvedValue(undefined)
    render(<ChatGPTDesktopPane {...props} pendingRequestId="req_pending123" onCancelPendingRequest={onCancel} />)

    screen.getByRole('button', { name: 'Parar pedido' }).click()

    await waitFor(() => expect(onCancel).toHaveBeenCalledWith('req_pending123'))
    expect(await screen.findByText(/cancelado no WHX/i)).toBeTruthy()
  })

  it('does not stop the remote conversation when the backend rejects a stale cancel click', async () => {
    const desktop = bridge(); window.wharnessDesktop = desktop
    const onCancel = vi.fn().mockRejectedValue(new Error('request is no longer active'))
    render(<ChatGPTDesktopPane {...props} pendingRequestId="req_pending123" onCancelPendingRequest={onCancel} />)
    screen.getByRole('button', { name: 'Parar pedido' }).click()
    expect(await screen.findByText(/não foi possível cancelar o pedido no WHX/i)).toBeTruthy()
    expect(desktop.chatgpt.stopConversation).not.toHaveBeenCalled()
    expect(desktop.chatgpt.cancelRequest).not.toHaveBeenCalled()
  })

  it('keeps supervised request actions in the Engine toolbar instead of a separate warning row', () => {
    const desktop = bridge(); window.wharnessDesktop = desktop
    const { container } = render(<ChatGPTDesktopPane {...props} pendingRequestId="req_pending123" onCancelPendingRequest={async () => undefined} />)
    const toolbar = container.querySelector('.chatgpt-auth-compact-panel')
    expect(toolbar?.contains(screen.getByRole('button', { name: 'Retomar pedido' }))).toBe(true)
    expect(toolbar?.contains(screen.getByRole('button', { name: 'Parar pedido' }))).toBe(true)
    expect(container.querySelector('.chatgpt-link-warning')?.textContent || '').not.toContain('sob supervisão')
  })

  it('re-navigates (silently) every time the same chat/url pane is unsuspended again, so a view that drifted away from its bound conversation while backgrounded self-heals instead of getting stuck', async () => {
    const desktop = bridge(); window.wharnessDesktop = desktop
    const view = render(<ChatGPTDesktopPane {...props} chatgptUrl="https://chatgpt.com/c/abc" />)
    await waitFor(() => expect(desktop.chatgpt.navigate).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(document.querySelector('.desktop-chatgpt-notice')).toBeNull())
    view.rerender(<ChatGPTDesktopPane {...props} chatgptUrl="https://chatgpt.com/c/abc" suspended />)
    await waitFor(() => expect(desktop.chatgpt.hide).toHaveBeenCalled())
    view.rerender(<ChatGPTDesktopPane {...props} chatgptUrl="https://chatgpt.com/c/abc" suspended={false} />)
    await waitFor(() => expect(desktop.chatgpt.show).toHaveBeenCalledTimes(2))
    // The backend `navigate` handler is what actually corrects a remote view
    // that silently drifted off its bound conversation while backgrounded,
    // so it must run again on every unsuspend rather than being skipped.
    await waitFor(() => expect(desktop.chatgpt.navigate).toHaveBeenCalledTimes(2))
    // But the repeat visit must stay silent: no "loading"/"recovering" notice
    // flash, since nothing about this chat/url pair actually changed.
    expect(document.querySelector('.desktop-chatgpt-notice')).toBeNull()
  })

  it('hides the native remote view while a trusted overlay is active and restores it afterwards', async () => {
    const desktop = bridge(); window.wharnessDesktop = desktop
    const view = render(<ChatGPTDesktopPane {...props} suspended />)
    await waitFor(() => expect(desktop.chatgpt.hide).toHaveBeenCalled())
    expect(desktop.chatgpt.show).not.toHaveBeenCalled()
    view.rerender(<ChatGPTDesktopPane {...props} suspended={false} />)
    await waitFor(() => expect(desktop.chatgpt.show).toHaveBeenCalled())
  })

  it('does not show a false loading placeholder when a ready native view is temporarily suspended', async () => {
    const desktop = bridge(); window.wharnessDesktop = desktop
    const { container } = render(<ChatGPTDesktopPane {...props} suspended />)
    await waitFor(() => expect(desktop.chatgpt.hide).toHaveBeenCalled())
    await waitFor(() => expect(container.querySelector('.desktop-chatgpt-loading')).toBeNull())
  })

  it('does not navigate a remote view while the pane is suspended', async () => {
    const desktop = bridge(); window.wharnessDesktop = desktop
    render(<ChatGPTDesktopPane {...props} suspended />)
    await waitFor(() => expect(desktop.chatgpt.hide).toHaveBeenCalled())
    expect(desktop.chatgpt.navigate).not.toHaveBeenCalled()
  })

  it('keeps ordinary dialogs non-blocking and hides only for explicit overlay blockers', async () => {
    const desktop = bridge(); window.wharnessDesktop = desktop
    render(<ChatGPTDesktopPane {...props} />)
    await waitFor(() => expect(desktop.chatgpt.show).toHaveBeenCalled())
    const dialog = document.createElement('section')
    dialog.setAttribute('role', 'dialog'); dialog.setAttribute('aria-modal', 'false')
    document.body.appendChild(dialog)
    await new Promise((resolve) => window.setTimeout(resolve, 0))
    expect(desktop.chatgpt.hide).not.toHaveBeenCalled()

    dialog.setAttribute('data-chatgpt-overlay-blocker', 'true')
    await waitFor(() => expect(desktop.chatgpt.hide).toHaveBeenCalled())
    expect(await screen.findByText('ChatGPT preservado')).toBeTruthy()
    const before = vi.mocked(desktop.chatgpt.show).mock.calls.length
    dialog.remove()
    await waitFor(() => expect(vi.mocked(desktop.chatgpt.show).mock.calls.length).toBeGreaterThan(before))
    await waitFor(() => expect(screen.queryByText('ChatGPT preservado')).toBeNull())
  })

  it('includes blocking overlays owned by the same-origin parent WorkspaceShell', () => {
    const projectDocument = document.implementation.createHTMLDocument('project')
    const shellDocument = document.implementation.createHTMLDocument('shell')
    const shellWindow = { document: shellDocument } as unknown as Window
    const projectWindow = { document: projectDocument, parent: shellWindow } as unknown as Window

    expect(chatGPTOverlayDocuments(projectWindow)).toEqual([projectDocument, shellDocument])
  })


  it('follows an existing Worker in the main Engine area and restores the Supervisor on exit', async () => {
    const desktop = bridge(); window.wharnessDesktop = desktop
    render(<ChatGPTDesktopPane {...props} chatgptUrl="https://chatgpt.com/c/right" />)
    await waitFor(() => expect(desktop.chatgpt.show).toHaveBeenCalled())

    act(() => window.dispatchEvent(new CustomEvent('wharnex:agent-follow', { detail: { agentId: 'worker-1' } })))

    expect(await screen.findByText('Seguindo Worker 1')).toBeTruthy()
    await waitFor(() => expect(desktop.agents.openInteraction).toHaveBeenCalledWith('worker-1', expect.objectContaining({ width: expect.any(Number), height: expect.any(Number) })))
    await waitFor(() => expect(desktop.chatgpt.hide).toHaveBeenCalledWith('chat-1'))

    const blocker = document.createElement('div')
    blocker.setAttribute('data-chatgpt-overlay-blocker', 'true')
    document.body.appendChild(blocker)
    await waitFor(() => expect(desktop.agents.closeInteraction).toHaveBeenCalledWith('worker-1'))
    const openCalls = vi.mocked(desktop.agents.openInteraction).mock.calls.length
    blocker.remove()
    await waitFor(() => expect(vi.mocked(desktop.agents.openInteraction).mock.calls.length).toBeGreaterThan(openCalls))

    screen.getByRole('button', { name: 'Parar de seguir' }).click()
    await waitFor(() => expect(desktop.agents.closeInteraction).toHaveBeenCalledWith('worker-1'))
    await waitFor(() => expect(desktop.chatgpt.show).toHaveBeenCalled())
  })

  it('selects a Worker directly in Engine and opens DevTools for the visible browser instance', async () => {
    const desktop = bridge(); window.wharnessDesktop = desktop
    render(<ChatGPTDesktopPane {...props} chatgptUrl="https://chatgpt.com/c/right" />)

    const selector = await screen.findByRole('combobox', { name: 'Instância do Engine' })
    fireEvent.change(selector, { target: { value: 'worker-2' } })
    await waitFor(() => expect(desktop.agents.openInteraction).toHaveBeenCalledWith('worker-2', expect.any(Object)))

    screen.getByRole('button', { name: 'Abrir DevTools da instância atual' }).click()
    await waitFor(() => expect(desktop.agents.openDevTools).toHaveBeenCalledWith('worker-2'))
    expect(desktop.chatgpt.openDevTools).not.toHaveBeenCalled()

    fireEvent.change(selector, { target: { value: '' } })
    await waitFor(() => expect(desktop.agents.closeInteraction).toHaveBeenCalledWith('worker-2'))
    screen.getByRole('button', { name: 'Abrir DevTools da instância atual' }).click()
    await waitFor(() => expect(desktop.chatgpt.openDevTools).toHaveBeenCalledWith('chat-1'))
  })

  it('copies the currently visible Supervisor conversation link from the Engine header', async () => {
    const desktop = bridge()
    const supervisorState = { ...state, cacheKey: 'chat-1', url: 'https://chatgpt.com/c/supervisor?model=auto' }
    desktop.chatgpt.state = vi.fn().mockResolvedValue(supervisorState)
    desktop.chatgpt.navigate = vi.fn().mockResolvedValue(supervisorState)
    window.wharnessDesktop = desktop
    const { container } = render(<ChatGPTDesktopPane {...props} chatgptUrl="https://chatgpt.com/c/supervisor?model=auto" />)

    const copyButton = await screen.findByRole('button', { name: 'Copiar link da conversa visível' })
    await waitFor(() => expect((copyButton as HTMLButtonElement).disabled).toBe(false))
    const devToolsButton = screen.getByRole('button', { name: 'Abrir DevTools da instância atual' })
    expect(container.querySelector('.desktop-browser-controls')?.contains(copyButton)).toBe(true)
    expect(container.querySelector('.desktop-browser-controls')?.contains(devToolsButton)).toBe(true)
    expect(container.querySelector('.desktop-chatgpt-toolbar-status')?.contains(devToolsButton)).toBe(false)
    fireEvent.click(copyButton)

    await waitFor(() => expect(desktop.clipboard.writeText).toHaveBeenCalledWith('https://chatgpt.com/c/supervisor'))
    expect(await screen.findByText('Link da conversa visível copiado.')).toBeTruthy()
  })

  it('copies the followed Worker conversation link when that Worker is visible', async () => {
    const desktop = bridge(); window.wharnessDesktop = desktop
    render(<ChatGPTDesktopPane {...props} chatgptUrl="https://chatgpt.com/c/right" />)

    const selector = await screen.findByRole('combobox', { name: 'Instância do Engine' })
    fireEvent.change(selector, { target: { value: 'worker-2' } })
    await waitFor(() => expect(desktop.agents.openInteraction).toHaveBeenCalledWith('worker-2', expect.any(Object)))
    fireEvent.click(screen.getByRole('button', { name: 'Copiar link da conversa visível' }))

    await waitFor(() => expect(desktop.clipboard.writeText).toHaveBeenCalledWith('https://chatgpt.com/c/worker'))
  })

  it('disables copy-link when the visible Engine instance is not on a conversation', async () => {
    const desktop = bridge(); window.wharnessDesktop = desktop
    render(<ChatGPTDesktopPane {...props} />)

    expect((await screen.findByRole('button', { name: 'Copiar link da conversa visível' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('synchronizes the native view bounds immediately after mounting', async () => {
    const desktop = bridge(); window.wharnessDesktop = desktop
    render(<ChatGPTDesktopPane {...props} />)
    await waitFor(() => expect(desktop.chatgpt.setBounds).toHaveBeenCalled())
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


  it('surfaces same-origin ChatGPT authentication instead of an endless loading notice', async () => {
    const desktop = bridge()
    const authState = { ...state, url: 'https://chatgpt.com/auth/login', loading: false, authenticated: false }
    desktop.chatgpt.state = vi.fn().mockResolvedValue(authState)
    desktop.chatgpt.navigate = vi.fn().mockResolvedValue(authState)
    window.wharnessDesktop = desktop
    render(<ChatGPTDesktopPane {...props} chatgptUrl="https://chatgpt.com/c/example" />)
    expect(await screen.findByText('Autenticação necessária. Conclua o login incorporado ou escolha Externo.')).toBeTruthy()
  })

  it('opens compact embedded and external authentication actions', async () => {
    const desktop = bridge(); window.wharnessDesktop = desktop
    render(<ChatGPTDesktopPane {...props} />)
    screen.getByRole('button', { name: 'Incorporado' }).click()
    await waitFor(() => expect(desktop.chatgpt.startAuth).toHaveBeenCalledWith('chat-1', 'embedded'))
    screen.getByRole('button', { name: /Externo/ }).click()
    await waitFor(() => expect(desktop.chatgpt.startAuth).toHaveBeenCalledWith('chat-1', 'external'))
  })

  it('opens the linked conversation in the Electron internal browser', async () => {
    const desktop = bridge(); window.wharnessDesktop = desktop
    render(<ChatGPTDesktopPane {...props} chatgptUrl="https://chatgpt.com/c/right" />)

    screen.getByTitle('Abrir no navegador interno').click()

    await waitFor(() => expect(desktop.chatgpt.openInternal).toHaveBeenCalledWith('https://chatgpt.com/c/right'))
  })

  it('clears the recovery notice after a linked ChatGPT conversation finishes navigation', async () => {
    let resolveNavigation: ((value: DesktopChatGPTState) => void) | undefined
    const desktop = bridge()
    desktop.chatgpt.navigate = vi.fn(() => new Promise<DesktopChatGPTState>((resolve) => { resolveNavigation = resolve }))
    window.wharnessDesktop = desktop
    render(<ChatGPTDesktopPane {...props} chatgptUrl="https://chatgpt.com/c/right" />)

    expect(await screen.findByText('A recuperar a conversa ChatGPT…')).toBeTruthy()
    act(() => resolveNavigation?.({ ...state, cacheKey: 'chat-1', url: 'https://chatgpt.com/c/right' }))

    await waitFor(() => expect(screen.queryByText('A recuperar a conversa ChatGPT…')).toBeNull())
  })

  it('does not erase a newer notice when linked navigation settles', async () => {
    let resolveNavigation: ((value: DesktopChatGPTState) => void) | undefined
    let authHandler: ((value: DesktopExternalAuthState) => void) | undefined
    const desktop = bridge()
    desktop.chatgpt.navigate = vi.fn(() => new Promise<DesktopChatGPTState>((resolve) => { resolveNavigation = resolve }))
    desktop.chatgpt.onExternalAuth = vi.fn((callback) => { authHandler = callback; return () => undefined })
    window.wharnessDesktop = desktop
    render(<ChatGPTDesktopPane {...props} chatgptUrl="https://chatgpt.com/c/right" />)

    expect(await screen.findByText('A recuperar a conversa ChatGPT…')).toBeTruthy()
    act(() => authHandler?.({ cacheKey: 'chat-1', provider: 'Google', url: 'https://accounts.google.com/', authMode: 'external', managedWindow: false, managedBrowser: true }))
    expect(await screen.findByText('Google: conclua a autenticação no navegador seguro aberto pelo Wharnex.')).toBeTruthy()
    act(() => resolveNavigation?.({ ...state, cacheKey: 'chat-1', url: 'https://chatgpt.com/c/right' }))

    await waitFor(() => expect(screen.getByText('Google: conclua a autenticação no navegador seguro aberto pelo Wharnex.')).toBeTruthy())
  })

  it('covers the Engine while another chat owns the Supervisor transport lease', async () => {
    let stateHandler: ((value: DesktopChatGPTState) => void) | undefined
    const desktop = bridge()
    desktop.chatgpt.onState = vi.fn((callback) => { stateHandler = callback; return () => undefined })
    desktop.chatgpt.navigate = vi.fn().mockResolvedValue({ ...state, cacheKey: 'chat-1', surfaceDeferred: true, loading: true })
    window.wharnessDesktop = desktop
    const { container } = render(<ChatGPTDesktopPane {...props} chatgptUrl="https://chatgpt.com/c/right" />)

    expect(await screen.findByText('A preparar este chat')).toBeTruthy()
    expect(screen.getByText(/Pode enviar novos prompts agora/)).toBeTruthy()
    expect(container.querySelector('.desktop-chatgpt-deferred')).toBeTruthy()

    act(() => stateHandler?.({ ...state, cacheKey: 'chat-1', url: 'https://chatgpt.com/c/right', surfaceDeferred: false, loading: false }))
    await waitFor(() => expect(screen.queryByText('A preparar este chat')).toBeNull())
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



describe('ChatGPTDesktopPane affinity ownership', () => {
  beforeEach(() => { vi.stubGlobal('ResizeObserver', TestResizeObserver); window.localStorage.clear() })
  afterEach(() => { cleanup(); delete window.wharnessDesktop; vi.unstubAllGlobals() })

  it('leaves definitive candidate persistence to the application controller', async () => {
    let stateHandler: ((value: DesktopChatGPTState) => void) | undefined
    const desktop = bridge()
    desktop.chatgpt.onState = vi.fn((callback) => { stateHandler = callback; return () => undefined })
    const onChatGPTURL = vi.fn(() => true)
    window.wharnessDesktop = desktop
    render(<ChatGPTDesktopPane {...props} onChatGPTURL={onChatGPTURL} />)
    await waitFor(() => expect(stateHandler).toBeTypeOf('function'))

    act(() => stateHandler?.({ ...state, cacheKey: 'chat-1', url: 'https://chatgpt.com/c/right', bindingCandidate: 'https://chatgpt.com/c/right', affinityPhase: 'candidate' }))
    expect(onChatGPTURL).not.toHaveBeenCalled()
    expect(desktop.chatgpt.confirmAffinity).not.toHaveBeenCalled()
    expect(desktop.chatgpt.rejectAffinity).not.toHaveBeenCalled()
  })

  it('does not navigate the remote renderer again when only the local chat title changes', async () => {
    const desktop = bridge(); window.wharnessDesktop = desktop
    const view = render(<ChatGPTDesktopPane {...props} chatTitle="Primeiro título" />)
    await waitFor(() => expect(desktop.chatgpt.navigate).toHaveBeenCalledTimes(1))
    view.rerender(<ChatGPTDesktopPane {...props} chatTitle="Título atualizado" />)
    await waitFor(() => expect(desktop.chatgpt.navigate).toHaveBeenCalledTimes(1))
  })

  it('can restore the conversation already linked to the Harness chat', async () => {
    const desktop = bridge()
    const wrong = { ...state, cacheKey: 'chat-1', url: 'https://chatgpt.com/c/wrong' }
    desktop.chatgpt.state = vi.fn().mockResolvedValue(wrong)
    desktop.chatgpt.navigate = vi.fn().mockResolvedValueOnce(wrong).mockResolvedValue({ ...wrong, url: 'https://chatgpt.com/c/right' })
    window.wharnessDesktop = desktop
    render(<ChatGPTDesktopPane {...props} chatgptUrl="https://chatgpt.com/c/right" />)

    ;(await screen.findByRole('button', { name: 'Repor vinculada' })).click()
    await waitFor(() => expect(desktop.chatgpt.navigate).toHaveBeenLastCalledWith('https://chatgpt.com/c/right', 'chat-1'))
  })

  it('offers a manual request-scoped continuation fallback', async () => {
    const desktop = bridge(); window.wharnessDesktop = desktop
    render(<ChatGPTDesktopPane {...props} pendingRequestId="req_pending123" />)
    screen.getByRole('button', { name: 'Retomar pedido' }).click()
    await waitFor(() => expect(desktop.chatgpt.continueExpectedBundle).toHaveBeenCalledWith('chat-1', 'req_pending123'))
  })


  it('re-arms lost desktop supervision before continuing a durable pending request', async () => {
    const desktop = bridge()
    desktop.chatgpt.continueExpectedBundle = vi.fn()
      .mockResolvedValueOnce({ ok: false, cacheKey: 'chat-1', requestId: 'req_pending123', confirmationRequired: false, reason: 'not_supervised' })
      .mockResolvedValue({ ok: true, cacheKey: 'chat-1', requestId: 'req_pending123', confirmationRequired: false, reason: 'submitted' })
    window.wharnessDesktop = desktop
    render(<ChatGPTDesktopPane {...props} chatgptUrl="https://chatgpt.com/c/right" pendingRequestId="req_pending123" sessionId="ses-1" recoveryBootstrap="bootstrap" />)
    screen.getByRole('button', { name: 'Retomar pedido' }).click()
    await waitFor(() => expect(desktop.chatgpt.resumeExpectedBundle).toHaveBeenCalledWith({
      cacheKey: 'chat-1',
      sessionId: 'ses-1',
      requestId: 'req_pending123',
      url: 'https://chatgpt.com/c/right',
      recoveryBootstrap: 'bootstrap',
      expectedFilename: '',
      chatTitle: 'Chat 1',
      chatHash: undefined,
      requestedAt: undefined,
    }))
    await waitFor(() => expect(desktop.chatgpt.continueExpectedBundle).toHaveBeenCalledTimes(2))
    expect(await screen.findByText(/Continuação manual enviada/)).toBeTruthy()
  })

  it('does not report success when the desktop still sees positively active conversation transport', async () => {
    const desktop = bridge()
    desktop.chatgpt.continueExpectedBundle = vi.fn().mockResolvedValue({ ok: false, cacheKey: 'chat-1', requestId: 'req_pending123', confirmationRequired: false, reason: 'transport_active' })
    window.wharnessDesktop = desktop
    render(<ChatGPTDesktopPane {...props} pendingRequestId="req_pending123" />)
    screen.getByRole('button', { name: 'Retomar pedido' }).click()
    expect(await screen.findByText(/ainda tem transporte de conversa ativo/)).toBeTruthy()
    expect(screen.queryByText(/Continuação manual enviada/)).toBeNull()
  })

  it('surfaces a failed continuation preparation instead of reporting a silent retry', async () => {
    const desktop = bridge()
    desktop.chatgpt.continueExpectedBundle = vi.fn().mockResolvedValue({ ok: false, cacheKey: 'chat-1', requestId: 'req_pending123', confirmationRequired: false, reason: 'continuation_failed' })
    window.wharnessDesktop = desktop
    render(<ChatGPTDesktopPane {...props} pendingRequestId="req_pending123" />)
    screen.getByRole('button', { name: 'Retomar pedido' }).click()
    expect(await screen.findByText(/continuação não pôde ser preparada/i)).toBeTruthy()
  })

  it('keeps the manual continuation single-flight in the renderer while the IPC request is pending', async () => {
    const desktop = bridge()
    let resolveContinuation: ((value: { ok: boolean; cacheKey: string; requestId: string; reason: string }) => void) | undefined
    desktop.chatgpt.continueExpectedBundle = vi.fn().mockImplementation(() => new Promise<{ ok: boolean; cacheKey: string; requestId: string; reason: string }>((resolve) => { resolveContinuation = resolve }))
    window.wharnessDesktop = desktop
    render(<ChatGPTDesktopPane {...props} pendingRequestId="req_pending123" />)
    const button = screen.getByRole('button', { name: 'Retomar pedido' }) as HTMLButtonElement
    button.click()
    await waitFor(() => expect(button.disabled).toBe(true))
    button.click()
    expect(desktop.chatgpt.continueExpectedBundle).toHaveBeenCalledTimes(1)
    resolveContinuation?.({ ok: true, cacheKey: 'chat-1', requestId: 'req_pending123', reason: 'submitted' })
    await waitFor(() => expect(button.disabled).toBe(false))
  })

  it('requires explicit confirmation before overriding an ambiguous processing control', async () => {
    const desktop = bridge()
    desktop.chatgpt.continueExpectedBundle = vi.fn().mockResolvedValueOnce({ ok: false, cacheKey: 'chat-1', requestId: 'req_pending123', confirmationRequired: true, reason: 'transport_stale' }).mockResolvedValue({ ok: true, cacheKey: 'chat-1', requestId: 'req_pending123', reason: 'submitted' })
    window.wharnessDesktop = desktop
    render(<ChatGPTDesktopPane {...props} pendingRequestId="req_pending123" />)
    screen.getByRole('button', { name: 'Retomar pedido' }).click()
    ;(await screen.findByRole('button', { name: 'Continuar mesmo assim' })).click()
    await waitFor(() => expect(desktop.chatgpt.continueExpectedBundle).toHaveBeenLastCalledWith('chat-1', 'req_pending123', { force: true }))
  })
})
