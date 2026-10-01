import { describe, expect, it } from 'vitest'
import { appliedChangePresentationItems, buildChangeSummary, mergeAppliedChangePresentationItems } from './changeSummary'
import type { ChatItem, ExecutionPlan, Session } from '../../../types'

it('summarizes changed files and line counts from unified patches', () => {
  const plan: ExecutionPlan = { protocol: 'harness.execution/v1', plan_id: 'p1', request_id: 'r1', status: 'ready', summary: 'x', risk: 'low', requires_approval: false, operations: [{ type: 'apply_patch', patch: 'diff --git a/a.txt b/a.txt\n--- a/a.txt\n+++ b/a.txt\n@@ -1 +1,2 @@\n-old\n+new\n+more\n', command: { argv: [], cwd: '.', timeout_seconds: 60, network: false, expected_exit_codes: [0] } }], verification: [] }
  const summary = buildChangeSummary(plan, '2026-09-04T06:00:00Z')!
  expect(summary.files).toEqual([{ path: 'a.txt', additions: 2, deletions: 1, diff: expect.stringContaining('+++ b/a.txt') }])
  expect(summary.hostCommands).toEqual([])
  expect(summary.canRevert).toBe(true)
})

describe('revert eligibility', () => {
  it('shows only commands that were actually replayed on the host and disables deterministic revert', () => {
    const plan = { protocol: 'harness.execution/v1', plan_id: 'p', request_id: 'r', status: 'ready', summary: '', risk: 'low', requires_approval: false, operations: [{ type: 'command', patch: '', command: { argv: ['git', 'add', 'x'], cwd: '.', timeout_seconds: 60, network: false, expected_exit_codes: [0] } }], verification: [] } as ExecutionPlan
    expect(buildChangeSummary(plan)).toBeUndefined()
    const summary = buildChangeSummary(plan, '2026-09-07T10:00:00Z', [{ argv: ['git', 'add', 'x'], cwd: '.', exit_code: 0, stdout: '', stderr: '', duration_ms: 12, success: true }])!
    expect(summary.files).toEqual([])
    expect(summary.hostCommands).toHaveLength(1)
    expect(summary.hostCommands?.[0]?.argv).toEqual(['git', 'add', 'x'])
    expect(summary.canRevert).toBe(false)
  })
})

it('projects an applied session into one durable final summary and one diff card idempotently', () => {
  const plan: ExecutionPlan = { protocol: 'harness.execution/v1', plan_id: 'p-applied', request_id: 'r-applied', status: 'ready', summary: 'Resumo curto', risk: 'low', requires_approval: false, operations: [{ type: 'apply_patch', patch: 'diff --git a/a.txt b/a.txt\n--- a/a.txt\n+++ b/a.txt\n@@ -1 +1 @@\n-old\n+new\n', command: { argv: [], cwd: '.', timeout_seconds: 60, network: false, expected_exit_codes: [0] } }], verification: [] }
  const session = {
    id: 'ses-applied', project_path: '/workspace/project', state: 'applied', execution_mode: 'protected', automation_mode: 'auto', created_at: '2026-09-14T06:00:00Z',
    context: { id: 'ctx', manifest: { id: 'ctx', project_root: '/workspace/project', sha256: 'sha', files: [], excluded: [], text_truncated: false } },
    last_main_request_summary: '# Resumo final\n\nImplementação concluída.',
    last_host_applied_at: '2026-09-14T06:41:10Z',
    last_applied_changes: [{ plan, execution: { plan_id: 'p-applied', success: true, started_at: '', completed_at: '', commands: [] }, verified_at: '2026-09-14T06:40:00Z' }],
  } satisfies Session

  const projected = appliedChangePresentationItems(session)
  expect(projected).toHaveLength(2)
  expect(projected[0]).toMatchObject({ presentation: 'message', text: session.last_main_request_summary, meta: 'Resumo cumulativo da Main Request' })
  expect(projected[1]).toMatchObject({ presentation: 'change', change: { planId: 'p-applied', files: [{ path: 'a.txt', additions: 1, deletions: 1 }] } })

  const legacyItems: ChatItem[] = [{ id: 'legacy-random-id', role: 'harness', source: 'wharness', presentation: 'change', text: 'Alterações e comandos aplicados ao host.', change: projected[1].change }]
  const once = mergeAppliedChangePresentationItems(legacyItems, projected)
  const twice = mergeAppliedChangePresentationItems(once, projected)
  expect(once.filter((item) => item.presentation === 'change')).toHaveLength(1)
  expect(twice).toEqual(once)
})

