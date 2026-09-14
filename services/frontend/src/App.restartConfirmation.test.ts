import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { Session } from './types'
import { isRestartPending, restartConfirmationKey } from './lib/restartConfirmation'

const source = readFileSync(resolve(process.cwd(), 'src/App.tsx'), 'utf8')
const baseSession = {
  id: 'ses-self', project_path: '/workspace/wharness', state: 'restart_pending', execution_mode: 'protected', automation_mode: 'auto', self_evolution: true, self_evolution_activation: 'restart_pending', created_at: '2026-09-07T21:00:00.000Z',
  context: { id: 'ctx', manifest: { id: 'ctx', project_root: '/workspace/wharness', sha256: 'abc', files: [], excluded: [], text_truncated: false } },
  plan: { protocol: 'harness.execution/v1', plan_id: 'plan-self', request_id: 'req-self', status: 'ready', summary: 'self evolve', risk: 'low', requires_approval: false, operations: [], verification: [] },
} satisfies Session

describe('App restart confirmation recovery', () => {
  it('keeps restart pending visible but blocks modal presentation until knowledge review finishes', () => {
    const reviewing = { ...baseSession, pending_knowledge_review_request_id: 'req-knowledge' }
    expect(isRestartPending(reviewing)).toBe(true)
    expect(restartConfirmationKey(reviewing)).toBeUndefined()
    expect(restartConfirmationKey(baseSession)).toBe('ses-self:plan-self')
  })

  it('derives modal presentation from persisted ready state instead of only apply responses', () => {
    expect(source).toMatch(/const restartPresentationKey = activeChatOwnsSession \? restartConfirmationKey\(session\) : ''/)
    expect(source).toMatch(/if \(!dismissedRestartKeysRef\.current\.has\(restartPresentationKey\)\) setRestartModalOpen\(true\)/)
    expect(source).toContain('restartModalOpen && restartPresentationKey && <RestartConfirmation')
    expect(source).toContain('change={buildAppliedChangeSummary(session)}')
    expect(source).not.toMatch(/if \(submission\.restart_required\) setRestartModalOpen\(true\)/)
    expect(source).not.toMatch(/if \(updated\.self_evolution && updated\.state === 'restart_pending'\) setRestartModalOpen\(true\)/)
  })

  it('records Mais tarde for the current activation while keeping manual reopening available', () => {
    expect(source).toMatch(/dismissedRestartKeysRef\.current\.add\(restartPresentationKey\)/)
    expect(source).toMatch(/onLater=\{dismissRestartConfirmation\}/)
    expect(source).toMatch(/onRestartPending=\{\(\) => setRestartModalOpen\(true\)\}/)
  })
})
