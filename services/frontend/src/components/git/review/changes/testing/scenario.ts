import { overview } from '../../testing/fixtures'
import { vi } from 'vitest'
import { api } from '../../../../../lib/transport/http/api'
import type { GitOverview, GitRepository } from '../../../../../types'

const repository = (path: string, depth: number): GitRepository => ({ path, label: path || 'Superprojeto', depth, root: !path, available: true, initialized: true, detached: false })
export let states: Map<string, GitOverview>

export function setupGitChangesScenario() {
  vi.clearAllMocks()
  const root = overview({ working: { clean: false, stageable_count: 0, files: [{ path: 'module', kind: 'submodule', status: 'modified' }] }, repositories: [repository('', 0), repository('module', 1), repository('clean', 1)] })
  const clean = overview({ working: { clean: true, stageable_count: 0, files: [] }, branches: overview().branches.map((branch) => ({ ...branch, ahead: 0 })), commits: [] })
  states = new Map([['', root], ['module', overview({ repository: 'module', working: { clean: false, stageable_count: 1, files: [{ path: 'file.ts', kind: 'change', status: 'modified' }] } })], ['clean', clean]])
  vi.mocked(api.gitOverview).mockImplementation(async (_session, path = '') => states.get(path)!)
  vi.mocked(api.gitMergeCandidates).mockResolvedValue([])
  vi.mocked(api.gitPreview).mockImplementation(async (_session, request) => ({ operation: request.operation, repository: request.repository || '', from_label: 'Antes', to_label: 'Depois', diff: 'diff --git a/file.ts b/file.ts\n--- a/file.ts\n+++ b/file.ts\n@@ -1 +1 @@\n-old\n+new\n' }))
  vi.mocked(api.commitGitWorktree).mockImplementation(async (_session, _message, paths, path = '') => {
    const state = states.get(path)!
    state.working = { clean: true, stageable_count: 0, files: [] }
    state.branches[0].commit_sha = `new-${path || 'root'}`
    return { commit_sha: 'abcdef123456', paths }
  })
  vi.mocked(api.gitPush).mockResolvedValue({ outcome: 'pushed', remote: 'origin', branch: 'main' })
}
