import { beforeEach, describe, expect, it } from 'vitest'
import {
	archiveChat, clearActiveWorkspace, conflictChatGPTCacheKey, deriveChatTitle, loadActiveWorkspace, loadArchivedWorkspaceChats, loadAutomationMode, loadChat, loadExecutionMode, loadRecentWorkspaces,
  loadWorkspaceChats, loadExecutionHistory, loadTransportOptions, newWorkspaceChat, normalizeTransportOptions, rememberRecent, removeArchivedChat, restoreArchivedChat, saveActiveWorkspace, saveAutomationMode, saveChat, saveExecutionHistory, saveExecutionMode, saveTransportOptions, saveWorkspaceChats,
} from './workspaceMemory'

beforeEach(() => localStorage.clear())

describe('workspace memory', () => {
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

  it('persists independent project transport switches and prevents disabling both', () => {
    expect(loadTransportOptions()).toEqual({ requestArchive: false, liveTunnels: true })
    saveTransportOptions({ requestArchive: true, liveTunnels: false })
    expect(loadTransportOptions()).toEqual({ requestArchive: true, liveTunnels: false })
    expect(normalizeTransportOptions({ requestArchive: false, liveTunnels: false })).toEqual({ requestArchive: false, liveTunnels: true })
  })

  it('deduplicates recent workspaces', () => {
    rememberRecent('/tmp/a'); rememberRecent('/tmp/b'); rememberRecent('/tmp/a')
    expect(loadRecentWorkspaces()).toEqual(['/tmp/a', '/tmp/b'])
  })

  it('persists multiple Harness chats with independent ChatGPT URLs and histories', () => {
    const first = { ...newWorkspaceChat('ses-1', 'Primeiro'), chatgptUrl: 'https://chatgpt.com/c/aaa', requestMode: 'plan_first' as const, transport: { requestArchive: false, liveTunnels: true }, pendingPlan: { requestId: 'req-1', originalMessage: 'alterar UI' } }
    const second = { ...newWorkspaceChat('ses-2', 'Segundo'), chatgptUrl: 'https://chatgpt.com/c/bbb' }
    saveWorkspaceChats('/tmp/project', [first, second])
    saveChat('/tmp/project', first.id, [{ id: 'm1', role: 'user', text: 'A' }])
    saveChat('/tmp/project', second.id, [{ id: 'm2', role: 'user', text: 'B' }])

    const loaded = loadWorkspaceChats('/tmp/project')
    expect(loaded).toHaveLength(2)
    expect(loaded.map((item) => item.chatgptUrl).sort()).toEqual(['https://chatgpt.com/c/aaa', 'https://chatgpt.com/c/bbb'])
    expect(loaded.find((item) => item.id === first.id)?.pendingPlan?.requestId).toBe('req-1')
    expect(loaded.find((item) => item.id === first.id)?.transport).toEqual({ requestArchive: false, liveTunnels: true })
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

  it('derives compact chat titles from the first request', () => {
    expect(deriveChatTitle('  corrigir   o erro do login  ')).toBe('corrigir o erro do login')
    expect(deriveChatTitle('x'.repeat(80)).length).toBeLessThanOrEqual(46)
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
})
