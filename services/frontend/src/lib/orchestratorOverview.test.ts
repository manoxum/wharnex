import { describe, expect, it } from 'vitest'
import {
  combineOrchestratorTasks,
  createOrchestratorApi,
  emptyOrchestratorTaskCounts,
  invalidateChangedOrchestratorTerminalPages,
  mergeOrchestratorTaskPages,
  reconcileOrchestratorTerminalPages,
  normalizeOrchestratorOverview,
} from './orchestratorApi'
import type { OrchestratorOverview, OrchestratorTask, OrchestratorTaskPage } from '../types'

function task(id: string, status: OrchestratorTask['status'] = 'READY'): OrchestratorTask {
  return {
    id,
    project_path: '/project',
    title: id,
    status,
    condition: 'none',
    priority: 'normal',
    parallelizable: false,
    created_at: '2026-09-28T00:00:00Z',
    updated_at: '2026-09-28T00:00:00Z',
  }
}

describe('orchestrator frontend contract', () => {
  it('normalizes an active-only overview without losing terminal totals', () => {
    const raw = {
      plans: null,
      tasks: [{ ...task('ready-1'), depends_on: null, allowed_transitions: ['DOING', 'INVALID'] }],
      task_counts: { READY: 1, COMPLETE: 7, ARCHIVED: 2 },
      planning_requests: null,
      mutation_slots: 1,
      mutation_slots_used: 0,
    } as unknown as OrchestratorOverview

    const overview = normalizeOrchestratorOverview(raw)
    expect(overview.plans).toEqual([])
    expect(overview.planning_requests).toEqual([])
    expect(overview.tasks[0].depends_on).toEqual([])
    expect(overview.tasks[0].allowed_transitions).toEqual(['DOING'])
    expect(overview.task_counts).toMatchObject({ READY: 1, COMPLETE: 7, ARCHIVED: 2, FAILED: 0 })
  })

  it('keeps durable completion evidence while preserving the typed state', () => {
    const complete = normalizeOrchestratorOverview({
      plans: [],
      tasks: [task('done', 'COMPLETE')],
      task_counts: {} as OrchestratorOverview['task_counts'],
      planning_requests: [],
      mutation_slots: 1,
      mutation_slots_used: 0,
    }).tasks[0]

    expect(complete.status).toBe('COMPLETE')
    expect(complete.was_completed).toBe(true)
  })

  it('merges paged terminal history without duplicate cards', () => {
    const first: OrchestratorTaskPage = {
      tasks: [task('done-1', 'COMPLETE'), task('shared', 'COMPLETE')],
      total: 3,
      next_cursor: 'cursor-2',
      has_more: true,
    }
    const second: OrchestratorTaskPage = {
      tasks: [{ ...task('shared', 'COMPLETE'), title: 'updated' }, task('done-3', 'COMPLETE')],
      total: 3,
      has_more: false,
    }

    const merged = mergeOrchestratorTaskPages(first, second)
    const combined = combineOrchestratorTasks([task('active')], { COMPLETE: merged })
    expect(merged.tasks.map((item) => item.id)).toEqual(['done-1', 'shared', 'done-3'])
    expect(merged.tasks.find((item) => item.id === 'shared')?.title).toBe('updated')
    expect(merged.total).toBe(3)
    expect(merged.has_more).toBe(false)
    expect(new Set(combined.map((item) => item.id)).size).toBe(combined.length)
  })

  it('invalidates only terminal caches whose totals changed', () => {
    const complete = { tasks: [task('done', 'COMPLETE')], total: 1, has_more: false }
    const archived = { tasks: [task('old', 'ARCHIVED')], total: 1, has_more: false }
    const counts = emptyOrchestratorTaskCounts()
    counts.COMPLETE = 2
    counts.ARCHIVED = 1

    const invalidated = invalidateChangedOrchestratorTerminalPages({ COMPLETE: complete, ARCHIVED: archived }, counts)
    expect(invalidated.COMPLETE).toBeUndefined()
    expect(invalidated.ARCHIVED).toBe(archived)

    const reconciled = reconcileOrchestratorTerminalPages({ COMPLETE: complete, ARCHIVED: archived }, task('done', 'ARCHIVED'))
    expect(reconciled.COMPLETE?.tasks).toEqual([])
    expect(reconciled.ARCHIVED?.tasks.map((item) => item.id)).toEqual(['done', 'old'])
  })

  it('builds focused pagination/search and transition requests', async () => {
    const calls: Array<{ path: string; init?: RequestInit }> = []
    async function requester<T>(path: string, init?: RequestInit): Promise<T> {
      calls.push({ path, init })
      if (path.includes('/transition')) return task('done', 'ARCHIVED') as T
      return { tasks: [], total: 0, has_more: false } as T
    }
    const client = createOrchestratorApi(requester)

    await client.orchestratorTasks('session-1', { status: 'COMPLETE', q: 'needle task', limit: 20, cursor: 'next' })
    const transitioned = await client.transitionOrchestratorTask('session-1', 'task/1', 'ARCHIVED')

    expect(calls[0].path).toBe('/api/sessions/session-1/orchestrator/tasks?status=COMPLETE&q=needle+task&limit=20&cursor=next')
    expect(calls[1]).toMatchObject({
      path: '/api/sessions/session-1/orchestrator/tasks/task%2F1/transition',
      init: { method: 'POST', body: JSON.stringify({ status: 'ARCHIVED' }) },
    })
    expect(transitioned.status).toBe('ARCHIVED')
  })
})
