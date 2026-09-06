import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const source = readFileSync(resolve(process.cwd(), 'src/App.tsx'), 'utf8')

describe('App interrupted-execution recovery', () => {
  it('drops a recovery card permanently when its session no longer exists on the backend, instead of leaving it stuck', () => {
    const start = source.indexOf('async function resolveInterruptedExecution')
    const end = source.indexOf('\n\n\n  async function transportPlannerContinuation', start)
    const body = source.slice(start, end)
    // Both the primary action failing with 404 and the follow-up refresh
    // failing with 404 must remove the candidate — a session that is
    // genuinely gone can never succeed at "continue" or "discard" again.
    expect(body).toMatch(/resolveError instanceof APIError && resolveError\.status === 404/)
    expect(body).toMatch(/refreshError instanceof APIError && refreshError\.status === 404/)
    const occurrences = body.match(/current\.filter\(\(candidate\) => candidate\.session\.id !== target\.session\.id\)/g) || []
    expect(occurrences.length).toBeGreaterThanOrEqual(2)
  })
})
