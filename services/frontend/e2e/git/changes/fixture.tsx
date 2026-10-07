import { createRoot } from 'react-dom/client'
import { GitDrawer } from '../../../src/components/git/review/GitDrawer'
import { api } from '../../../src/lib/transport/http/api'
import type { GitOverview, GitRepository, Session } from '../../../src/types'
import '../../../src/styles/index.css'

const session = { id: 'git-visual-review', project_path: '/workspace/demo', state: 'ready' } as Session
const repository = (path: string): GitRepository => ({ path, label: path || 'Superprojeto', root: !path, depth: path ? 1 : 0, available: true, initialized: true, detached: false })
const inventory = [repository(''), repository('frontend'), repository('backend'), repository('docs-clean')]
function overview(path: string): GitOverview {
  const clean = path === 'docs-clean'
  return {
    project_path: '/workspace/demo', repository: path, repositories: inventory, available: true, current_branch: 'main', commit_mode: 'manual', has_identity: true, detached: false,
    branches: [{ name: 'main', current: true, commit_sha: 'head', upstream: 'origin/main', ahead: clean ? 0 : 2, behind: 0, has_upstream: true, gone: false }],
    remotes: [{ name: 'origin', url: 'https://example.test/project.git' }], tags: [], commits: [], pending: [],
    working: { clean, stageable_count: clean ? 0 : 1, files: clean ? [] : [{ path: path ? 'src/project.ts' : 'README.md', kind: 'change', status: 'modified', additions: 8, deletions: 2 }] },
  }
}
const states = new Map(inventory.map((repo) => [repo.path, overview(repo.path)]))
const calls: string[] = []
function record(call: string) {
  calls.push(call)
  document.querySelector('#calls')!.textContent = calls.join(', ')
}
api.gitOverview = async (_id, path = '') => structuredClone(states.get(path)!)
api.gitHead = async () => ({ current_branch: 'main', detached: false, commit_sha: 'head' })
api.gitUnpushed = async () => ({ branch: 'main', has_upstream: true, upstream: 'origin/main', commits: [] })
api.gitPreview = async (_id, request) => ({ operation: request.operation, repository: request.repository || '', from_label: 'main', to_label: request.operation === 'commit' ? 'Commit local' : 'origin/main', diff: 'diff --git a/src/project.ts b/src/project.ts\n--- a/src/project.ts\n+++ b/src/project.ts\n@@ -1 +1 @@\n-old\n+new\n' })
api.commitGitWorktree = async (_id, _message, paths, path = '') => {
  record(`commit:${path || 'root'}`)
  states.get(path)!.working = { clean: true, stageable_count: 0, files: [] }
  return { commit_sha: 'abcdef123456', paths }
}
api.gitPush = async (_id, remote, branch, _upstream, path = '') => {
  record(`push:${path || 'root'}`)
  states.get(path)!.branches[0].ahead = 0
  return { outcome: 'pushed', remote, branch }
}
api.getSession = async () => session

createRoot(document.getElementById('root')!).render(<main className="h-screen overflow-auto bg-whx-bg p-3 text-whx-text">
  <div id="git-owner" className="h-[calc(100vh-56px)] w-full max-w-[520px]"><GitDrawer session={session} busy={false} onClose={() => undefined}/></div>
  <output id="calls" aria-label="Operações verificadas" className="block text-xs"/>
</main>)
