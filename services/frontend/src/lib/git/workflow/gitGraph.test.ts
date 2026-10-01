import { describe, expect, it } from 'vitest'
import type { GitCommit } from '../../../types'
import { buildGitGraphRows } from './gitGraph'

function commit(sha: string, parents: string[] = []): GitCommit {
  return {
    sha,
    short_sha: sha,
    subject: sha,
    author_name: 'Dev',
    author_email: 'dev@example.test',
    committed_at: '2026-09-16T00:00:00Z',
    parents,
    wharnex: false,
    merge: parents.length > 1,
    pushed: true,
  }
}

describe('buildGitGraphRows', () => {
  it('keeps a linear history on one stable lane', () => {
    const rows = buildGitGraphRows([
      commit('c3', ['c2']),
      commit('c2', ['c1']),
      commit('c1'),
    ])

    expect(rows.map((row) => row.lane)).toEqual([0, 0, 0])
    expect(rows[0].parentLanes).toEqual([0])
    expect(rows[1].tone).toBe(rows[0].tone)
  })

  it('opens a second lane for a merge parent and collapses it when consumed', () => {
    const rows = buildGitGraphRows([
      commit('merge', ['main-parent', 'feature-parent']),
      commit('main-parent', ['base']),
      commit('feature-parent', ['base']),
      commit('base'),
    ])

    expect(rows[0].parentLanes).toEqual([0, 1])
    expect(rows[0].after.map((lane) => lane.sha)).toEqual(['main-parent', 'feature-parent'])
    expect(rows[1].after.map((lane) => lane.sha)).toEqual(['base', 'feature-parent'])
    expect(rows[2].after.map((lane) => lane.sha)).toEqual(['base'])
  })
})
