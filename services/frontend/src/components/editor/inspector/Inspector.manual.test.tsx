import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Session } from '../../../types'
import type { WorkspaceChat } from '../../../lib/chat/history/workspaceMemory'
import { Inspector } from './Inspector'

class TestResizeObserver { observe() {}; disconnect() {}; unobserve() {} }

function bridge() {
  const noopSubscription = () => () => undefined
  const state = { url: 'https://chatgpt.com/', title: 'ChatGPT', loading: false, canGoBack: false, canGoForward: false, authMode: 'embedded' as const, authenticated: true }
  return {
    platform: 'linux', projects: { pickDirectory: vi.fn() },
    chatgpt: {
      show: vi.fn().mockResolvedValue({ ok: true }), hide: vi.fn().mockResolvedValue({ ok: true }), setBounds: vi.fn().mockResolvedValue({ ok: true }),
      navigate: vi.fn().mockResolvedValue(state), state: vi.fn().mockResolvedValue(state), confirmAffinity: vi.fn(), rejectAffinity: vi.fn(), reload: vi.fn(), back: vi.fn(), forward: vi.fn(), paste: vi.fn(), openDevTools: vi.fn(), openExternal: vi.fn(), openInternal: vi.fn(),
      setAuthMode: vi.fn(), startAuth: vi.fn(), resumeEmbedded: vi.fn(), continueExpectedBundle: vi.fn(), resumeExpectedBundle: vi.fn(), cancelRequest: vi.fn(), stopConversation: vi.fn(), pickBundle: vi.fn(), copyPendingBundles: vi.fn(), release: vi.fn(),
      onState: vi.fn(noopSubscription), onExternalAuth: vi.fn(noopSubscription), onAuthComplete: vi.fn(noopSubscription), onAuthError: vi.fn(noopSubscription), onPlanDownloaded: vi.fn(noopSubscription), onPlanDownloadError: vi.fn(noopSubscription), onBundleDownloaded: vi.fn(noopSubscription), onBundleDownloadError: vi.fn(noopSubscription), onActivity: vi.fn(noopSubscription),
    },
    clipboard: { writeText: vi.fn(), readText: vi.fn(), copyContextZip: vi.fn() },
  } as unknown as WharnessDesktopBridge
}

function session(chat: WorkspaceChat): Session {
  return {
    id: chat.sessionId, project_path: '/tmp/demo', state: 'awaiting_plan', execution_mode: 'protected', automation_mode: 'manual', chat_transport_mode: 'manual', created_at: new Date().toISOString(), last_manual_prompt: 'prompt preparado',
    context: { id: 'ctx', manifest: { id: 'ctx', project_root: '/tmp/demo', sha256: 'abc', files: [], excluded: [], text_truncated: false } },
    policy: { allowed: true, requires_approval: false, risk: 'low', reasons: [] },
  }
}

describe('Inspector manual ChatGPT transport', () => {
  beforeEach(() => { vi.stubGlobal('ResizeObserver', TestResizeObserver) })
  afterEach(() => { cleanup(); delete window.wharnessDesktop; vi.unstubAllGlobals() })

  it('keeps the Desktop Engine projected and replaces the old standalone manual chat with the engine toolbar', async () => {
    const desktop = bridge(); window.wharnessDesktop = desktop
    const chat: WorkspaceChat = { id: 'chat-a', title: 'Chat A', sessionId: 'ses-chat-a', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }
    render(<Inspector
      config={{ planner: 'manual', sandbox: 'docker', model: 'test', api_configured: true, chatgpt_web_embed: false }}
      session={session(chat)} events={[]} manualPrompt="prompt preparado" busy={false} activeTab="chatgpt" chat={chat} chats={[chat]}
      onChatGPTURL={() => true} onExecute={async () => undefined} onManualPlan={async () => undefined} onPlanFile={async () => ''} onBundleFile={async () => ''} onSession={() => undefined}
    />)

    await waitFor(() => expect(desktop.chatgpt.show).toHaveBeenCalledWith(expect.anything(), 'chat-a', expect.anything()))
    expect(screen.getByTestId('manual-chatgpt-toolbar')).toBeTruthy()
    expect(screen.getByText('Manual · Engine')).toBeTruthy()
    expect(document.querySelector('.manual-transport-view')).toBeNull()
  })
})
