import { render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ExecutionPlan, HarnessEvent, Session } from '../../../types'
import { PlanHistorySurface } from './PlanHistorySurface'
import { ExecutionHistorySurface } from './ExecutionHistorySurface'

const plan = (id: string, requestId: string): ExecutionPlan => ({
  protocol: 'harness.execution/v1', plan_id: id, request_id: requestId, status: 'ready', summary: `Plano ${id}`,
  risk: 'low', requires_approval: false, operations: [], verification: [],
})
const recorded = (type: string, data: Record<string, unknown>, timestamp: string): HarnessEvent => ({ id: `${type}-${timestamp}`, session_id: 'ses-a', type, timestamp, data })
const session = (): Session => ({
  id: 'ses-a', project_path: '/workspace/app', state: 'verified', execution_mode: 'protected', automation_mode: 'auto', created_at: '2026-09-05T09:00:00Z',
  context: { id: 'ctx', manifest: { id: 'ctx', project_root: '/workspace/app', sha256: 'abc', files: [], excluded: [], text_truncated: false } },
  request_lineages: {
    'req-old': { request_id: 'req-old', root_request_id: 'req-old', kind: 'standard', created_at: '2026-09-05T10:00:00Z' },
    'req-new': { request_id: 'req-new', root_request_id: 'req-new', kind: 'standard', created_at: '2026-09-05T11:00:00Z' },
    'req-new-fix': { request_id: 'req-new-fix', root_request_id: 'req-new', parent_request_id: 'req-new', kind: 'repair', created_at: '2026-09-05T11:05:00Z' },
  },
})
const blockRoots = (container: HTMLElement) => [...container.querySelectorAll('.main-request-block > summary .history-summary-context code')].map((node) => node.getAttribute('title'))

// Plans and executions read like the chat transcript: the latest activity is
// at the bottom, and the reader lands there.
describe('durable history ordering', () => {
  const scrollIntoView = vi.fn()
  beforeEach(() => { Element.prototype.scrollIntoView = scrollIntoView })
  afterEach(() => { scrollIntoView.mockReset() })

  it('lists plan Main Requests and their subplans oldest first and opens the newest', () => {
    const events = [
      recorded('plan.recorded', { plan_id: 'p3', request_id: 'req-new-fix', plan: plan('p3', 'req-new-fix') }, '2026-09-05T11:05:00Z'),
      recorded('plan.recorded', { plan_id: 'p1', request_id: 'req-old', plan: plan('p1', 'req-old') }, '2026-09-05T10:00:00Z'),
      recorded('plan.recorded', { plan_id: 'p2', request_id: 'req-new', plan: plan('p2', 'req-new') }, '2026-09-05T11:00:00Z'),
    ]
    const { container } = render(<PlanHistorySurface session={session()} events={events} loading={false} error="" currentPlan={null} renderHistoricalPlan={() => null}/>)
    expect(blockRoots(container)).toEqual(['req-old', 'req-new'])
    const blocks = container.querySelectorAll<HTMLDetailsElement>('.main-request-block')
    expect([...blocks].map((block) => block.open)).toEqual([false, true])
    const rows = [...blocks[1].querySelectorAll('.main-request-plan-summary')].map((row) => row.querySelector('strong')?.textContent)
    expect(rows).toEqual(['Plano p2', 'Plano p3'])
    expect(blocks[1].querySelectorAll('.plan-history-sequence')[0].textContent).toBe('01')
    expect(blocks[1].querySelector('.main-request-summary strong')?.textContent).toBe('Plano p3')
    expect(scrollIntoView).toHaveBeenCalledWith({ block: 'end' })
  })

  it('lists execution Main Requests oldest first and opens the newest', () => {
    const events = [
      recorded('execution.started', { plan_id: 'p1', request_id: 'req-old', root_request_id: 'req-old' }, '2026-09-05T10:00:00Z'),
      recorded('execution.started', { plan_id: 'p2', request_id: 'req-new', root_request_id: 'req-new' }, '2026-09-05T11:00:00Z'),
    ]
    const { container } = render(<ExecutionHistorySurface session={session()} events={events} loading={false} error=""/>)
    expect(blockRoots(container)).toEqual(['req-old', 'req-new'])
    expect([...container.querySelectorAll<HTMLDetailsElement>('.main-request-block')].map((block) => block.open)).toEqual([false, true])
    expect(scrollIntoView).toHaveBeenCalledWith({ block: 'end' })
  })
})
