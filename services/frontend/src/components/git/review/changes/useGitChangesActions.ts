import { api } from '../../../../lib/transport/http/api'
import { currentBranch, repositoryLabel, repositoryOutgoing, repositoryRemote, type GitRepositoryOverviewEntry as Entry } from '../../../../lib/git/workflow/gitProjectOverview'
import { splitWorktreeKey } from '../../../../lib/git/workflow/gitWorktreeKey'
import type { useGitOperationFlow } from '../../../../lib/git/workflow/useGitOperationFlow'
import type { GitOverview, GitOperationPreview } from '../../../../types'
import { childrenFirst, commitRepositories, committablePaths, plannedCommitPaths, commitUnavailableReason, pushUnavailableReason } from './gitChangesModel'

type Flow = ReturnType<typeof useGitOperationFlow>
type Params = {
  sessionId: string
  entries: Entry[]
  selected: Set<string>
  message: string
  resetCommit: () => void
  flow: Pick<Flow, 'reviewGitOperation' | 'selectRepositories' | 'previewsForRepositories'>
  loadOverview: () => Promise<GitOverview>
  runForRepositories: (paths: string[], action: (entry: Entry) => Promise<string>) => Promise<string>
  repositoryTargets: Parameters<Flow['selectRepositories']>[4]
}

export function useGitChangesActions({ sessionId, entries, selected, message, resetCommit, flow, loadOverview, runForRepositories, repositoryTargets }: Params) {
  const commitPlan = commitRepositories(entries)
  const outgoing = childrenFirst(entries.filter((entry) => entry.repository.available && entry.overview && repositoryOutgoing(entry) > 0))
  const publishPlan = childrenFirst([...new Set([...commitPlan, ...outgoing])])
  const commitReason = commitUnavailableReason(commitPlan)
  const pushReason = pushUnavailableReason(publishPlan)

  async function commitSelected() {
    const grouped = new Map<string, string[]>()
    for (const key of selected) {
      const item = splitWorktreeKey(key)
      grouped.set(item.repository, [...(grouped.get(item.repository) || []), item.path])
    }
    flow.selectRepositories('A criar commit manual', 'Escolha em quais repositórios os ficheiros selecionados serão commitados.', async (paths) => {
      const result = await runForRepositories(paths, async (entry) => {
        const commit = await api.commitGitWorktree(sessionId, message, grouped.get(entry.repository.path) || [], entry.repository.path)
        return `Commit ${commit.commit_sha.slice(0, 8)} criado com ${commit.paths.length} ficheiro(s).`
      })
      resetCommit()
      return result
    }, false, repositoryTargets?.filter((target) => grouped.has(target.path)), (paths) => flow.previewsForRepositories(paths, (entry) => api.gitPreview(sessionId, { operation: 'commit', repository: entry.repository.path, paths: grouped.get(entry.repository.path) || [] })))
  }

  async function commitPreviews(): Promise<GitOperationPreview[]> {
    if (commitReason) throw new Error(commitReason)
    const previews: GitOperationPreview[] = []
    for (const entry of commitPlan) {
      const paths = committablePaths(entry)
      previews.push(paths.length
        ? await api.gitPreview(sessionId, { operation: 'commit', repository: entry.repository.path, paths })
        : { operation: 'commit', repository: entry.repository.path, from_label: 'Referências atuais dos submódulos', to_label: 'Referências dos novos commits dos submódulos', diff: '' })
    }
    return previews
  }

  async function commitAll() {
    let completed = 0
    try {
      for (const entry of commitPlan) {
        try {
          await api.commitGitWorktree(sessionId, message.trim(), plannedCommitPaths(entry, commitPlan), entry.repository.path)
          completed++
        } catch (error) { throw new Error(`${repositoryLabel(entry)}: ${error instanceof Error ? error.message : String(error)}. ${completed} commit(s) já criado(s); os restantes não foram alterados.`) }
      }
      resetCommit()
      return `${completed} commit(s) criado(s).`
    } finally { await loadOverview() }
  }

  async function freshPublishEntries(plan: Entry[]) {
    const fresh = await Promise.all(plan.map(async (entry) => ({ ...entry, overview: await api.gitOverview(sessionId, entry.repository.path) })))
    const reason = pushUnavailableReason(fresh)
    if (reason) throw new Error(reason)
    return fresh
  }

  async function reviewPush(plan: Entry[]) {
    let reviewed: Entry[] = []
    await flow.reviewGitOperation('A enviar commits de todos os repositórios', 'Os submódulos são enviados antes do superprojeto. Confirme os diffs e os remotos de destino.', async () => {
      reviewed = await freshPublishEntries(plan)
      return Promise.all(reviewed.map((entry) => api.gitPreview(sessionId, { operation: 'push', repository: entry.repository.path, remote: repositoryRemote(entry), branch: currentBranch(entry.overview)!.name })))
    }, async () => {
      let completed = 0
      try {
        for (const entry of reviewed) {
          const branch = currentBranch(entry.overview)!
          try {
            const result = await api.gitPush(sessionId, repositoryRemote(entry), branch.name, !branch.has_upstream || branch.gone, entry.repository.path)
            if (result.outcome !== 'pushed' && result.outcome !== 'up_to_date') throw new Error(result.detail || `Push não concluído (${result.outcome})`)
          } catch (error) { throw new Error(`${repositoryLabel(entry)}: ${error instanceof Error ? error.message : String(error)}. ${completed} repositório(s) enviado(s); o envio dos restantes foi interrompido.`) }
          completed++
        }
        return `Envio concluído em ${completed} repositório(s).`
      } finally { await loadOverview() }
    }, true)
  }

  async function reviewCommit(push: boolean) {
    if (!commitPlan.length || !message.trim()) return
    await flow.reviewGitOperation(push ? 'Commit e push — rever commits' : 'A commitar todas as alterações', `A mesma mensagem será usada em ${commitPlan.length} repositório(s), dos submódulos para o superprojeto, incluindo as suas referências atualizadas. ${push ? 'O envio será revisto com os novos commits antes da publicação.' : ''}`, async () => {
      if (push && pushReason) throw new Error(pushReason)
      return commitPreviews()
    }, commitAll, false, undefined, push ? () => reviewPush(publishPlan) : undefined)
  }

  return {
    commitSelected, commitAll: () => reviewCommit(false), commitPush: () => reviewCommit(true), pushAll: () => reviewPush(outgoing),
    repositoryCount: commitPlan.length, outgoingCount: outgoing.length, commitReason, pushReason,
    sendReason: pushUnavailableReason(outgoing),
  }
}
