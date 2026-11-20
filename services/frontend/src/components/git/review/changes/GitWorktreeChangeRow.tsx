import type { GitOverview } from '../../../../types'
import type { GitRepositoryOverviewEntry } from '../../../../lib/git/workflow/gitProjectOverview'
import { repositoryLabel } from '../../../../lib/git/workflow/gitProjectOverview'
import { translate as uiText, formatMessage } from '../../../../lib/workspace/localization'
import { Icon } from '../../../presentation/chrome/Icon'
import { gitWorktreeKindLabel } from './gitWorktreeChangeLabels'
import { GitDiffStatsButton } from '../GitDiffStatsButton'
import { gitFilePath } from '../presentation/gitFilePath'

type WorktreeFile = GitOverview['working']['files'][number]

export function GitWorktreeChangeRow({ entry, file, disabled, selected, showOrigin, onToggle, onOpenDiff }: {
  entry: GitRepositoryOverviewEntry
  file: WorktreeFile
  disabled: boolean
  selected: boolean
  showOrigin: boolean
  onToggle: () => void
  onOpenDiff: () => void
}) {
  const selectable = canCommit(file.kind) && entry.overview?.has_identity
  const diffable = file.kind !== 'submodule' && file.kind !== 'embedded_repository'
  const { name, parent } = gitFilePath(file.path)
  const showRepository = showOrigin && !entry.repository.root
  const selectionLabel = formatMessage(showOrigin ? 'Selecionar {path} em {repository}' : 'Selecionar {path}', showOrigin ? { path: file.path, repository: repositoryLabel(entry) } : { path: file.path })

  return <li className="group !flex min-h-10 min-w-0 !items-center !gap-2 !px-2 !py-1 transition-colors hover:bg-whx-hover">
    <label className="!grid !size-7 !shrink-0 !self-center !place-items-center cursor-pointer" title={uiText(selectable ? 'Selecionar ficheiro para commit' : 'Este ficheiro não pode ser commitado daqui')}>
      <input className="!m-0 !block !size-4 accent-[var(--theme-accent)]" type="checkbox" checked={selected} disabled={disabled || !selectable} aria-label={selectionLabel} onChange={onToggle}/>
    </label>
    <span className="grid size-6 shrink-0 self-center place-items-center text-whx-faint"><Icon name={file.kind === 'unmerged' ? 'alert' : 'file'} size={15}/></span>
    <span className="grid min-w-0 flex-1 self-center gap-0.5">
      <strong className="truncate font-mono text-whx-label font-medium leading-4 text-whx-text" title={file.path}>{name}</strong>
      <small className="flex min-w-0 items-center gap-1.5 text-whx-caption leading-4 text-whx-faint" title={`${repositoryLabel(entry)} · ${file.path}`}>
        <span className="shrink-0">{uiText(gitWorktreeKindLabel(file.kind))}</span>
        {parent && <><span aria-hidden="true">·</span><span className="truncate">{parent}</span></>}
        {showRepository && <><span aria-hidden="true">·</span><span className="max-w-32 truncate">{repositoryLabel(entry)}</span></>}
      </small>
    </span>
    <GitDiffStatsButton additions={file.additions || 0} deletions={file.deletions || 0} disabled={disabled || !diffable} title={uiText(diffable ? 'Ver alterações deste ficheiro' : 'Este tipo de entrada não tem diff inline')} label={formatMessage('Abrir diff de {path}', { path: file.path })} onClick={onOpenDiff}/>
  </li>
}

function canCommit(kind: WorktreeFile['kind']) {
  return kind === 'change' || kind === 'gitlink'
}
