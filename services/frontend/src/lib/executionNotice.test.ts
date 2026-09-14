import { describe, expect, it } from 'vitest'
import { executionStartedNotice } from './executionNotice'

describe('executionStartedNotice', () => {
  it('creates a stable visible start notice for one execution event', () => {
    expect(executionStartedNotice({ id: 'evt-7', data: { plan_id: 'plan-4', mode: 'protected' } })).toMatchObject({
      id: 'execution-started:evt-7',
      presentation: 'notice',
      source: 'wharness',
      text: 'Execução iniciada na sandbox protegida.',
      meta: 'Execução iniciada · plan-4',
    })
  })
})
