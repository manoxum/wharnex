import { beforeEach, expect, it, vi } from 'vitest'
import type { Session } from '../../../types'
import { newWorkspaceChat, durableWorkspaceChat, mergeDurableWorkspaceChats } from '../../chat/history/workspaceMemory'
import { dispatchNativeCodex } from './dispatch'
import { rememberCodexSelection, resolveCodexSelection } from '../preferences'
beforeEach(() => localStorage.clear())
it('sends literal user text and explicit files without requesting a bundle or planner context', async () => {
  const prepareNative = vi.fn().mockResolvedValue({ submitted: true })
  const preparePrompt = vi.fn()
  const bridge = { codex: { prepareNative }, chatgpt: { preparePrompt } } as unknown as WharnessDesktopBridge
  const session = { id: 'session', project_path: '/project' } as Session
  const chat = { ...newWorkspaceChat('session', 'Native', 'chat'), engine: 'codex' as const, codexModel: 'model', codexEffort: 'xhigh' }
  const attachments = [{ name: 'notes.md', mime: 'text/markdown', contentBase64: 'YWJj' }]
  await dispatchNativeCodex(bridge, session, chat, 'Do exactly this.\n@see src/a.ts', attachments, ['src/a.ts'])
  expect(prepareNative).toHaveBeenCalledWith({ projectPath: '/project', cacheKey: chat.id, sessionId: 'session', requestId: expect.stringMatching(/^req_native_/), text: 'Do exactly this.\n@see src/a.ts', chatTitle: 'Native', model: 'model', effort: 'xhigh', attachments, projectFiles: ['src/a.ts'] })
  expect(preparePrompt).not.toHaveBeenCalled()
  expect(mergeDurableWorkspaceChats([], [durableWorkspaceChat('/project', chat)])[0].codexEffort).toBe('xhigh')
})

it('sends the chosen permission level and restores it with the durable chat', async () => {
  const prepareNative = vi.fn().mockResolvedValue({ submitted: true })
  const chat = { ...newWorkspaceChat('session', 'Native', 'chat'), codexPermission: 'ask' as const }
  await dispatchNativeCodex({ codex: { prepareNative } } as unknown as WharnessDesktopBridge, { id: 'session', project_path: '/project' } as Session, chat, 'Request', [], [])
  expect(prepareNative.mock.calls[0][0].permissionLevel).toBe('ask')
  expect(mergeDurableWorkspaceChats([], [durableWorkspaceChat('/project', chat)])[0].codexPermission).toBe('ask')
})
it('sends and pins remembered choices for an unconfigured chat, then remembers the last used chat', async () => {
  rememberCodexSelection('remembered-model', 'xhigh')
  const prepareNative = vi.fn().mockResolvedValue({ submitted: true }), persist = vi.fn()
  const bridge = { codex: { prepareNative } } as unknown as WharnessDesktopBridge
  const session = { id: 'session', project_path: '/project' } as Session
  const chat = newWorkspaceChat('session', 'New chat', 'chat')
  await dispatchNativeCodex(bridge, session, chat, 'Request', [], [], persist)
  expect(prepareNative).toHaveBeenLastCalledWith(expect.objectContaining({ model: 'remembered-model', effort: 'xhigh' }))
  expect(persist).toHaveBeenCalledWith({ codexModel: 'remembered-model', codexEffort: 'xhigh' })
  await dispatchNativeCodex(bridge, session, { ...chat, codexModel: 'older-model', codexEffort: 'low' }, 'Again', [], [])
  expect(resolveCodexSelection()).toEqual({ codexModel: 'older-model', codexEffort: 'low' })
})
