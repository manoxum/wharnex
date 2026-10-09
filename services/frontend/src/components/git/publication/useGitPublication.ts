import { api } from '../../../lib/transport/http/api'
import { currentBranch, loadGitProjectOverviews, repositoryLabel, repositoryRemote, type GitRepositoryOverviewEntry as Entry } from '../../../lib/git/workflow/gitProjectOverview'
import type { useGitOperationFlow } from '../../../lib/git/workflow/useGitOperationFlow'
import type { GitOverview } from '../../../types'
import { childrenFirst, pushUnavailableReason } from '../review/changes/gitChangesModel'

type Params = {
  sessionId: string
  flow: Pick<ReturnType<typeof useGitOperationFlow>, 'reviewGitOperation'>
  loadOverview: () => Promise<GitOverview>
}

export function useGitPublication({ sessionId, flow, loadOverview }: Params) {
  async function reviewPush(plan: Entry[], complete = false) {
    let reviewed: Entry[] = []
    const title = complete ? 'Push completo do projeto' : 'A enviar commits de todos os repositórios'
    const detail = complete
      ? 'Publicar os commits existentes de todos os submódulos e do superprojeto. Os submódulos são enviados primeiro. Confirme os diffs e os remotos de destino.'
      : 'Os submódulos são enviados antes do superprojeto. Confirme os diffs e os remotos de destino.'
    await flow.reviewGitOperation(title, detail, async () => {
      reviewed = complete
        ? childrenFirst((await loadGitProjectOverviews(sessionId)).entries)
        : await Promise.all(plan.map(async (entry) => ({ ...entry, overview: await api.gitOverview(sessionId, entry.repository.path) })))
      if (!reviewed.length) throw new Error('Não há repositórios disponíveis para publicar.')
      const reason = pushUnavailableReason(reviewed)
      if (reason) throw new Error(reason)
      return Promise.all(reviewed.map(async (entry) => {
        try {
          return await api.gitPreview(sessionId, { operation: 'push', repository: entry.repository.path, remote: repositoryRemote(entry), branch: currentBranch(entry.overview)!.name })
        } catch (error) { throw new Error(`${repositoryLabel(entry)}: ${error instanceof Error ? error.message : String(error)}`) }
      }))
    }, async () => {
      const completed: string[] = []
      try {
        for (const entry of reviewed) {
          const branch = currentBranch(entry.overview)!
          try {
            const result = await api.gitPush(sessionId, repositoryRemote(entry), branch.name, !branch.has_upstream || branch.gone, entry.repository.path)
            if (result.outcome !== 'pushed' && result.outcome !== 'up_to_date') throw new Error(result.detail || `Push não concluído (${result.outcome})`)
            completed.push(`${repositoryLabel(entry)}: ${result.outcome === 'up_to_date' ? 'já atualizado' : 'enviado'}`)
          } catch (error) {
            throw new Error(`${repositoryLabel(entry)}: ${error instanceof Error ? error.message : String(error)}. ${completed.length} repositório(s) enviado(s); o envio dos restantes foi interrompido.${completed.length ? ` Concluídos: ${completed.join('; ')}.` : ''}`)
          }
        }
      } catch (error) {
        try { await loadOverview() }
        catch (refreshError) {
          throw new Error(`${error instanceof Error ? error.message : String(error)} Não foi possível atualizar o painel: ${refreshError instanceof Error ? refreshError.message : String(refreshError)}`)
        }
        throw error
      }
      // The shared flow refreshes successful mutations; failures refresh here
      // so completed child pushes remain visible even when a parent fails.
      return `Envio concluído em ${completed.length} repositório(s). ${completed.join('; ')}.`
    }, true)
  }

  return { reviewPush, pushProject: () => reviewPush([], true) }
}
