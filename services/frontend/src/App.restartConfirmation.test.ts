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

  it('does not auto-open restart confirmation and routes the notification click into it', () => {
    expect(source).not.toContain('dismissedRestartKeysRef')
    expect(source).not.toMatch(/setRestartModalOpen\(true\).*restartPresentationKey/)
    expect(source).toContain("if (item.kind === 'restart-pending')")
    expect(source).toContain('await openRestartConfirmation(item.chatId)')
    expect(source).toContain('restartModalOpen && restartReports.length > 0 && <RestartConfirmation reports={restartReports}')
  })

  it('loads every ready pending session into one cumulative activation dialog', () => {
    const start = source.indexOf('async function refreshRestartReports(')
    const end = source.indexOf('\n  async function openRestartConfirmation', start)
    const body = source.slice(start, end)
    expect(body).toContain('isRestartConfirmationReady(projected)')
    expect(body).toContain('await api.getSession(chat.sessionId)')
    expect(body).toContain('buildAppliedChangeSummary(candidate)')
    expect(source).toMatch(/onRestartPending=\{\(\) => void openRestartConfirmation\(activeChatId\)\}/)
  })

  it('commits Desktop activation only after the backend accepts the detached handoff and uses canonical impacts', () => {
    const restart = source.slice(source.indexOf('async function confirmSelfRestart('), source.indexOf('\n  async function commentOnActiveTask', source.indexOf('async function confirmSelfRestart(')))
    expect(restart.indexOf('await api.restartSelfEvolution(targetReport.sessionId)')).toBeGreaterThan(-1)
    expect(restart.indexOf('updated.self_evolution_impacts')).toBeGreaterThan(-1)
    expect(restart.indexOf('await desktopBridge()?.windows.activateSelfEvolution(canonicalImpacts)')).toBeGreaterThan(restart.indexOf('await api.restartSelfEvolution(targetReport.sessionId)'))
  })
})