it('rebuilds the terminal package with one summary followed by the diff even from legacy order', () => {
  const summary: ChatItem = { id: 'host-applied-summary:p:t', role: 'harness', source: 'chatgpt', presentation: 'message', createdAt: 't', text: 'Resumo final', meta: 'Resumo cumulativo da Main Request' }
  const change: ChatItem = { id: 'host-applied-change:p:t', role: 'harness', source: 'wharness', presentation: 'change', createdAt: 't', text: 'Alterações', change: { planId: 'p', files: [], appliedAt: 't', canRevert: false } }
  const legacyTurn: ChatItem = { id: 'turn', role: 'harness', source: 'chatgpt', presentation: 'message', createdAt: 't', text: 'Mensagem anterior do GPT', meta: 'AUTO · Host aplicado' }
  const user: ChatItem = { id: 'user', role: 'user', text: 'Faça a mudança', createdAt: 'before' }

  const merged = mergeAppliedChangePresentationItems([user, change, legacyTurn, summary], [summary, change])

  expect(merged).toEqual([user, summary, change])
})

it('keeps the applied terminal package before a newer main request', () => {
  const plan: ExecutionPlan = { protocol: 'harness.execution/v1', plan_id: 'p-applied', request_id: 'r-applied', status: 'ready', summary: 'Resumo curto', risk: 'low', requires_approval: false, operations: [{ type: 'apply_patch', patch: 'diff --git a/a.txt b/a.txt\n--- a/a.txt\n+++ b/a.txt\n@@ -1 +1 @@\n-old\n+new\n', command: { argv: [], cwd: '.', timeout_seconds: 60, network: false, expected_exit_codes: [0] } }], verification: [] }
  const session = {
    id: 'ses-applied', project_path: '/workspace/project', state: 'applied', execution_mode: 'protected', automation_mode: 'auto', created_at: '2026-09-16T22:00:00Z',
    context: { id: 'ctx', manifest: { id: 'ctx', project_root: '/workspace/project', sha256: 'sha', files: [], excluded: [], text_truncated: false } },
    last_main_request_summary: 'Resumo final',
    last_host_applied_at: '2026-09-16T22:10:00Z',
    last_applied_changes: [{ plan, execution: { plan_id: 'p-applied', success: true, started_at: '', completed_at: '', commands: [] }, verified_at: '2026-09-16T22:10:00Z' }],
  } satisfies Session
  const projected = appliedChangePresentationItems(session)
  const priorUser: ChatItem = { id: 'prior-user', role: 'user', text: 'Corrija o chat', createdAt: '2026-09-16T22:00:00Z', iteration: { id: 'iter-applied', requestId: 'r-applied', phase: 'outbound', artifacts: [] } }
  const reviewNotice: ChatItem = { id: 'review', role: 'harness', source: 'wharness', presentation: 'notice', text: 'Revisão final em curso', createdAt: '2026-09-16T22:10:30Z' }
  const transientResult: ChatItem = { id: 'transient-result', role: 'harness', source: 'chatgpt', presentation: 'message', text: 'Resultado transitório', meta: 'AUTO · Host aplicado', createdAt: '2026-09-16T22:10:45Z', iteration: { id: 'iter-result', requestId: 'r-applied', phase: 'result', artifacts: ['result'] } }
  const nextUser: ChatItem = { id: 'next-user', role: 'user', text: 'Novo pedido', createdAt: '2026-09-16T22:11:00Z' }

  const merged = mergeAppliedChangePresentationItems([priorUser, reviewNotice, transientResult, nextUser], projected)

  expect(merged.map((item) => item.id)).toEqual(['prior-user', 'review', projected[0].id, projected[1].id, 'next-user'])
  expect(merged.some((item) => item.id === transientResult.id)).toBe(false)
  expect(projected[1].change?.requestId).toBe('r-applied')
})
