import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
	archiveChat, archiveSavedChat, clearActiveWorkspace, conflictChatGPTCacheKey, deriveChatTitle, plannerChatTitle, loadActiveWorkspace, loadArchivedWorkspaceChats, loadSavedWorkspaceChats, loadAutomationMode, loadChat, loadExecutionMode, loadRecentWorkspaces,
  durableWorkspaceChat, enabledTunnelIds, loadWorkspaceChats, loadExecutionHistory, loadTransportOptions, mergeDurableWorkspaceChats, newWorkspaceChat, normalizeTransportOptions, rememberRecent, removeArchivedChat, reorderWorkspaceChats, restoreArchivedChat, restoreSavedChat, saveActiveWorkspace, saveAutomationMode, saveChat, saveChatForLater, saveExecutionHistory, saveExecutionMode, saveTransportOptions, saveWorkspaceChats, loadComposerStoredFileDraft, saveComposerStoredFileDraft,
} from './workspaceMemory'

beforeEach(() => localStorage.clear())

describe('workspace memory', () => {
	it('round-trips every orchestration field through the durable chat record', () => {
		const local = {
			...newWorkspaceChat('ses-1', 'Principal', 'chat-1'),
			chatgptUrl: 'https://chatgpt.com/c/main',
			pendingPlan: { requestId: 'req-1', originalMessage: 'corrigir' },
			conflictSurfaces: { 'conflict-1': { cacheKey: 'chat-1_cf_conflict-1', url: 'https://chatgpt.com/c/conflict' } },
		}
		const record = durableWorkspaceChat('/tmp/project', local)
		const restored = mergeDurableWorkspaceChats([], [record])
		expect(restored).toEqual([local])
	})

	it('keeps local ordering while adding durable-only chats instead of losing them', () => {
		const local = newWorkspaceChat('ses-local', 'Local', 'chat-local')
		const durableOnly = durableWorkspaceChat('/tmp/project', newWorkspaceChat('ses-durable', 'Durável', 'chat-durable'))
		expect(mergeDurableWorkspaceChats([local], [durableOnly]).map((chat) => chat.id)).toEqual(['chat-local', 'chat-durable'])
	})

	it('creates stable isolated cache keys for dedicated conflict surfaces', () => {
		const key = conflictChatGPTCacheKey('chat-123', 'conflict-456')
		expect(key).toBe('chat-123_cf_conflict-456')
		expect(key).toMatch(/^[A-Za-z0-9_-]+$/)
		expect(key.length).toBeLessThanOrEqual(128)
	})
	it('persists conflict affinity separately from the primary ChatGPT conversation', () => {
		const base = newWorkspaceChat('ses-conflict', 'Principal')
		const cacheKey = conflictChatGPTCacheKey(base.id, 'conflict-1')
		const chat = {
			...base,
			chatgptUrl: 'https://chatgpt.com/c/main',
			conflictSurfaces: {
				'conflict-1': { cacheKey, url: 'https://chatgpt.com/c/conflict' },
			},
		}
		saveWorkspaceChats('/tmp/project', [chat])
		const restored = loadWorkspaceChats('/tmp/project')[0]
		expect(restored.chatgptUrl).toBe('https://chatgpt.com/c/main')
		expect(restored.conflictSurfaces?.['conflict-1']).toEqual({ cacheKey, url: 'https://chatgpt.com/c/conflict' })
		expect(restored.conflictSurfaces?.['conflict-1'].cacheKey).not.toBe(restored.id)
	})
  it('persists active workspace, active chat and recent paths', () => {
    saveActiveWorkspace({ sessionId: 's1', projectPath: '/tmp/project', mode: 'agent', chatId: 'chat-1' })
    expect(loadActiveWorkspace()).toEqual({ sessionId: 's1', projectPath: '/tmp/project', mode: 'agent', chatId: 'chat-1' })
    expect(loadRecentWorkspaces()).toEqual(['/tmp/project'])
    clearActiveWorkspace()
    expect(loadActiveWorkspace()).toBeUndefined()
    expect(loadRecentWorkspaces()).toEqual(['/tmp/project'])
  })


  it('persists protected/unprotected mode per project', () => {
    expect(loadExecutionMode('/tmp/project')).toBe('protected')
    saveExecutionMode('/tmp/project', 'unprotected')
    saveExecutionMode('/tmp/other', 'protected')
    expect(loadExecutionMode('/tmp/project')).toBe('unprotected')
    expect(loadExecutionMode('/tmp/other')).toBe('protected')
  })

  it('persists manual/auto automation mode per project', () => {
    expect(loadAutomationMode('/tmp/project')).toBe('auto')
    saveAutomationMode('/tmp/project', 'manual')
    expect(loadAutomationMode('/tmp/project')).toBe('manual')
    saveAutomationMode('/tmp/project', 'auto')
    expect(loadAutomationMode('/tmp/project')).toBe('auto')
  })

  it('persists disabled tunnel choices while the request ZIP stays mandatory', () => {
    expect(loadTransportOptions()).toEqual({ disabledTunnelIds: [] })
    saveTransportOptions({ disabledTunnelIds: ['secondary'] })
    expect(loadTransportOptions()).toEqual({ disabledTunnelIds: ['secondary'] })
    expect(normalizeTransportOptions({ liveTunnels: false })).toEqual({ disabledTunnelIds: ['*'] })
    localStorage.removeItem('kernl.workspace.transport-options.v3')
    localStorage.setItem('kernl.workspace.transport-options.v2', JSON.stringify({ requestArchive: true, liveTunnels: false }))
    expect(loadTransportOptions()).toEqual({ disabledTunnelIds: ['*'] })
    expect(enabledTunnelIds({ disabledTunnelIds: ['secondary'] }, [{ id: 'primary', available: true }, { id: 'secondary', available: true }, { id: 'offline', available: false }])).toEqual(['primary'])
  })

  it('deduplicates recent workspaces', () => {
    rememberRecent('/tmp/a'); rememberRecent('/tmp/b'); rememberRecent('/tmp/a')
    expect(loadRecentWorkspaces()).toEqual(['/tmp/a', '/tmp/b'])
  })

  it('restores active chats in the persisted tab order instead of sorting by activity', () => {
    const first = { ...newWorkspaceChat('ses-1', 'Primeiro'), updatedAt: '2026-09-04T08:00:00.000Z' }
    const second = { ...newWorkspaceChat('ses-2', 'Segundo'), updatedAt: '2026-09-05T08:00:00.000Z' }
    saveWorkspaceChats('/tmp/project', [first, second])
    expect(loadWorkspaceChats('/tmp/project').map((chat) => chat.id)).toEqual([first.id, second.id])
  })

  it('reorders active chats manually and preserves that order across reloads', () => {
    const first = newWorkspaceChat('ses-1', 'Primeiro')
    const second = newWorkspaceChat('ses-2', 'Segundo')
    const third = newWorkspaceChat('ses-3', 'Terceiro')
    const reordered = reorderWorkspaceChats([first, second, third], first.id, third.id)
    expect(reordered.map((chat) => chat.id)).toEqual([second.id, third.id, first.id])
    saveWorkspaceChats('/tmp/project', reordered)
    expect(loadWorkspaceChats('/tmp/project').map((chat) => chat.id)).toEqual([second.id, third.id, first.id])
  })

  it('persists multiple Harness chats with independent ChatGPT URLs and histories', () => {
    const first = { ...newWorkspaceChat('ses-1', 'Primeiro'), chatgptUrl: 'https://chatgpt.com/c/aaa', requestMode: 'plan_first' as const, transport: { disabledTunnelIds: ['fallback'] }, pendingPlan: { requestId: 'req-1', originalMessage: 'alterar UI' } }
    const second = { ...newWorkspaceChat('ses-2', 'Segundo'), chatgptUrl: 'https://chatgpt.com/c/bbb' }
    saveWorkspaceChats('/tmp/project', [first, second])
    saveChat('/tmp/project', first.id, [{ id: 'm1', role: 'user', text: 'A' }])
    saveChat('/tmp/project', second.id, [{ id: 'm2', role: 'user', text: 'B' }])

    const loaded = loadWorkspaceChats('/tmp/project')
    expect(loaded).toHaveLength(2)
    expect(loaded.map((item) => item.chatgptUrl).sort()).toEqual(['https://chatgpt.com/c/aaa', 'https://chatgpt.com/c/bbb'])
    expect(loaded.find((item) => item.id === first.id)?.pendingPlan?.requestId).toBe('req-1')
    expect(loaded.find((item) => item.id === first.id)?.transport).toEqual({ disabledTunnelIds: ['fallback'] })
    expect(loadChat('/tmp/project', first.id)[0].text).toBe('A')
    expect(loadChat('/tmp/project', second.id)[0].text).toBe('B')
  })

  it('removes transient ChatGPT WEB URLs from persisted chat affinity', () => {
    const chat = {
      ...newWorkspaceChat('ses-transient', 'Em criação'),
      chatgptUrl: 'https://chatgpt.com/c/WEB:temporary-id',
      lastContextChatgptUrl: 'https://chatgpt.com/c/WEB:temporary-id',
    }
    saveWorkspaceChats('/tmp/project', [chat])
    expect(loadWorkspaceChats('/tmp/project')[0]).toMatchObject({ id: chat.id })
    expect(loadWorkspaceChats('/tmp/project')[0].chatgptUrl).toBeUndefined()
    expect(loadWorkspaceChats('/tmp/project')[0].lastContextChatgptUrl).toBeUndefined()
  })

  it('persists attachment metadata and durable storage references with chat history', () => {
    const chat = newWorkspaceChat('ses-1', 'Com anexos')
    saveChat('/tmp/project', chat.id, [{
      id: 'm1', role: 'user', text: 'Veja o anexo',
      attachments: [{ name: 'screen.png', size: 1234, mime: 'image/png', storageRef: `${chat.id}/m1/0`, previewKind: 'thumbnail' }],
    }])
    expect(loadChat('/tmp/project', chat.id)[0].attachments).toEqual([
      { name: 'screen.png', size: 1234, mime: 'image/png', storageRef: `${chat.id}/m1/0`, previewKind: 'thumbnail' },
    ])
  })

  it('saves a chat in standby, reactivates it, and can archive it without losing the remote binding', () => {
    const chat = { ...newWorkspaceChat('ses-standby', 'Pendente'), chatgptUrl: 'https://chatgpt.com/c/pending' }
    saveWorkspaceChats('/tmp/project', [chat])
    saveChat('/tmp/project', chat.id, [{ id: 'm1', role: 'user', text: 'continuar depois' }])

    const parked = saveChatForLater('/tmp/project', chat.id)
    expect(parked.active).toEqual([])
    expect(loadSavedWorkspaceChats('/tmp/project')[0]).toMatchObject({ id: chat.id, chatgptUrl: chat.chatgptUrl })
    expect(loadSavedWorkspaceChats('/tmp/project')[0].savedAt).toBeTruthy()
    expect(loadChat('/tmp/project', chat.id)[0].text).toBe('continuar depois')

    const resumed = restoreSavedChat('/tmp/project', chat.id)
    expect(resumed.saved).toEqual([])
    expect(resumed.active[0]).toMatchObject({ id: chat.id, chatgptUrl: chat.chatgptUrl })
    expect(resumed.active[0].savedAt).toBeUndefined()

    saveChatForLater('/tmp/project', chat.id)
    const archived = archiveSavedChat('/tmp/project', chat.id)
    expect(archived.saved).toEqual([])
    expect(archived.archived[0]).toMatchObject({ id: chat.id, chatgptUrl: chat.chatgptUrl })
    expect(archived.archived[0].savedAt).toBeUndefined()
    expect(archived.archived[0].archivedAt).toBeTruthy()
  })

  it('archives, restores and permanently removes Harness chats without losing history on close', () => {
    const first = { ...newWorkspaceChat('ses-1', 'Primeiro'), chatgptUrl: 'https://chatgpt.com/c/aaa' }
    const second = { ...newWorkspaceChat('ses-2', 'Segundo'), chatgptUrl: 'https://chatgpt.com/c/bbb' }
    saveWorkspaceChats('/tmp/project', [first, second])
    saveChat('/tmp/project', first.id, [{ id: 'm1', role: 'user', text: 'A' }])
    saveChat('/tmp/project', second.id, [{ id: 'm2', role: 'user', text: 'B' }])

    const archived = archiveChat('/tmp/project', first.id)
    expect(archived.active.map((chat) => chat.id)).toEqual([second.id])
    expect(loadArchivedWorkspaceChats('/tmp/project').map((chat) => chat.id)).toEqual([first.id])
    expect(loadChat('/tmp/project', first.id)[0].text).toBe('A')

    const restored = restoreArchivedChat('/tmp/project', first.id)
    expect(restored.active.map((chat) => chat.id)).toContain(first.id)
    expect(loadArchivedWorkspaceChats('/tmp/project')).toEqual([])
    expect(loadChat('/tmp/project', first.id)[0].text).toBe('A')

    archiveChat('/tmp/project', first.id)
    removeArchivedChat('/tmp/project', first.id)
    expect(loadArchivedWorkspaceChats('/tmp/project')).toEqual([])
    expect(loadChat('/tmp/project', first.id)).toEqual([])
    expect(loadChat('/tmp/project', second.id)[0].text).toBe('B')
  })

  it('persists execution history per Harness chat across reloads', () => {
    saveExecutionHistory('/tmp/project', 'chat-1', [{ id: 'evt-1', session_id: 'ses-1', type: 'command.output', timestamp: '2026-09-03T23:00:00Z', data: { stream: 'stdout', text: 'ok' } }])
    expect(loadExecutionHistory('/tmp/project', 'chat-1')).toEqual([{ id: 'evt-1', session_id: 'ses-1', type: 'command.output', timestamp: '2026-09-03T23:00:00Z', data: { stream: 'stdout', text: 'ok' } }])
    expect(loadExecutionHistory('/tmp/project', 'chat-2')).toEqual([])
  })

  it('derives compact provisional chat titles from the first request', () => {
    expect(deriveChatTitle('  corrigir   o erro do login  ')).toBe('corrigir o erro do login')
    expect(deriveChatTitle('x'.repeat(80)).length).toBeLessThanOrEqual(46)
  })

  it('accepts semantic planner titles and rejects transport boilerplate', () => {
    expect(plannerChatTitle('WHX: Melhorar títulos dos chats')).toBe('Melhorar títulos dos chats')
    expect(plannerChatTitle('Processar ZIP')).toBe('')
    expect(plannerChatTitle('WHARNEX INPUT req_123')).toBe('')
    expect(plannerChatTitle('req_20260912T222335_af9bc62ec2a19770')).toBe('')
  })
})

