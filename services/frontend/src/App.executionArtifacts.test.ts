import { describe, expect, it } from 'vitest'
import { errorArtifact, executionArtifact } from './lib/executionArtifacts'
import type { Session } from './types'

function sessionWithNullCommands(): Session {
  return {
    state: 'repair_pending',
    last_request_id: 'req-test',
    last_execution: {
      plan_id: 'plan-test',
      success: false,
      started_at: '2026-09-04T10:00:00Z',
      completed_at: '2026-09-04T10:00:01Z',
      commands: null,
      error: 'sandbox preparation failed',
    },
  } as unknown as Session
}

describe('execution artifacts', () => {
  it('handles a backend execution result with null commands', () => {
    const session = sessionWithNullCommands()

    expect(executionArtifact(session)).toContain('- plan: plan-test')
    expect(errorArtifact(session)).toContain('- execution error: sandbox preparation failed')
  })
})
