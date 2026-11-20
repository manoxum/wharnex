import type { GitRepositoryOverviewEntry as Entry } from '../../../lib/git/workflow/gitProjectOverview'
import { Icon } from '../../presentation/chrome/Icon'
import { GitRepositorySummary } from '../history/GitRepositorySummary'
import { pushUnavailableReason } from '../review/changes/gitChangesModel'
import { useGitPublication } from './useGitPublication'

type Props = Parameters<typeof useGitPublication>[0] & {
  entries: Entry[]
  summaryEntries: Entry[]
  disabled: boolean
}

export function GitProjectPublication({ entries, summaryEntries, disabled, ...params }: Props) {
  const { pushProject } = useGitPublication(params)
  const reason = pushUnavailableReason(entries)
  const submodules = entries.filter((entry) => !entry.repository.root).length
  return <div className="flex min-w-0 w-full flex-col gap-2 pb-2">
    <GitRepositorySummary entries={summaryEntries}/>
    <section className="flex min-w-0 w-full flex-wrap items-center justify-between gap-2 rounded-md border border-whx-border bg-whx-surface px-3 py-2" aria-label="Publicação completa do projeto">
      <div className="min-w-0 flex-1 text-xs text-whx-faint">
        <span className="text-xs! text-whx-faint!">Publicar commits existentes · {submodules} submódulo(s) e superprojeto</span>
        {reason && <p className="m-0 text-xs! text-whx-warning!" role="status">{reason.replace(': ', ' — ')}</p>}
      </div>
      <button type="button" className="inline-flex min-h-8 shrink-0 items-center gap-1.5 rounded-md border border-whx-border bg-whx-surface px-3 py-1.5 text-sm! font-semibold! text-whx-text hover:bg-whx-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:[outline-color:var(--theme-accent)] disabled:opacity-45" disabled={disabled || !entries.length || Boolean(reason)} title={reason || 'Enviar os commits existentes de todos os submódulos e do superprojeto, após revisão conjunta'} onClick={() => void pushProject()}><Icon name="arrow-up" size={13}/>Publicar projeto</button>
    </section>
  </div>
}
