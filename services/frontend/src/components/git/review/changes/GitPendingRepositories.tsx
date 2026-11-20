import { GitUnpushedSection } from '../../history/GitUnpushedSection'
import { api } from '../../../../lib/transport/http/api'
import { currentBranch, repositoryLabel, repositoryRemote, type GitRepositoryOverviewEntry as Entry } from '../../../../lib/git/workflow/gitProjectOverview'
import type { useGitOperationFlow } from '../../../../lib/git/workflow/useGitOperationFlow'
import type { GitOperationTarget } from '../GitOperationModal'
import { gitPushMessage } from './gitPushMessage'

type Flow = ReturnType<typeof useGitOperationFlow>
export function GitPendingRepositories({ session, entries, disabled, repositoryTargets, selectRepositories, reviewGitOperation, previewsForRepositories, runForRepositories, conflictMessage }: {
  session: { id: string }
  entries: Entry[]
  disabled: boolean
  repositoryTargets: GitOperationTarget[]
  selectRepositories: Flow['selectRepositories']
  reviewGitOperation: Flow['reviewGitOperation']
  previewsForRepositories: Flow['previewsForRepositories']
  runForRepositories: (paths: string[], action: (entry: Entry) => Promise<string>) => Promise<string>
  conflictMessage: (id: string, message: string) => Promise<string>
}) {
  return <div className={`flex min-h-0 min-w-0 flex-1 flex-col gap-2 ${entries.length === 1 ? 'overflow-hidden' : 'overflow-y-auto'}`}>{entries.map((entry) => {
    const entryOverview = entry.overview!
    const entryBranch = currentBranch(entryOverview)
    return <GitUnpushedSection key={entry.repository.path || '__root__'}
      sessionId={session.id} repository={entry.repository.path} repositoryLabel={entries.length > 1 ? repositoryLabel(entry) : undefined}
      activeBranch={entryBranch} remotes={entryOverview.remotes} disabled={disabled} fillContainer={entries.length === 1}
      onFullPush={async (remote, branch, setUpstream) => {
        const target = repositoryTargets.filter((item) => item.path === entry.repository.path)
        selectRepositories(
          'A publicar alterações',
          `A enviar ${branch} para ${remote}${setUpstream ? ' e a configurar o upstream' : ''}.`,
          async (paths) => runForRepositories(paths, async (selectedEntry) => {
            const selectedOverview = selectedEntry.overview!
            const selectedBranch = currentBranch(selectedOverview)
            const selectedRemote = repositoryRemote(selectedEntry, remote)
            if (!selectedRemote || !selectedBranch) throw new Error('Este repositório não tem branch/remoto disponível para push.')
            const result = await api.gitPush(session.id, selectedRemote, selectedBranch.name, !selectedBranch.has_upstream, selectedEntry.repository.path)
            if (result.conflict_id) return conflictMessage(result.conflict_id, gitPushMessage(result.outcome, result.integrated, result.conflict_id))
            return result.detail || gitPushMessage(result.outcome, result.integrated, result.conflict_id)
          }),
          true,
          target,
          (paths) => previewsForRepositories(paths, async (selectedEntry) => {
            const selectedBranch = currentBranch(selectedEntry.overview)
            const selectedRemote = repositoryRemote(selectedEntry, remote)
            if (!selectedRemote || !selectedBranch) throw new Error('Este repositório não tem branch/remoto disponível para push.')
            return api.gitPreview(session.id, { operation: 'push', repository: selectedEntry.repository.path, remote: selectedRemote, branch: selectedBranch.name })
          }),
        )
      }}
      onSelectedPush={async (commitSHAs) => {
        const branch = currentBranch(entry.overview)
        if (!branch?.upstream) throw new Error('Este repositório não tem upstream disponível para push seletivo.')
        const [remote, ...branchParts] = branch.upstream.split('/')
        const remoteBranch = branchParts.join('/')
        await reviewGitOperation(
          'A publicar commits selecionados',
          `A enviar ${commitSHAs.length} commit(s) para o upstream de ${repositoryLabel(entry)}.`,
          async () => [await api.gitPreview(session.id, { operation: 'push', repository: entry.repository.path, remote, branch: remoteBranch, commit_shas: commitSHAs })],
          async () => {
            const result = await api.gitPushSelected(session.id, commitSHAs, entry.repository.path)
            return result.conflict_id ? conflictMessage(result.conflict_id, gitPushMessage(result.outcome, result.integrated, result.conflict_id)) : gitPushMessage(result.outcome, result.integrated, result.conflict_id)
          },
        )
      }}
    />
          })}</div>
}
