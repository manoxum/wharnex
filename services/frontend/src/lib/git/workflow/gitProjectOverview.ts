import type { GitBranch, GitOverview, GitRepository } from '../../../types'
import { api } from '../../transport/http/api'

export type GitRepositoryOverviewEntry = {
  repository: GitRepository
  overview?: GitOverview
  error?: string
}

export async function loadGitProjectOverviews(sessionId: string): Promise<{ root: GitOverview; entries: GitRepositoryOverviewEntry[] }> {
  const root = await api.gitOverview(sessionId, '')
  const repositories = root.repositories.length ? root.repositories : [rootRepository(root)]
  const entries = await Promise.all(repositories.map(async (repository) => {
    if (!repository.available) return { repository } satisfies GitRepositoryOverviewEntry
    if (repository.root || repository.path === '') return { repository, overview: root } satisfies GitRepositoryOverviewEntry
    try {
      return { repository, overview: await api.gitOverview(sessionId, repository.path) } satisfies GitRepositoryOverviewEntry
    } catch (cause) {
      return { repository, error: cause instanceof Error ? cause.message : String(cause) } satisfies GitRepositoryOverviewEntry
    }
  }))
  return { root, entries }
}

function rootRepository(overview: GitOverview): GitRepository {
  return {
    path: '', label: 'Superprojeto', depth: 0, root: true,
    initialized: overview.available, available: overview.available, unavailable: overview.unavailable,
    current_branch: overview.current_branch, detached: overview.detached,
  }
}

export function currentBranch(overview?: GitOverview): GitBranch | undefined {
  return overview?.branches.find((branch) => !branch.remote && branch.current)
}

export function repositoryLabel(entry: GitRepositoryOverviewEntry): string {
  return entry.repository.root ? 'Superprojeto' : entry.repository.label
}

export function repositoryRemote(entry: GitRepositoryOverviewEntry, preferred = ''): string {
  const overview = entry.overview
  if (!overview) return ''
  if (preferred && overview.remotes.some((remote) => remote.name === preferred)) return preferred
  return currentBranch(overview)?.upstream?.split('/')[0] || overview.remotes[0]?.name || ''
}

export function repositoryOutgoing(entry: GitRepositoryOverviewEntry): number {
  const overview = entry.overview
  if (!overview) return 0
  const branch = currentBranch(overview)
  return branch?.has_upstream && !branch.gone ? branch.ahead : overview.commits.filter((commit) => !commit.pushed).length
}
