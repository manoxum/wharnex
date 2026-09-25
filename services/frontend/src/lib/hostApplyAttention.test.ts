import { describe, expect, it } from 'vitest'
import type { Session } from '../types'
import { hostApplyAttention } from './hostApplyAttention'

describe('hostApplyAttention', () => {
  it('offers a host Apply retry for an integration-layer blocker instead of asking for new evidence', () => {
    const card = hostApplyAttention({ failure_kind: 'integration_action_required' } as Session)
    expect(card?.title).toBe('Integração a reconciliar pelo Wharnex')
    expect(card?.detail).not.toMatch(/evidência/)
  })

  it('shows the backend remedy verbatim for a blocked host worktree', () => {
    const card = hostApplyAttention({ failure_kind: 'host_working_state_blocked', last_repair_error: 'remova .git/index.lock' } as Session)
    expect(card?.detail).toBe('remova .git/index.lock')
  })

  it('ignores failures that a host Apply retry cannot clear', () => {
    expect(hostApplyAttention({ failure_kind: 'planner_guidance_required' } as Session)).toBeUndefined()
  })
})
