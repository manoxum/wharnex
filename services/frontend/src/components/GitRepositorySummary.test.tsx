import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { GitOverview, GitRepository } from '../types'
import type { GitRepositoryOverviewEntry } from '../lib/gitProjectOverview'
import { GitRepositorySummary } from './GitRepositorySummary'

function overview(repository: string, upstream = 'origin/main'): GitOverview {
  return {
    project_path: '/workspace', project_version: 'v1.2.3.4', available: true, commit_mode: 'auto', detached: false, has_identity: true,
    repository, repositories: [], current_branch: 'main',
    branches: [{ name: 'main', current: true, commit_sha: 'a1', subject: 'main', upstream, ahead: 1, behind: 0, has_upstream: Boolean(upstream), gone: false }],
    remotes: upstream ? [{ name: 'origin', url: 'https://example.invalid/repo.git' }] : [], tags: [], commits: [], pending: [], working: { clean: true, stageable_count: 0, files: [] },
  }
}

function entry(repository: GitRepository, repoOverview?: GitOverview): GitRepositoryOverviewEntry {
  return { repository, overview: repoOverview }
}

describe('GitRepositorySummary', () => {
  it('keeps the repository inventory collapsed until the user asks for detail', () => {
    const entries = [
      entry({ path: '', label: 'superproject', depth: 0, root: true, initialized: true, available: true, current_branch: 'main', detached: false }, overview('')),
      entry({ path: 'services/core', label: 'services/core', depth: 1, root: false, initialized: true, available: true, current_branch: 'main', detached: false }, overview('services/core')),
    ]
    render(<GitRepositorySummary entries={entries}/>)

    const toggle = screen.getByRole('button', { name: /Repositórios do projeto/i })
    const list = screen.getByRole('list', { hidden: true }) as HTMLUListElement
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
    expect(list.hidden).toBe(true)
    expect(screen.getByText('2 ligados')).toBeTruthy()

    fireEvent.click(toggle)
    expect(toggle.getAttribute('aria-expanded')).toBe('true')
    expect(list.hidden).toBe(false)
    expect(screen.getByText('services/core')).toBeTruthy()
  })
})
