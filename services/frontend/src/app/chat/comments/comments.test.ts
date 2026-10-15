import { expect, it, vi } from 'vitest'
import type { CodexThread } from '../../../lib/codex'
import { newWorkspaceChat } from '../../../lib/chat/history/workspaceMemory'
import type { Session } from '../../../types'
import { sendTaskComment } from './index'

const session: Session = { id: 'session', project_path: '/project', state: 'ready', execution_mode: 'protected', automation_mode: 'manual', created_at: '',
  context: { id: 'context', manifest: { id: 'context', project_root: '/project', sha256: '', files: [], excluded: [], text_truncated: false } } }
const native: CodexThread = { native: true, projectPath: session.project_path, chatId: 'chat', requestId: 'req_native_active', threadId: 'thread', status: 'running', title: 'Native', error: '', messages: [], tokenUsage: null }
it('uses the active native request even when the backend has no Scraper request, without a queue fallback', async () => {
  const steerNative = vi.fn().mockResolvedValue({ ok: true }), queueComment = vi.fn()
  const bridge = { codex: { steerNative }, chatgpt: { queueComment } }
  const chat = { ...newWorkspaceChat(session.id, 'Native', 'chat'), engine: 'codex' as const }
  const item = await sendTaskComment(bridge, session, chat, native, 'Inclua também o teste.', [])
  expect(steerNative).toHaveBeenCalledWith(session.project_path, 'chat', native.requestId, expect.any(String), 'Inclua também o teste.', [])
  expect(queueComment).not.toHaveBeenCalled()
  expect(item.meta).toBe('Instrução enviada ao Codex')
})
it('refuses stale native ownership and unavailable runtimes rather than queueing guidance for another engine', async () => {
  const steerNative = vi.fn(), queueComment = vi.fn()
  const bridge = { codex: { steerNative }, chatgpt: { queueComment } }
  const chat = { ...newWorkspaceChat(session.id, 'Native', 'chat'), engine: 'codex' as const }
  await expect(sendTaskComment(bridge, session, chat, { ...native, chatId: 'other' }, 'Guidance', [])).rejects.toThrow(/ativo/)
  await expect(sendTaskComment(bridge, session, chat, { ...native, status: 'completed' }, 'Guidance', [])).rejects.toThrow(/ativo/)
  expect(steerNative).not.toHaveBeenCalled(); expect(queueComment).not.toHaveBeenCalled()
})
