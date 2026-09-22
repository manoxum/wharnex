import { describe, expect, it, vi } from 'vitest'
import { buildDesktopTrayProjectState, dispatchDesktopTrayProjectAction, isDesktopTrayTunnelAction } from './desktopTray'
import type { Session } from '../types'

function session(overrides: Partial<Session> = {}): Session {
  return {
    id: 'session-1', project_path: '/work/alpha', execution_mode: 'protected', automation_mode: 'auto_approve', state: 'planned', created_at: '',
    context: { id: 'ctx', manifest: { id: 'm', project_root: '/work/alpha', sha256: 'abc', files: [], excluded: [], text_truncated: false } },
    plan: { protocol: 'harness.execution/v2', plan_id: 'plan-1', request_id: 'req-1', status: 'ready', summary: 'x', risk: 'low', requires_approval: false, operations: [], verification: [] },
    ...overrides,
  }
}

describe('desktop tray project state', () => {
  it('projects attention, tunnel and auto-approved plan controls into the tray', () => {
    const state = buildDesktopTrayProjectState({
      session: session(), activeChatId: 'chat-1', tunnelCount: 2, taskInFlight: false,
      attentionItems: [{ id: 'a', chatId: 'chat-1', chatTitle: 'Chat', title: 'Ready', detail: '', tone: 'warning', action: 'approve-execution' }],
    })
    expect(state).toMatchObject({ projectPath: '/work/alpha', tunnelCount: 2, attentionTotal: 1, actionable: 1, canApproveExecution: true, canControlExecution: true, planControl: 'active' })
  })

  it('does not expose plan control after that plan was applied', () => {
    const applied = { plan: { plan_id: 'plan-1' } } as NonNullable<Session['last_applied_changes']>[number]
    const state = buildDesktopTrayProjectState({ session: session({ last_applied_changes: [applied] }), activeChatId: 'chat-1', tunnelCount: 0, taskInFlight: false, attentionItems: [] })
    expect(state.canControlExecution).toBe(false)
  })
})

describe('desktop tray actions', () => {
  it('dispatches execution and worker actions through explicit handlers', async () => {
    const pauseExecution = vi.fn()
    const openWorkers = vi.fn()
    const handlers = { openNotifications: vi.fn(), openPlan: vi.fn(), openExecution: vi.fn(), approveExecution: vi.fn(), pauseExecution, resumeExecution: vi.fn(), suspendExecution: vi.fn(), continueRequest: vi.fn(), openWorkers }
    expect(await dispatchDesktopTrayProjectAction('pause-execution', handlers)).toBe(true)
    expect(await dispatchDesktopTrayProjectAction('open-workers', handlers)).toBe(true)
    expect(pauseExecution).toHaveBeenCalledTimes(1)
    expect(openWorkers).toHaveBeenCalledTimes(1)
  })

  it('recognizes tunnel actions only for a bound project', () => {
    expect(isDesktopTrayTunnelAction({ projectPath: '/work/alpha', action: 'open-tunnels' }, ['/work/alpha'])).toBe(true)
    expect(isDesktopTrayTunnelAction({ projectPath: '/work/beta', action: 'open-tunnels' }, ['/work/alpha'])).toBe(false)
  })
})
