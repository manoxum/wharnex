import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import type { Session } from '../../../types'
import { PlanView } from './Inspector'

afterEach(cleanup)

function pendingSession(): Session {
  return {
    id: 'session-adjustment', project_path: '/tmp/adjustment', state: 'planned',
    execution_mode: 'protected', automation_mode: 'manual', created_at: '',
    context: { id: 'context', manifest: { id: 'context', project_root: '/tmp/adjustment', sha256: '', files: [], excluded: [], text_truncated: false } },
    plan: { protocol: 'harness.execution/v2', plan_id: 'plan', request_id: 'request', status: 'ready', summary: 'Plano', risk: 'low', requires_approval: true, operations: [], verification: [] },
    policy: { allowed: true, requires_approval: true, risk: 'low', reasons: [] },
  }
}

it('does not offer adjustment after the plan failed in the sandbox, even when execution can be retried', () => {
  const session = pendingSession()
  session.state = 'failed'
  session.last_execution = { plan_id: 'plan', success: false, started_at: '', completed_at: '', commands: [], error: 'sandbox tool unavailable: docker: not found' }
  const onAdjust = vi.fn()
  render(<PlanView session={session} canExecute onAdjustExecutionPlan={onAdjust} />)
  const button = screen.getByRole('button', { name: 'Ajustar' }) as HTMLButtonElement
  expect(button.disabled).toBe(true)
  expect(button.title).toContain('Corrigir com GPT')
  fireEvent.click(button)
  expect(onAdjust).not.toHaveBeenCalled()
  expect((screen.getByRole('button', { name: 'Aceitar e executar' }) as HTMLButtonElement).disabled).toBe(false)
})

it('allows adjustment of a pending plan even if an older plan failed', () => {
  const session = pendingSession()
  session.last_execution = { plan_id: 'older-plan', success: false, started_at: '', completed_at: '', commands: [] }
  const onAdjust = vi.fn()
  render(<PlanView session={session} canExecute onAdjustExecutionPlan={onAdjust} />)
  fireEvent.click(screen.getByRole('button', { name: 'Ajustar' }))
  expect(onAdjust).toHaveBeenCalledTimes(1)
})

it.each(['awaiting_plan', 'applied', 'plan_rejected'])('disables a stale adjustment control when the session becomes %s', (state) => {
  const session = pendingSession()
  session.state = state
  render(<PlanView session={session} canExecute />)
  expect((screen.getByRole('button', { name: 'Ajustar' }) as HTMLButtonElement).disabled).toBe(true)
})

it('disables adjustment when execution starts while the plan view is open', () => {
  const session = pendingSession()
  const view = render(<PlanView session={session} canExecute />)
  expect((screen.getByRole('button', { name: 'Ajustar' }) as HTMLButtonElement).disabled).toBe(false)
  view.rerender(<PlanView session={{ ...session, interrupted_execution: { plan_id: 'plan', requested_at: '', approved: true, status: 'running' } }} canExecute />)
  expect((screen.getByRole('button', { name: 'Ajustar' }) as HTMLButtonElement).disabled).toBe(true)
})

it('keeps a completed plan unavailable even if its snapshot still says planned', () => {
  const session = pendingSession()
  session.last_execution = { plan_id: 'plan', success: true, started_at: '', completed_at: '', commands: [] }
  render(<PlanView session={session} canExecute />)
  const button = screen.getByRole('button', { name: 'Ajustar' }) as HTMLButtonElement
  expect(button.disabled).toBe(true)
  expect(button.title).toContain('já iniciou a execução')
})
