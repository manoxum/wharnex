import { describe, expect, it } from 'vitest'
import type { Session } from '../types'
import { knowledgeConsolidationPending, requestChainActive } from './requestActivity'

function session(overrides: Partial<Session> = {}): Session {
  return {
    id: 'ses', project_path: '/workspace/demo', state: 'applied', execution_mode: 'protected', automation_mode: 'auto', created_at: '',
    context: { id: 'ctx', manifest: { id: 'ctx', project_root: '/workspace/demo', sha256: 'abc', files: [], excluded: [], text_truncated: false } },
    ...overrides,
  }
}

describe('request activity', () => {
  it('keeps request-chain detection independent from knowledge maintenance', () => {
    expect(requestChainActive(session({ state: 'planned' }))).toBe(true)
    expect(requestChainActive(session({ self_evolution_activation: 'restart_scheduled' }))).toBe(true)
    expect(requestChainActive(session())).toBe(false)
  })

  it('recognizes only the pending knowledge-consolidation lineage', () => {
    const pending = session({
      last_request_id: 'req-knowledge',
      pending_manual_request_ids: ['req-knowledge'],
      request_lineages: { 'req-knowledge': { request_id: 'req-knowledge', root_request_id: 'req-knowledge', kind: 'knowledge_consolidation', created_at: '' } },
    })
    expect(knowledgeConsolidationPending(pending)).toBe(true)
    expect(knowledgeConsolidationPending({ ...pending, pending_manual_request_ids: [] })).toBe(false)
    expect(knowledgeConsolidationPending(session({ last_request_id: 'req-main', pending_manual_request_ids: ['req-main'] }))).toBe(false)
  })
})
