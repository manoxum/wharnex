import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Session } from '../types'
import { ChatGPTDesktopPane } from './ChatGPTDesktopPane'

class TestResizeObserver {
  observe() {}
  disconnect() {}
  unobserve() {}
}

const state = { url: 'https://chatgpt.com/', title: 'ChatGPT', loading: false, canGoBack: false, canGoForward: false, authMode: 'external' as const, authWindowOpen: false }

function session(): Session {
  return {
    id: 'ses-overlay',
    project_path: '/tmp/demo',
    state: 'ready',
    execution_mode: 'protected',
    automation_mode: 'manual',
    last_request_id: 'req_20260903T112307_7f79e5fe040d3e2d',
    created_at: new Date().toISOString(),
    context: { id: 'ctx', manifest: { id: 'ctx', project_root: '/tmp/demo', sha256: 'abc', files: [], excluded: [], text_truncated: false } },
  }
}

function bridge() {
  const noopSubscription = () => () => undefined
  return {
    platform: 'linux',
    projects: { pickDirectory: vi.fn() },
    chatgpt: {
      show: vi.fn().mockResolvedValue({ ok: true }),
      hide: vi.fn().mockResolvedValue({ ok: true }),
      setBounds: vi.fn().mockResolvedValue({ ok: true }),
      navigate: vi.fn().mockResolvedValue(state),
      reload: vi.fn(), focus: vi.fn(), back: vi.fn(), forward: vi.fn(), paste: vi.fn(),
      submitPrompt: vi.fn(), preparePrompt: vi.fn(), attachContext: vi.fn(), attachPrompt: vi.fn(), submitPrepared: vi.fn(),
      state: vi.fn().mockResolvedValue(state),
      setAuthMode: vi.fn().mockResolvedValue(state), startAuth: vi.fn().mockResolvedValue(state),
      openExternal: vi.fn(), resumeEmbedded: vi.fn().mockResolvedValue(state), pickBundle: vi.fn(),
      onState: vi.fn(noopSubscription),
      onExternalAuth: vi.fn(noopSubscription),
      onAuthComplete: vi.fn(noopSubscription),
      onPlanDownloaded: vi.fn(noopSubscription),
      onPlanDownloadError: vi.fn(noopSubscription),
      onBundleDownloaded: vi.fn(noopSubscription),
      onBundleDownloadError: vi.fn(noopSubscription),
    },
    attachments: { persist: vi.fn(), preview: vi.fn(), open: vi.fn(), removeChat: vi.fn() },
    clipboard: { copyContextZip: vi.fn(), readText: vi.fn(), writeText: vi.fn() },
  } as unknown as WharnessDesktopBridge
}

