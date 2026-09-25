import { describe, expect, it } from 'vitest'
import type { ExecutionPlan } from '../types'
import type { ExecutionSubtaskGroup } from './executionTimeline'
import { activityExportFilename, buildMainExecutionExport, buildMainPlanExport, buildSubexecutionExport, buildSubplanExport } from './activityExport'
import type { ExportTraceMetadata } from './exportMetadata'

const plan: ExecutionPlan = {
  protocol: 'harness.execution/v2', plan_id: 'plan_123', request_id: 'req_123', status: 'ready', summary: 'Compactar histórico',
  document: 'Detalhes do plano.', risk: 'medium', requires_approval: false, operations: [], verification: [],
}


const metadata: ExportTraceMetadata = {
  schema: 'wharnex.export-metadata/v1', created_at: '2026-09-25T09:47:55.822Z', export_kind: 'plan',
  wharnex_version: 'v1.3.17.1', project_version: 'v4.5.6.7', project_path: '/workspace/demo', session_id: 'ses_1', chat_id: 'chat_1',
  root_request_id: 'req_root', request_id: 'req_123', plan_id: 'plan_123', context_id: 'ctx_1', context_sha256: 'abc123',
}

const group: ExecutionSubtaskGroup = {
  id: 'req_123:standard:0', requestId: 'req_123', rootRequestId: 'req_root', iterationKind: 'standard', overview: 'success', updatedAt: '2026-09-22T00:00:00Z',
  entries: [{ id: 'evt-1', kind: 'command', title: 'npm test', detail: 'services/frontend', badge: 'OK', tone: 'ok', timestamp: '2026-09-22T00:00:00Z', running: false, output: '19 passed', outputSegments: [{ stream: 'stdout', text: '19 passed' }], rationale: 'Validar a UI.', requestId: 'req_123', rootRequestId: 'req_root', iterationKind: 'standard', lifecycleState: 'success' }],
}

describe('activity exports', () => {
  it('exports a complete Main Request plan and each subplan', () => {
    const item = { label: 'Aplicado no host', timestamp: '2026-09-22T00:00:00Z', plan }
    const main = buildMainPlanExport('req_root', [item], metadata)
    const sub = buildSubplanExport(item, 1, 'req_root', metadata)
    expect(main).toContain('# Plano · Main Request')
    expect(main).toContain('Compactar histórico')
    expect(main).toContain('Versão do Wharnex: v1.3.17.1')
    expect(main).toContain('Versão do projeto: v4.5.6.7')
    expect(main).toContain('Data de criação: 2026-09-25T09:47:55.822Z')
    expect(main).toContain('"plan_id": "plan_123"')
    expect(sub).toContain('# Subplano 01')
    expect(sub).toContain('`req_root`')
  })

  it('exports Main Request execution and a single normalized subexecution', () => {
    const main = buildMainExecutionExport('req_root', group.updatedAt, [group], { ...metadata, export_kind: 'execution' })
    const sub = buildSubexecutionExport(group, 1, { ...metadata, export_kind: 'subexecution' })
    expect(main).toContain('# Execução · Main Request')
    expect(main).toContain('Subexecuções: 1')
    expect(main).toContain('19 passed')
    expect(main).toContain('Tipo de exportação: execution')
    expect(sub).toContain('# Subexecução 01')
    expect(sub).toContain('Validar a UI.')
  })

  it('creates filesystem-safe descriptive Markdown filenames', () => {
    expect(activityExportFilename('subplano', 'plan_abc/def:ghi')).toBe('subplano-abc-def-ghi.md')
    expect(activityExportFilename('execucao', 'req_20260922T001905_foo')).toBe('execucao-20260922T001905_foo.md')
  })
})