describe('composer draft memory', () => {
  it('persists text and bounded composer height per chat', async () => {
    const memory = await import('./workspaceMemory')
    memory.saveComposerDraft('/p', 'chat-a', { message: 'Olá mundo', height: 999 })
    expect(memory.loadComposerDraft('/p', 'chat-a')).toEqual({ message: 'Olá mundo', height: 420 })
    memory.clearComposerDraft('/p', 'chat-a')
    expect(memory.loadComposerDraft('/p', 'chat-a')).toEqual({ message: '', height: 156 })
  })

  it('coalesces rapid composer draft writes while keeping the latest draft readable', async () => {
    const memory = await import('./workspaceMemory')
    vi.useFakeTimers()
    const setItem = vi.spyOn(Storage.prototype, 'setItem')
    try {
      memory.scheduleComposerDraftSave('/p', 'chat-a', { message: 'primeiro', height: 150 })
      memory.scheduleComposerDraftSave('/p', 'chat-a', { message: 'segundo', height: 160 })
      expect(memory.loadComposerDraft('/p', 'chat-a')).toEqual({ message: 'segundo', height: 160 })
      expect(setItem).not.toHaveBeenCalled()
      vi.advanceTimersByTime(179)
      expect(setItem).not.toHaveBeenCalled()
      vi.advanceTimersByTime(1)
      expect(setItem).toHaveBeenCalledTimes(1)
      expect(JSON.parse(localStorage.getItem('kernl.workspace.composer-draft.v1:/p:chat-a') || '{}')).toEqual({ message: 'segundo', height: 160 })
    } finally {
      memory.clearComposerDraft('/p', 'chat-a')
      setItem.mockRestore()
      vi.useRealTimers()
    }
  })

  it('keeps unsent attachment selections scoped to each chat for the current app runtime', async () => {
    const memory = await import('./workspaceMemory')
    const file = new File(['draft'], 'draft.txt', { type: 'text/plain' })
    memory.saveComposerFileDraft('/p', 'chat-a', { attachments: [file], projectFiles: ['src/App.tsx'] })
    expect(memory.loadComposerFileDraft('/p', 'chat-a')).toEqual({ attachments: [file], projectFiles: ['src/App.tsx'] })
    expect(memory.loadComposerFileDraft('/p', 'chat-b')).toEqual({ attachments: [], projectFiles: [] })
    memory.clearComposerDraft('/p', 'chat-a')
    expect(memory.loadComposerFileDraft('/p', 'chat-a')).toEqual({ attachments: [], projectFiles: [] })
  })

  it('persists durable composer attachment references across an app reload', () => {
    const attachments = [{ name: 'draft.txt', size: 5, mime: 'text/plain', storageRef: 'chat-a/composer_draft/0', previewKind: 'icon' as const, lastModified: 1_700_000_000_000 }]
    saveComposerStoredFileDraft('/p', 'chat-a', attachments)
    expect(loadComposerStoredFileDraft('/p', 'chat-a')).toEqual(attachments)
    expect(loadComposerStoredFileDraft('/p', 'chat-b')).toEqual([])
  })
})
