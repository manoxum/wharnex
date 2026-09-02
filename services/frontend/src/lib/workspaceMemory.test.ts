import { beforeEach, describe, expect, it } from 'vitest'
import {
  clearActiveWorkspace, deriveChatTitle, loadActiveWorkspace, loadChat, loadExecutionMode, loadRecentWorkspaces,
  loadWorkspaceChats, newWorkspaceChat, rememberRecent, saveActiveWorkspace, saveChat, saveExecutionMode, saveWorkspaceChats,
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

  it('derives compact chat titles from the first request', () => {
    expect(deriveChatTitle('  corrigir   o erro do login  ')).toBe('corrigir o erro do login')
    expect(deriveChatTitle('x'.repeat(80)).length).toBeLessThanOrEqual(46)
  })
})
