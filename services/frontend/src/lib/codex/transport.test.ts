import { describe, expect, it, vi } from 'vitest'
import { preparePlannerPrompt, transportPlannerContinuation } from './transport'
import { durableWorkspaceChat, mergeDurableWorkspaceChats, newWorkspaceChat } from '../chat/history/workspaceMemory'
import type { CodexPrepareRequest } from './contracts'
import type { Session } from '../../types'

const request: CodexPrepareRequest = { cacheKey: 'chat', sessionId: 'session', requestId: 'req_20261012T093000_1adfea24039ba474', text: 'Bundle bootstrap', attachments: [], projectPath: '/project' }
function bridgeFixture() {
  const prepare = vi.fn().mockResolvedValue({ submitted: true })
  const codex = vi.fn().mockResolvedValue({ submitted: true })
  // Model only the two transport capabilities this boundary consumes.
  const bridge = { chatgpt: { preparePrompt: prepare }, codex: { preparePrompt: codex } }
  return { prepare, codex, bridge }
}
describe('native planner engine routing', () => {
  it('keeps existing chats on ChatGPT and routes explicit Codex chats with their model', async () => {
    const { bridge, prepare, codex } = bridgeFixture()
    const chat = newWorkspaceChat('session', 'Test', 'chat')
    await preparePlannerPrompt(bridge as unknown as WharnessDesktopBridge, chat, request)
    expect(prepare).toHaveBeenCalledWith(request)
    await preparePlannerPrompt(bridge as unknown as WharnessDesktopBridge, { ...chat, engine: 'codex', codexModel: 'selected-model' }, request)
    expect(codex).toHaveBeenCalledWith({ ...request, model: 'selected-model' })
    expect(prepare).toHaveBeenCalledTimes(1)
  })
  it('persists engine choice and model in the existing durable chat record', () => {
    const chat = { ...newWorkspaceChat('session', 'Codex', 'chat'), engine: 'codex' as const, codexModel: 'selected-model' }
    const record = durableWorkspaceChat('/project', chat)
    expect(record.extra).toMatchObject({ engine: 'codex', codexModel: 'selected-model' })
    expect(mergeDurableWorkspaceChats([], [record])[0]).toMatchObject(chat)
  })
  it('keeps continuation bundles on the selected engine with the same request identity', async () => {
    const { bridge, codex, prepare } = bridgeFixture()
    const session = { id: 'session', project_path: '/project', last_request_id: request.requestId, last_manual_prompt: 'Follow-up bundle', pending_manual_request_ids: [request.requestId], context: { manifest: { sha256: 'hash' } } } as Session
    await transportPlannerContinuation({ bridge: bridge as unknown as WharnessDesktopBridge, session, chat: { ...newWorkspaceChat('session', 'Codex', 'chat'), engine: 'codex' }, artifacts: [], includeContext: true })
    expect(codex).toHaveBeenCalledWith(expect.objectContaining({ requestId: request.requestId, projectPath: '/project', includeContext: true }))
    expect(prepare).not.toHaveBeenCalled()
  })
})
