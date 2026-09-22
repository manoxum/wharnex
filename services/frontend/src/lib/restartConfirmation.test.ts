import { describe, expect, it } from 'vitest'
import type { Session } from '../types'
import { isRestartPending, mergeRestartImpacts, restartConfirmationKey } from './restartConfirmation'

function session(overrides: Partial<Session> = {}): Session {
  return {
    id: 'ses-1',
    project_path: '/tmp/project',
    execution_mode: 'protected',
    automation_mode: 'auto',
    self_evolution: true,
    self_evolution_activation: 'restart_pending',
    state: 'restart_pending',
    created_at: '2026-09-05T00:00:00Z',
    context: { id: 'ctx-1', manifest: { id: 'ctx-1', project_root: '/tmp/project', sha256: 'abc', files: [], excluded: [], text_truncated: false } },
    ...overrides,
  }
}

describe('restart confirmation state', () => {
  it('recognizes persisted restart-pending sessions and the legacy state fallback', () => {
    expect(isRestartPending(session())).toBe(true)
    expect(isRestartPending(session({ self_evolution_activation: undefined }))).toBe(true)
    expect(isRestartPending(session({ self_evolution: false }))).toBe(false)
    expect(isRestartPending(session({ self_evolution_activation: 'restart_scheduled' }))).toBe(false)
  })

  it('uses the latest applied plan as the presentation identity', () => {
    const value = session({
      last_applied_changes: [
        { plan: { plan_id: 'plan-1' } } as NonNullable<Session['last_applied_changes']>[number],
        { plan: { plan_id: 'plan-2' } } as NonNullable<Session['last_applied_changes']>[number],
      ],
    })
    expect(restartConfirmationKey(value)).toBe('ses-1:plan-2')
  })

  it('changes identity when a pending self-evolution batch is extended', () => {
    const first = session({ last_applied_changes: [{ plan: { plan_id: 'plan-1' } } as NonNullable<Session['last_applied_changes']>[number]] })
    const second = session({ last_applied_changes: [{ plan: { plan_id: 'plan-1' } } as NonNullable<Session['last_applied_changes']>[number], { plan: { plan_id: 'plan-2' } } as NonNullable<Session['last_applied_changes']>[number]] })
    expect(restartConfirmationKey(first)).not.toBe(restartConfirmationKey(second))
  })

  it('falls back to the active plan and then the session while restart remains pending', () => {
    expect(restartConfirmationKey(session({ plan: { plan_id: 'plan-current' } as Session['plan'] }))).toBe('ses-1:plan-current')
    expect(restartConfirmationKey(session())).toBe('ses-1:pending')
    expect(restartConfirmationKey(session({ self_evolution_activation: 'restart_scheduled' }))).toBeUndefined()
  })


  it('unions cumulative service impacts in deterministic activation order', () => {
    expect(mergeRestartImpacts([
      { sessionId: 'ses-1', chatId: 'chat-1', chatTitle: 'Frontend', impacts: ['frontend'] },
      { sessionId: 'ses-2', chatId: 'chat-2', chatTitle: 'Desktop', impacts: ['desktop', 'frontend'] },
      { sessionId: 'ses-3', chatId: 'chat-3', chatTitle: 'Backend', impacts: ['backend'] },
    ])).toEqual(['backend', 'frontend', 'desktop'])
  })
})
