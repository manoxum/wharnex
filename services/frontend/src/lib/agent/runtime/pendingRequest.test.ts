import { describe, expect, it } from 'vitest'
import type { Session } from '../../../types'
import { activePendingRequestId, pendingRequestRecoveryPrompt, sessionOwnsRequest } from './pendingRequest'

const base = {
  id: 'ses', project_path: '/tmp/project', execution_mode: 'protected', automation_mode: 'auto', chat_transport_mode: 'scraper',
  state: 'awaiting_plan', created_at: '', context: { id: 'ctx', manifest: { id: 'm', project_root: '/tmp/project', sha256: 'sha', files: [], excluded: [], text_truncated: false } },
} as Session

describe('activePendingRequestId', () => {
  it('uses one consistent priority for legacy overlapping requests', () => {
    const session = { ...base, last_request_id: 'req-main', pending_manual_request_ids: ['req-main', 'req-knowledge'], pending_knowledge_review_request_id: 'req-knowledge', last_manual_prompt: 'knowledge prompt' }
    expect(activePendingRequestId(session)).toBe('req-knowledge')
    expect(pendingRequestRecoveryPrompt(session, 'req-knowledge')).toBe('knowledge prompt')
    expect(pendingRequestRecoveryPrompt(session, 'req-main')).toBe('')
  })

  it('prefers an active conflict capsule and otherwise the latest request', () => {
    expect(activePendingRequestId({ ...base, last_request_id: 'req-main', pending_manual_request_ids: ['req-main', 'req-conflict'], integration_conflict: { id: 'conflict', request_id: 'req-conflict', original_plan_ids: [], paths: [], details: [], created_at: '' } })).toBe('req-conflict')
    expect(activePendingRequestId({ ...base, last_request_id: 'req-b', pending_manual_request_ids: ['req-a', 'req-b'] })).toBe('req-b')
  })
})

describe('sessionOwnsRequest', () => {
  it('keeps an already accepted request routable for idempotent bundle acknowledgement', () => {
    const accepted = {
      ...base,
      state: 'planned',
      last_request_id: 'req-accepted',
      pending_manual_request_ids: [],
      request_lineages: { 'req-accepted': { request_id: 'req-accepted', root_request_id: 'req-accepted', kind: 'standard', created_at: '' } },
    } as Session
    expect(sessionOwnsRequest(accepted, 'req-accepted')).toBe(true)
    expect(sessionOwnsRequest(accepted, 'req-other')).toBe(false)
  })
})