describe('ChatGPTDesktopPane overlay suspension', () => {
  beforeEach(() => {
    vi.stubGlobal('ResizeObserver', TestResizeObserver)
  })
  afterEach(() => {
    cleanup()
    delete window.wharnessDesktop
    vi.unstubAllGlobals()
  })

  it('hides the native remote view while a trusted overlay is active and restores it afterwards', async () => {
    const desktop = bridge()
    window.wharnessDesktop = desktop
    const props = {
      session: session(), manualPrompt: '', busy: false, chatId: 'chat-1', chatTitle: 'Chat 1',
      onChatGPTURL: () => undefined, onSession: () => undefined, onManualPlan: async () => undefined,
      onPlanFile: async () => '', onBundleFile: async () => '',
    }
    const view = render(<ChatGPTDesktopPane {...props} suspended />)
    await waitFor(() => expect(desktop.chatgpt.hide).toHaveBeenCalled())
    expect(desktop.chatgpt.show).not.toHaveBeenCalled()

    view.rerender(<ChatGPTDesktopPane {...props} suspended={false} />)
    await waitFor(() => expect(desktop.chatgpt.show).toHaveBeenCalled())
  })
  it('shows the exact canonical bundle filename for the pending request', async () => {
    const desktop = bridge()
    window.wharnessDesktop = desktop
    render(<ChatGPTDesktopPane
      session={session()} manualPrompt="" busy={false} chatId="chat-1" chatTitle="Chat 1"
      onChatGPTURL={() => undefined} onSession={() => undefined} onManualPlan={async () => undefined}
      onPlanFile={async () => ''} onBundleFile={async () => ''}
    />)
    const downloadStep = screen.getByText('Resultado').closest('.desktop-action-card')
    expect(downloadStep).not.toBeNull()
    expect(within(downloadStep as HTMLElement).getByText('wharness-bundle-req_20260903T112307_7f79e5fe040d3e2d.zip')).toBeTruthy()
  })

  it('opens the managed external-auth bridge when external authentication is required', async () => {
    let authHandler: ((state: DesktopExternalAuthState) => void) | undefined
    const desktop = bridge()
    desktop.chatgpt.onExternalAuth = vi.fn((callback) => { authHandler = callback; return () => undefined })
    // Mirror the real desktop state while a managed external auth window is open: the
    // component clears externalAuth when state() reports authWindowOpen=false, so the
    // mock must reflect the active external-auth window.
    desktop.chatgpt.state = vi.fn().mockResolvedValue({ ...state, authWindowOpen: true, externalAuthProvider: 'Google' })
    window.wharnessDesktop = desktop
    render(<ChatGPTDesktopPane
      session={session()} manualPrompt="prompt" busy={false} chatId="chat-1" chatTitle="Chat 1"
      onChatGPTURL={() => undefined} onSession={() => undefined} onManualPlan={async () => undefined}
      onPlanFile={async () => ''} onBundleFile={async () => 'bundle importado'}
    />)
    act(() => authHandler?.({ cacheKey: 'chat-1', provider: 'Google', url: 'https://accounts.google.com/o/oauth2/v2/auth', authMode: 'external', managedWindow: true }))
    expect(await screen.findByText('Autenticação externa — Google')).toBeTruthy()
    expect(screen.getByRole('button', { name: /Importar bundle ZIP/i })).toBeTruthy()
    await waitFor(() => expect(desktop.chatgpt.hide).toHaveBeenCalled())
  })


  it('can send the prepared prompt directly to the currently open ChatGPT composer', async () => {
    const desktop = bridge()
    desktop.chatgpt.attachPrompt = vi.fn().mockResolvedValue({ ok: true, cacheKey: 'chat-1', bytes: 128, conversationUrl: 'https://chatgpt.com/c/current' })
    window.wharnessDesktop = desktop
    render(<ChatGPTDesktopPane
      session={session()} manualPrompt="prompt atual" busy={false} chatId="chat-1" chatTitle="Chat 1"
      onChatGPTURL={() => undefined} onSession={() => undefined} onManualPlan={async () => undefined}
      onPlanFile={async () => ''} onBundleFile={async () => ''}
    />)
    screen.getByRole('button', { name: /Enviar prompt/i }).click()
    await waitFor(() => expect(desktop.chatgpt.attachPrompt).toHaveBeenCalledWith({ cacheKey: 'chat-1', text: 'prompt atual', url: undefined }))
  })

  it('offers embedded and external login modes and starts the selected flow', async () => {
    const desktop = bridge()
    window.wharnessDesktop = desktop
    render(<ChatGPTDesktopPane
      session={session()} manualPrompt="" busy={false} chatId="chat-1" chatTitle="Chat 1"
      onChatGPTURL={() => undefined} onSession={() => undefined} onManualPlan={async () => undefined}
      onPlanFile={async () => ''} onBundleFile={async () => ''}
    />)
    screen.getByRole('button', { name: 'Login incorporado' }).click()
    await waitFor(() => expect(desktop.chatgpt.startAuth).toHaveBeenCalledWith('chat-1', 'embedded'))
    screen.getByRole('button', { name: /Login externo/i }).click()
    await waitFor(() => expect(desktop.chatgpt.startAuth).toHaveBeenCalledWith('chat-1', 'external'))
  })


})
