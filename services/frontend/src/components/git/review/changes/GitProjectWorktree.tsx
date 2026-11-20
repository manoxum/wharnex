import { useState } from 'react'
import { GitWorktreeChangeRow } from './GitWorktreeChangeRow'
import { GitWorktreeCommitControls, type CollectiveCommitControls } from './GitWorktreeCommitControls'
import { gitWorktreeKindLabel } from './gitWorktreeChangeLabels'
import type { GitOverview } from '../../../../types'
import type { GitRepositoryOverviewEntry } from '../../../../lib/git/workflow/gitProjectOverview'
import { repositoryLabel } from '../../../../lib/git/workflow/gitProjectOverview'
import { worktreeKey } from '../../../../lib/git/workflow/gitWorktreeKey'
import { translate as uiText, formatMessage } from '../../../../lib/workspace/localization'
import { Icon } from '../../../presentation/chrome/Icon'
import { Button, Input } from '../../../presentation/workbench'

export function GitProjectWorktree({ entries, disabled, selected, message, onMessageChange, onToggle, onCommit, onOpenDiff, collective }: {
  collective?: CollectiveCommitControls
  entries: GitRepositoryOverviewEntry[]
  disabled: boolean
  selected: Set<string>
  message: string
  onMessageChange: (value: string) => void
  onToggle: (key: string) => void
  onCommit: () => void
  onOpenDiff: (repository: string, path: string) => void
}) {
  const [query, setQuery] = useState('')
  const visible = entries.filter((entry) => entry.overview)
  const files = visible.flatMap((entry) => (entry.overview?.working.files || []).map((file) => ({ entry, file })))
  const canCommit = (kind: GitOverview['working']['files'][number]['kind']) => kind === 'change' || kind === 'gitlink'
  const committable = files.filter(({ file }) => canCommit(file.kind)).length
  const selectableKeys = files
    .filter(({ entry, file }) => Boolean(entry.overview?.has_identity) && canCommit(file.kind))
    .map(({ entry, file }) => worktreeKey(entry.repository.path, file.path))
  const identityReady = selectableKeys.length > 0
  const missingIdentity = files.some(({ entry, file }) => !entry.overview?.has_identity && canCommit(file.kind))
  const showOrigin = visible.length > 1
  const needle = query.trim().toLocaleLowerCase()
  const filteredFiles = needle ? files.filter(({ entry, file }) =>
    [file.path, repositoryLabel(entry), gitWorktreeKindLabel(file.kind)].some((value) => value.toLocaleLowerCase().includes(needle))) : files
  const filteredKeys = filteredFiles
    .filter(({ entry, file }) => Boolean(entry.overview?.has_identity) && canCommit(file.kind))
    .map(({ entry, file }) => worktreeKey(entry.repository.path, file.path))
  const allFilteredSelected = filteredKeys.length > 0 && filteredKeys.every((key) => selected.has(key))

  function toggleFiltered() {
    for (const key of filteredKeys) {
      if (selected.has(key) === allFilteredSelected) onToggle(key)
    }
  }

  return <section className="flex min-h-0 min-w-0 flex-1 flex-col gap-1.5">
    <div className="flex min-h-8 items-center border-b border-whx-border-soft pb-1.5">
      <strong className="text-[calc(12px*var(--ui-font-scale))] font-semibold text-whx-text">{uiText(files.length ? 'Alterações locais' : 'Worktrees limpos')}</strong>
    </div>
    {files.length === 0 ? <div className="flex items-center gap-2 border-b border-whx-border-soft py-2 text-[calc(12px*var(--ui-font-scale))] text-whx-success"><Icon name="check" size={15}/><strong className="font-medium">{uiText('Sem alterações por commitar')}</strong></div> : <>
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <div className="relative min-w-36 flex-1">
          <Input type="search" aria-label={uiText('Pesquisar por nome ou caminho…')} placeholder={uiText('Pesquisar por nome ou caminho…')} value={query} onChange={(event) => setQuery(event.target.value)} className="!h-8 !w-full !appearance-none !py-1 !pl-8 !pr-8"/>
          <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-whx-faint"><Icon name="search" size={13}/></span>
          {query && <button type="button" aria-label={uiText('Limpar pesquisa')} onClick={() => setQuery('')} className="absolute right-1 top-1/2 grid size-6 -translate-y-1/2 place-items-center rounded text-whx-faint hover:bg-whx-hover hover:text-whx-text focus-visible:outline-2 focus-visible:outline-whx-accent"><Icon name="close" size={12}/></button>}
        </div>
        {(needle || selected.size > 0) && <span className="shrink-0 text-[calc(10px*var(--ui-font-scale))] text-whx-faint" aria-live="polite">{formatMessage('{visible} de {total} ficheiros · {selected} selecionados', { visible: filteredFiles.length, total: files.length, selected: selected.size })}</span>}
        {committable > 0 && filteredKeys.length > 0 && <Button icon={allFilteredSelected ? 'close' : 'check'} disabled={disabled || !identityReady} onClick={toggleFiltered} className="!min-h-8 !gap-1.5 !px-2 !py-1">
          {allFilteredSelected ? (needle ? uiText('Limpar visíveis') : uiText('Limpar seleção')) : formatMessage(needle ? 'Selecionar visíveis ({count})' : 'Selecionar todas ({count})', { count: filteredKeys.length })}
        </Button>}
      </div>
      {committable > 0 && <GitWorktreeCommitControls disabled={disabled} identityReady={identityReady} selectedCount={selected.size} message={message} onMessageChange={onMessageChange} onCommit={onCommit} collective={collective}/>}
      {filteredFiles.length === 0 ? <p className="m-0 border-y border-whx-border-soft py-4 text-center text-[calc(12px*var(--ui-font-scale))] text-whx-faint">{uiText('Sem correspondências.')}</p> : <ul className="m-0 grid min-h-0 min-w-0 flex-1 content-start list-none divide-y divide-whx-border-soft !overflow-y-auto border-y border-whx-border-soft bg-whx-bg p-0">{filteredFiles.map(({ entry, file }) => {
        const key = worktreeKey(entry.repository.path, file.path)
        return <GitWorktreeChangeRow key={`${entry.repository.path}:${file.kind}:${file.path}`} entry={entry} file={file} disabled={disabled} selected={selected.has(key)} showOrigin={showOrigin} onToggle={() => onToggle(key)} onOpenDiff={() => onOpenDiff(entry.repository.path, file.path)}/>
      })}</ul>}
      {missingIdentity && <p className="m-0 border-l-2 border-whx-warning bg-whx-warning/10 px-2 py-1.5 text-[calc(11px*var(--ui-font-scale))] text-whx-warning">{uiText('Configure user.name e user.email nos repositórios sem identidade para criar commits manuais neles.')}</p>}
    </>}
  </section>
}
