import { vi } from 'vitest'

export const state = { url: 'https://chatgpt.com/', title: 'ChatGPT', loading: false, canGoBack: false, canGoForward: false, authMode: 'embedded' as const, authWindowOpen: false, authenticated: false }

export function bridge() {
  const noopSubscription = () => () => undefined
  return {
    platform: 'linux', projects: { pickDirectory: vi.fn() },
    chatgpt: {
      show: vi.fn().mockResolvedValue({ ok: true }), hide: vi.fn().mockResolvedValue({ ok: true }), setBounds: vi.fn().mockResolvedValue({ ok: true }),
      navigate: vi.fn().mockResolvedValue(state), confirmAffinity: vi.fn().mockResolvedValue({ ok: true }), rejectAffinity: vi.fn().mockResolvedValue({ ok: true }), reload: vi.fn(), focus: vi.fn(), back: vi.fn(), forward: vi.fn(), paste: vi.fn(), openDevTools: vi.fn().mockResolvedValue({ ok: true }), submitPrompt: vi.fn(), preparePrompt: vi.fn(), attachContext: vi.fn(), attachPrompt: vi.fn(), submitPrepared: vi.fn(), continueExpectedBundle: vi.fn().mockResolvedValue({ ok: true }), resumeExpectedBundle: vi.fn().mockResolvedValue({ ok: true, cacheKey: 'chat-1', requestId: 'req_pending123', expectedFilename: 'bundle.zip' }), stopConversation: vi.fn().mockResolvedValue({ ok: true, state: 'stopped' }), cancelRequest: vi.fn().mockResolvedValue({ ok: true, cacheKey: 'chat-1', requestId: 'req_pending123', cleared: true }),
      state: vi.fn().mockResolvedValue({ ...state, cacheKey: 'chat-1' }), release: vi.fn().mockResolvedValue({ ok: true, released: true }), setAuthMode: vi.fn().mockResolvedValue(state), startAuth: vi.fn().mockResolvedValue(state), openExternal: vi.fn(), openInternal: vi.fn(), resumeEmbedded: vi.fn().mockResolvedValue(state), pickBundle: vi.fn(),
      onState: vi.fn(noopSubscription), onExternalAuth: vi.fn(noopSubscription), onAuthComplete: vi.fn(noopSubscription), onAuthError: vi.fn(noopSubscription),
      onPlanDownloaded: vi.fn(noopSubscription), onPlanDownloadError: vi.fn(noopSubscription), onBundleDownloaded: vi.fn(noopSubscription), onBundleDownloadError: vi.fn(noopSubscription),
      onActivity: vi.fn(noopSubscription), mirrorInput: vi.fn().mockResolvedValue({ ok: true }), subscribeMirror: vi.fn(noopSubscription),
    },
    agents: {
      state: vi.fn().mockResolvedValue({ instance_id: 'desktop-1', desired_workers: 2, limits: { min_workers: 1, max_workers: 6, supervisors: 2 }, scheduler: { running: true, backend_reachable: true, last_refresh_at: '', last_error: '' }, queue: { total: 0, counts: {}, due: 0, scheduled: 0, blocked: 0, oldest_due_created_at: '', next_not_before: '' }, provider: { provider: 'chatgpt', paused: false, paused_until: '', reason: '', updated_at: '' }, agents: [{ id: 'worker-1', label: 'Worker 1', role: 'worker', status: 'idle', draining: false, chat_id: '', error: '', browser: { available: true, web_contents_id: 11, url: 'https://chatgpt.com/', title: 'ChatGPT', loading: false } }, { id: 'worker-2', label: 'Worker 2', role: 'worker', status: 'running', draining: false, chat_id: 'chat-2', error: '', browser: { available: true, web_contents_id: 12, url: 'https://chatgpt.com/c/worker', title: 'Worker', loading: false } }] }),
      setWorkerCount: vi.fn(), setPolicies: vi.fn(), setWorkerKeepFlowing: vi.fn(), resumeProvider: vi.fn(), snapshot: vi.fn(), openMonitor: vi.fn().mockResolvedValue({ ok: true, agentId: 'worker-1', alreadyOpen: false }), closeMonitor: vi.fn().mockResolvedValue({ ok: true, agentId: 'worker-1', closed: true }), openDevTools: vi.fn().mockResolvedValue({ ok: true, agentId: 'worker-1' }), openInteraction: vi.fn().mockResolvedValue({ ok: true }), setInteractionBounds: vi.fn().mockResolvedValue({ ok: true }), closeInteraction: vi.fn().mockResolvedValue({ ok: true }), presentInMonitor: vi.fn().mockResolvedValue({ ok: true }), resizeInMonitor: vi.fn().mockResolvedValue({ ok: true }), releaseFromMonitor: vi.fn().mockResolvedValue({ ok: true }), onMonitorSelect: vi.fn(noopSubscription), mirrorInput: vi.fn().mockResolvedValue({ ok: true }), subscribeMirror: vi.fn(noopSubscription), onState: vi.fn(noopSubscription),
    },
    attachments: { persist: vi.fn(), preview: vi.fn(), open: vi.fn(), removeChat: vi.fn() }, clipboard: { copyContextZip: vi.fn(), readText: vi.fn(), writeText: vi.fn() },
  } as unknown as WharnessDesktopBridge
}

export const props = { busy: false, chatId: 'chat-1', chatTitle: 'Chat 1', onChatGPTURL: () => true, onPlanFile: async () => '', onBundleFile: async () => '' }
