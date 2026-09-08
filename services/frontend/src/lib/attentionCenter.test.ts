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
    expect(items).toEqual(expect.arrayContaining([expect.objectContaining({ chatId: 'chat-2', title: 'Alterações prontas para o host', tone: 'success', action: 'apply-host' })]))
  })

  it('surfaces human action and integration conflicts ahead of ready applies', () => {
    const conflictChat = { ...chat('chat-1', 'Conflito'), conflictSurfaces: { cf: { cacheKey: 'chat-1_cf', url: 'https://chatgpt.com/c/one' } } }
    const conflicted = session('ses-chat-1')
    conflicted.integration_conflict = { id: 'cf', request_id: 'req-cf', original_plan_ids: ['plan-cf'], paths: ['a.ts'], details: [], created_at: '2026-09-07T10:00:00.000Z' }
    const items = collectAttentionItems([conflictChat], { 'chat-1': conflicted }, { 'chat-1_cf': { cacheKey: 'chat-1_cf', active: true, kind: 'verification', message: 'Confirme no navegador.' } })
    expect(items[0].title).toBe('Conflito de integração')
    expect(items.map((entry) => entry.title)).toContain('Ação humana necessária no ChatGPT')
  })

  it('does not announce a live execution as interrupted after switching chats', () => {
    const running = session('ses-chat-2')
    running.interrupted_execution = { plan_id: 'plan-running', requested_at: '2026-09-08T18:20:00.000Z', approved: false, status: 'running' }
    const items = collectAttentionItems([chat('chat-2', 'Em execução')], { 'chat-2': running })
    expect(items.map((entry) => entry.title)).not.toContain('Execução interrompida')
  })

  it('keeps a manual GPT fallback after automatic repair stops', () => {
    const failed = session('ses-chat-2')
    failed.state = 'failed'
    failed.plan = undefined
    failed.policy = undefined
    failed.last_repair_error = 'tests still fail'
    failed.last_execution = { plan_id: 'plan-failed', success: false, error: 'tests still fail', started_at: '2026-09-08T18:20:00.000Z', completed_at: '2026-09-08T18:20:01.000Z', commands: [] }
    const items = collectAttentionItems([chat('chat-2', 'Falhou')], { 'chat-2': failed })
    expect(items.find((entry) => entry.title === 'Erro reparável com GPT')?.action).toBe('repair-with-gpt')
  })

  it('maps approval and dependency recovery alerts to their popup actions', () => {
    const approval = session('ses-chat-1')
    approval.state = 'planned'
    approval.policy = { allowed: true, requires_approval: true, risk: 'medium', reasons: ['Mudança protegida.'] }
    approval.plan = { protocol: 'harness.execution/v1', plan_id: 'plan-approval', request_id: 'req-approval', status: 'ready', summary: 'Aprovação', risk: 'medium', requires_approval: true, operations: [], verification: [] }
    const approvalItems = collectAttentionItems([chat('chat-1', 'Principal')], { 'chat-1': approval })
    expect(approvalItems).toEqual(expect.arrayContaining([expect.objectContaining({ title: 'Aprovação necessária', action: 'approve-execution' })]))

    const offline = session('ses-chat-1')
    offline.state = 'failed'
    offline.failure_kind = 'offline_go_module_cache'
    offline.last_repair_error = 'offline sandbox dependencies unavailable: github.com/jackc/pgpassfile'
    offline.plan = { protocol: 'harness.execution/v1', plan_id: 'plan-offline', request_id: 'req-offline', status: 'ready', summary: 'Build', risk: 'low', requires_approval: false, operations: [], verification: [] }
    offline.last_execution = { plan_id: 'plan-offline', success: false, started_at: '2026-09-07T10:00:00.000Z', completed_at: '2026-09-07T10:00:01.000Z', commands: [] }
    const offlineItems = collectAttentionItems([chat('chat-1', 'Principal')], { 'chat-1': offline })
    expect(offlineItems).toEqual(expect.arrayContaining([expect.objectContaining({ title: 'Dependências precisam de rede', action: 'retry-dependency-network' })]))
  })

  it('does not offer network retry for a planner-reported offline_go_module_cache that never carries a plan', () => {
    // Per SoT/AI_PROTOCOL.md, a `blocked`/`failed` planner turn never carries a
    // plan, so RetryDependencyNetwork (which requires a coherent failed plan +
    // matching last_execution) can never recover this case. The generic
    // blocked-turn item should surface instead, not a retry action doomed to
    // fail with "dependency network recovery requires the currently failed plan".
    const blockedNoPlan = session('ses-chat-1')
    blockedNoPlan.state = 'failed'
    blockedNoPlan.failure_kind = 'offline_go_module_cache'
    blockedNoPlan.last_repair_error = 'Planner reported failed: offline_host_go_module_cache'
    blockedNoPlan.last_turn = { protocol: 'harness.turn/v1', request_id: 'req-blocked', kind: 'blocked', message: 'O build list Go não pode ser resolvido com GOPROXY=off.' }
    const items = collectAttentionItems([chat('chat-1', 'Principal')], { 'chat-1': blockedNoPlan })
    expect(items).not.toEqual(expect.arrayContaining([expect.objectContaining({ action: 'retry-dependency-network' })]))
    expect(items).toEqual(expect.arrayContaining([expect.objectContaining({ title: 'Pedido bloqueado' })]))
  })

  it('turns persisted self-evolution metadata blocks into one retry action', () => {
    const current = session('ses-chat-1')
    current.state = 'failed'
    current.failure_kind = 'self_evolution_transaction_metadata_mismatch'
    current.last_turn = {
      protocol: 'harness.turn/v1', request_id: 'req-stuck', kind: 'blocked',
      message: 'prepare Wharness self-evolution transaction: self-evolution transaction metadata does not match transaction',
    }
    current.pending_host_changes = [{
      plan: { protocol: 'harness.execution/v1', plan_id: 'plan-1', request_id: 'req-1', status: 'ready', summary: 'Mudança', risk: 'low', requires_approval: false, operations: [], verification: [] },
      execution: { plan_id: 'plan-1', success: true, started_at: '2026-09-07T10:00:00.000Z', completed_at: '2026-09-07T10:00:01.000Z', commands: [] },
      verified_at: '2026-09-07T10:00:01.000Z',
    }]
    const items = collectAttentionItems([chat('chat-1', 'Principal')], { 'chat-1': current })
    expect(items).toEqual([expect.objectContaining({ title: 'Aplicação ao host pronta para repetir', tone: 'warning', action: 'retry-host-apply' })])
    expect(items.map((entry) => entry.title)).not.toContain('Pedido bloqueado')
    expect(items.map((entry) => entry.title)).not.toContain('Alterações prontas para o host')
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
    expect(items).toEqual([expect.objectContaining({ title: 'Aplicação ao host pronta para repetir', action: 'retry-host-apply' })])
  })
})
