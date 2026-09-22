import { describe, expect, it } from 'vitest'
import type { ExecutionPlan } from '../types'
import type { ExecutionSubtaskGroup } from './executionTimeline'
import { activityExportFilename, buildMainExecutionExport, buildMainPlanExport, buildSubexecutionExport, buildSubplanExport } from './activityExport'

const plan: ExecutionPlan = {
  protocol: 'harness.execution/v2', plan_id: 'plan_123', request_id: 'req_123', status: 'ready', summary: 'Compactar histórico',
  document: 'Detalhes do plano.', risk: 'medium', requires_approval: false, operations: [], verification: [],
}

const group: ExecutionSubtaskGroup = {
  id: 'req_123:standard:0', requestId: 'req_123', rootRequestId: 'req_root', iterationKind: 'standard', overview: 'success', updatedAt: '2026-09-22T00:00:00Z',
  entries: [{ id: 'evt-1', kind: 'command', title: 'npm test', detail: 'services/frontend', badge: 'OK', tone: 'ok', timestamp: '2026-09-22T00:00:00Z', running: false, output: '19 passed', outputSegments: [{ stream: 'stdout', text: '19 passed' }], rationale: 'Validar a UI.', requestId: 'req_123', rootRequestId: 'req_root', iterationKind: 'standard', lifecycleState: 'success' }],
}

describe('activity exports', () => {
  it('exports a complete Main Request plan and each subplan', () => {
    const item = { label: 'Aplicado no host', timestamp: '2026-09-22T00:00:00Z', plan }
    const main = buildMainPlanExport('req_root', [item])
    const sub = buildSubplanExport(item, 1, 'req_root')
    expect(main).toContain('# Plano · Main Request')
    expect(main).toContain('Compactar histórico')
    expect(main).toContain('"plan_id": "plan_123"')
    expect(sub).toContain('# Subplano 01')
    expect(sub).toContain('`req_root`')
  })

  it('exports Main Request execution and a single normalized subexecution', () => {
    const main = buildMainExecutionExport('req_root', group.updatedAt, [group])
    const sub = buildSubexecutionExport(group, 1)
    expect(main).toContain('# Execução · Main Request')
    expect(main).toContain('Subexecuções: 1')
    expect(main).toContain('19 passed')
    expect(sub).toContain('# Subexecução 01')
    expect(sub).toContain('Validar a UI.')
  })

  it('creates filesystem-safe descriptive Markdown filenames', () => {
    expect(activityExportFilename('subplano', 'plan_abc/def:ghi')).toBe('subplano-abc-def-ghi.md')
    expect(activityExportFilename('execucao', 'req_20260922T001905_foo')).toBe('execucao-20260922T001905_foo.md')
  })
})
