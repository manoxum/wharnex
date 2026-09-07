import { describe, expect, it } from 'vitest'
import { buildChangeSummary } from './changeSummary'
import type { ExecutionPlan } from '../types'

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
