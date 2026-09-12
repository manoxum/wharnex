import { describe, expect, it } from 'vitest'
import { normalizeOrchestratorOverview } from './api'
import type { OrchestratorOverview } from '../types'

// Regression: the workspace crashed with
//   Uncaught TypeError: Cannot read properties of null (reading 'filter')
// because Go marshalled an empty orchestrator collection as null while the
// overview views call .filter on it directly. The backend now allocates those
// slices; this covers the client-side safety net that keeps a null from any
// backend version from taking down the whole render.
describe('normalizeOrchestratorOverview', () => {
  it('coerces null collections to empty arrays', () => {
    const raw = { plans: null, tasks: null, mutation_slots: 1, mutation_slots_used: 0 } as unknown as OrchestratorOverview
    const overview = normalizeOrchestratorOverview(raw)
    expect(overview.plans).toEqual([])
    expect(overview.tasks).toEqual([])
    expect(overview.planning_requests).toEqual([])
    expect(() => overview.tasks.filter((task) => task.status === 'DOING')).not.toThrow()
    expect(overview.mutation_slots).toBe(1)
  })

  it('coerces a task with null dependencies', () => {
    const raw = { plans: [], tasks: [{ id: 't1', depends_on: null }], mutation_slots: 1, mutation_slots_used: 0 } as unknown as OrchestratorOverview
    expect(normalizeOrchestratorOverview(raw).tasks[0].depends_on).toEqual([])
  })

  it('leaves a well-formed overview untouched', () => {
    const raw = { plans: [], tasks: [{ id: 't1', depends_on: ['t0'] }], planning_requests: [{ request_id: 'orp_1' }], mutation_slots: 2, mutation_slots_used: 1 } as unknown as OrchestratorOverview
    const overview = normalizeOrchestratorOverview(raw)
    expect(overview.tasks[0].depends_on).toEqual(['t0'])
    expect(overview.planning_requests).toHaveLength(1)
    expect(overview.mutation_slots_used).toBe(1)
  })
})
