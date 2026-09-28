import { describe, expect, it } from 'vitest'
import type { AttentionRecord, Session } from '../types'
import { orchestratorRestartChats } from './orchestratorRestart'
import type { WorkspaceChat } from './workspaceMemory'

function record(overrides: Partial<AttentionRecord>): AttentionRecord {
  return { session_id: 'ses_task', chat_id: 'otk-20260928T004456-51bcaa7726837de3', state: 'restart_pending', has_plan: false, pending_host_changes: 0, ...overrides }
}

// The same projection the App applies to every attention record.
const toSession = (value: AttentionRecord) => ({
  id: value.session_id, chat_id: value.chat_id, state: value.state,
  self_evolution: value.self_evolution, self_evolution_activation: value.self_evolution_activation,
  last_host_applied_at: value.last_host_applied_at, last_turn: value.last_turn,
}) as Session

describe('orchestratorRestartChats', () => {
  it('surfaces an Orchestrator task whose self-evolution awaits activation, like an agentic chat', () => {
    const pending = record({ self_evolution: true, self_evolution_activation: 'restart_pending', last_host_applied_at: '2026-09-28T03:10:00Z', last_turn: { chat_title: 'Fixar baseline' } as AttentionRecord['last_turn'] })
    const result = orchestratorRestartChats([pending], [], toSession)
    expect(result.chats).toHaveLength(1)
    expect(result.chats[0]).toMatchObject({ id: pending.chat_id, sessionId: 'ses_task', purpose: 'self-evolution' })
    expect(result.chats[0].title).toContain('Fixar baseline')
    expect(result.sessions[pending.chat_id]?.self_evolution_activation).toBe('restart_pending')
  })

  it('ignores ordinary chats, finished activations and tasks outside self-evolution', () => {
    const ordinary: WorkspaceChat = { id: 'chat-1', title: 'Chat', sessionId: 'ses_chat', createdAt: '', updatedAt: '' }
    const result = orchestratorRestartChats([
      record({ chat_id: 'chat-1', session_id: 'ses_chat', self_evolution: true, self_evolution_activation: 'restart_pending' }),
      record({ session_id: 'ses_done', self_evolution: true, self_evolution_activation: 'restart_scheduled' }),
      record({ session_id: 'ses_plain', chat_id: 'otk-plain', self_evolution: false, state: 'applied' }),
    ], [ordinary], toSession)
    expect(result.chats).toEqual([])
  })
})
