import { describe, expect, it, vi } from 'vitest'
import { recoverCodexContinuation } from './recovery'
import type { Session } from '../../types'
import { newWorkspaceChat } from '../chat/history/workspaceMemory'
import type { CodexThread } from './contracts'
const session = { project_path: '/project', state: 'workflow_pending', last_request_id: 'next-request', pending_manual_request_ids: ['next-request'] } as Session
const chat = { ...newWorkspaceChat('session', 'Codex', 'chat'), engine: 'codex' as const }
function fixture(status: CodexThread['status'], requestId = 'prior-request') {
  const dispatch = vi.fn(async () => {})
  const bridge = { codex: { threads: async () => [{ chatId: 'chat', status, requestId }] } } as unknown as WharnessDesktopBridge
  return { bridge, dispatch }
}
describe('native continuation recovery', () => {
  it('recovers an undispatched derived request after restart', async () => {
    const { bridge, dispatch } = fixture('idle')
    expect(await recoverCodexContinuation(bridge, session, chat, dispatch)).toBe(true)
    expect(dispatch).toHaveBeenCalledTimes(1)
  })
  it.each(['running', 'submitting', 'ready', 'attention'] as const)('does not submit another turn while the native binding is %s', async (status) => {
    const { bridge, dispatch } = fixture(status)
    expect(await recoverCodexContinuation(bridge, session, chat, dispatch)).toBe(false)
    expect(dispatch).not.toHaveBeenCalled()
  })
  it('does not revive a cancelled request with the same identity', async () => {
    const { bridge, dispatch } = fixture('idle', 'next-request')
    expect(await recoverCodexContinuation(bridge, session, chat, dispatch)).toBe(false)
    expect(dispatch).not.toHaveBeenCalled()
  })
})
