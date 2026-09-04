import { beforeEach, describe, expect, it } from 'vitest'
import {
  archiveChat, clearActiveWorkspace, deriveChatTitle, loadActiveWorkspace, loadArchivedWorkspaceChats, loadAutomationMode, loadChat, loadExecutionMode, loadRecentWorkspaces,
  loadWorkspaceChats, loadExecutionHistory, newWorkspaceChat, rememberRecent, removeArchivedChat, restoreArchivedChat, saveActiveWorkspace, saveAutomationMode, saveChat, saveExecutionHistory, saveExecutionMode, saveWorkspaceChats,
} from './workspaceMemory'

beforeEach(() => localStorage.clear())

describe('workspace memory', () => {
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

  it('deduplicates recent workspaces', () => {
    rememberRecent('/tmp/a'); rememberRecent('/tmp/b'); rememberRecent('/tmp/a')
    expect(loadRecentWorkspaces()).toEqual(['/tmp/a', '/tmp/b'])
  })

  it('persists multiple Harness chats with independent ChatGPT URLs and histories', () => {
    const first = { ...newWorkspaceChat('ses-1', 'Primeiro'), chatgptUrl: 'https://chatgpt.com/c/aaa' }
    const second = { ...newWorkspaceChat('ses-2', 'Segundo'), chatgptUrl: 'https://chatgpt.com/c/bbb' }
    saveWorkspaceChats('/tmp/project', [first, second])
    saveChat('/tmp/project', first.id, [{ id: 'm1', role: 'user', text: 'A' }])
    saveChat('/tmp/project', second.id, [{ id: 'm2', role: 'user', text: 'B' }])

    const loaded = loadWorkspaceChats('/tmp/project')
    expect(loaded).toHaveLength(2)
    expect(loaded.map((item) => item.chatgptUrl).sort()).toEqual(['https://chatgpt.com/c/aaa', 'https://chatgpt.com/c/bbb'])
    expect(loadChat('/tmp/project', first.id)[0].text).toBe('A')
    expect(loadChat('/tmp/project', second.id)[0].text).toBe('B')
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
