import { describe, expect, it } from 'vitest'
import type { Session } from '../types'
import type { WorkspaceChat } from './workspaceMemory'
import { collectAttentionItems } from './attentionCenter'

const chat = (id: string, title: string, sessionId = `ses-${id}`): WorkspaceChat => ({ id, title, sessionId, createdAt: '2026-09-07T10:00:00.000Z', updatedAt: '2026-09-07T10:00:00.000Z' })

function session(id: string): Session {
  return {
    id, project_path: '/workspace/wharness', state: 'verified', execution_mode: 'protected', automation_mode: 'auto', created_at: '2026-09-07T10:00:00.000Z',
    context: { id: 'ctx', manifest: { id: 'ctx', project_root: '/workspace/wharness', sha256: 'abc', files: [], excluded: [], text_truncated: false } },
  }
}

describe('attention center', () => {
  it('collects pending host applies from inactive chats', () => {
    const principal = chat('chat-1', 'Principal')
    const parallel = chat('chat-2', 'Paralelo')
    const inactive = session('ses-chat-2')
    inactive.pending_host_changes = [{
      plan: { protocol: 'harness.execution/v1', plan_id: 'plan-2', request_id: 'req-2', status: 'ready', summary: 'Mudança', risk: 'low', requires_approval: false, operations: [], verification: [] },
      execution: { plan_id: 'plan-2', success: true, started_at: '2026-09-07T10:00:00.000Z', completed_at: '2026-09-07T10:00:01.000Z', commands: [] },
      verified_at: '2026-09-07T10:00:01.000Z',
    }]
    const items = collectAttentionItems([principal, parallel], { 'chat-1': session('ses-chat-1'), 'chat-2': inactive })
    expect(items).toEqual(expect.arrayContaining([expect.objectContaining({ chatId: 'chat-2', title: 'Alterações prontas para o host', tone: 'success' })]))
  })

  it('surfaces human action and integration conflicts ahead of ready applies', () => {
    const conflictChat = { ...chat('chat-1', 'Conflito'), conflictSurfaces: { cf: { cacheKey: 'chat-1_cf', url: 'https://chatgpt.com/c/one' } } }
    const conflicted = session('ses-chat-1')
    conflicted.integration_conflict = { id: 'cf', request_id: 'req-cf', original_plan_ids: ['plan-cf'], paths: ['a.ts'], details: [], created_at: '2026-09-07T10:00:00.000Z' }
    const items = collectAttentionItems([conflictChat], { 'chat-1': conflicted }, { 'chat-1_cf': { cacheKey: 'chat-1_cf', active: true, kind: 'verification', message: 'Confirme no navegador.' } })
    expect(items[0].title).toBe('Conflito de integração')
    expect(items.map((entry) => entry.title)).toContain('Ação humana necessária no ChatGPT')
  })

  it('does not duplicate a generic host-apply alert when retry/apply recovery is the real action', () => {
    const current = session('ses-chat-1')
    current.failure_kind = 'host_integration_race'
    current.pending_host_changes = [{
      plan: { protocol: 'harness.execution/v1', plan_id: 'plan-1', request_id: 'req-1', status: 'ready', summary: 'Mudança', risk: 'low', requires_approval: false, operations: [], verification: [] },
      execution: { plan_id: 'plan-1', success: true, started_at: '2026-09-07T10:00:00.000Z', completed_at: '2026-09-07T10:00:01.000Z', commands: [] },
      verified_at: '2026-09-07T10:00:01.000Z',
    }]
    const items = collectAttentionItems([chat('chat-1', 'Principal')], { 'chat-1': current })
    expect(items.map((entry) => entry.title)).toEqual(['Aplicação ao host pronta para repetir'])
  })
})
