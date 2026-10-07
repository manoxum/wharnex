import { describe, expect, it } from 'vitest'
import type { GitOverview } from '../../../../types'
import type { GitRepositoryOverviewEntry as Entry } from '../../../../lib/git/workflow/gitProjectOverview'
import { childrenFirst, commitRepositories, plannedCommitPaths, visibleChangesRepositories, commitUnavailableReason, pushUnavailableReason } from './gitChangesModel'

function entry(path: string, patch: Partial<GitOverview> = {}): Entry {
  return {
    repository: { path, label: path || 'Superprojeto', depth: path ? path.split('/').length : 0, root: !path, initialized: true, available: true, detached: false },
    overview: {
      project_path: '/project', available: true, repository: path, repositories: [], commit_mode: 'manual', has_identity: true, detached: false,
      branches: [{ name: 'main', current: true, commit_sha: 'head', upstream: 'origin/main', ahead: 0, behind: 0, has_upstream: true, gone: false }],
      remotes: [{ name: 'origin', url: 'https://example.test/repo.git' }], tags: [], commits: [], pending: [], working: { clean: true, stageable_count: 0, files: [] }, ...patch,
    },
  }
}

const dirty = { clean: false, stageable_count: 1, files: [{ path: 'file.ts', kind: 'change' as const, status: 'modified' as const }] }

describe('Git changes repository model', () => {
  it('retains the root and only dirty or outgoing submodules', () => {
    const root = entry('')
    const clean = entry('clean')
    const changed = entry('changed', { working: dirty })
    const outgoing = entry('outgoing')
    outgoing.overview!.branches[0].ahead = 2
    const incoming = entry('incoming')
    incoming.overview!.branches[0].behind = 2
    expect(visibleChangesRepositories([root, clean, changed, outgoing, incoming])).toEqual([root, changed, outgoing])
  })

  it('keeps local-only and lost-upstream commits visible', () => {
    const local = entry('local')
    local.overview!.branches[0].has_upstream = false
    local.overview!.commits = [{ sha: 'a', short_sha: 'a', subject: 'local work', author_name: 'Dev', author_email: 'dev@example.test', committed_at: '', parents: [], wharnex: false, merge: false, pushed: false }]
    const gone = entry('gone', { commits: local.overview!.commits })
    gone.overview!.branches[0].gone = true
    expect(visibleChangesRepositories([local, gone, entry('clean')])).toEqual([local, gone])
  })

  it('plans nested commits before parents and includes the direct gitlink update only', () => {
    const entries = [entry(''), entry('module'), entry('module/nested', { working: dirty }), entry('module-sibling')]
    const plan = commitRepositories(entries)
    expect(plan.map((item) => item.repository.path)).toEqual(['module/nested', 'module', ''])
    expect(plannedCommitPaths(plan[0], plan)).toEqual(['file.ts'])
    expect(plannedCommitPaths(plan[1], plan)).toEqual(['nested'])
    expect(plannedCommitPaths(plan[2], plan)).toEqual(['module'])
    expect(childrenFirst(entries).at(-1)?.repository.path).toBe('')
  })

  it('does not mutate inventory order', () => {
    const entries = [entry(''), entry('module', { working: dirty })]
    commitRepositories(entries)
    expect(entries.map((item) => item.repository.path)).toEqual(['', 'module'])
  })

  it('blocks the complete operation when any affected parent lacks identity', () => {
    const entries = [entry('', { has_identity: false }), entry('module', { working: dirty })]
    expect(commitUnavailableReason(commitRepositories(entries))).toContain('Superprojeto: configure user.name e user.email')
  })

  it('explains conflicts, unavailable ancestors, detached HEAD and missing remotes', () => {
    expect(commitUnavailableReason([entry('conflict', { in_progress: 'merge' })])).toContain('conflito')
    const unavailable = entry('unavailable')
    unavailable.repository.available = false
    expect(commitUnavailableReason([unavailable])).toContain('indisponível')
    expect(pushUnavailableReason([entry('detached', { detached: true })])).toContain('selecione uma branch')
    expect(pushUnavailableReason([entry('offline', { remotes: [], branches: [] })])).toContain('selecione uma branch')
    const noRemote = entry('no-remote', { remotes: [] })
    noRemote.overview!.branches[0].upstream = undefined
    expect(pushUnavailableReason([noRemote])).toContain('configure um remoto')
  })
})
