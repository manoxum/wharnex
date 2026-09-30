import type { GitOverview } from '../../../types'
import type { GitRepositoryOverviewEntry } from '../../../lib/git/workflow/gitProjectOverview'
import { repositoryLabel } from '../../../lib/git/workflow/gitProjectOverview'
import { worktreeKey } from '../../../lib/git/workflow/gitWorktreeKey'
import { Icon } from '../../presentation/chrome/Icon'

export function GitProjectWorktree({ entries, disabled, selected, message, onMessageChange, onToggle, onCommit, onOpenDiff }: {
  entries: GitRepositoryOverviewEntry[]
  disabled: boolean
  selected: Set<string>
  message: string
  onMessageChange: (value: string) => void
  onToggle: (key: string) => void
  onCommit: () => void
  onOpenDiff: (repository: string, path: string) => void
}) {
  const visible = entries.filter((entry) => entry.overview)
  const files = visible.flatMap((entry) => (entry.overview?.working.files || []).map((file) => ({ entry, file })))
  const canCommit = (kind: GitOverview['working']['files'][number]['kind']) => kind === 'change' || kind === 'gitlink'
  const committable = files.filter(({ file }) => canCommit(file.kind)).length
  const selectableKeys = files
    .filter(({ entry, file }) => Boolean(entry.overview?.has_identity) && canCommit(file.kind))
    .map(({ entry, file }) => worktreeKey(entry.repository.path, file.path))
  const identityReady = selectableKeys.length > 0
  const allSelected = selectableKeys.length > 0 && selectableKeys.every((key) => selected.has(key))
  const missingIdentity = files.some(({ entry, file }) => !entry.overview?.has_identity && canCommit(file.kind))
  const showOrigin = visible.length > 1

  function toggleAll() {
    for (const key of selectableKeys) {
      if (selected.has(key) === allSelected) onToggle(key)
    }
  }

  return <section className="git-change-surface git-worktree-files-section">
    <div className="git-change-surface-heading"><div><span>Worktrees do projeto</span><strong>{files.length ? 'Alterações locais' : 'Worktrees limpos'}</strong></div><span className="git-section-count">{files.length}</span></div>
    {files.length === 0 ? <div className="git-clean-state"><span><Icon name="check" size={13}/></span><div><strong>Sem alterações por commitar</strong><small>O superprojeto e os submódulos estão limpos.</small></div></div> : <>
      <ul className="git-worktree-files">{files.map(({ entry, file }) => {
        const key = worktreeKey(entry.repository.path, file.path)
        const diffable = file.kind !== 'submodule' && file.kind !== 'embedded_repository'
        const selectable = canCommit(file.kind) && entry.overview?.has_identity
        return <li key={`${entry.repository.path}:${file.kind}:${file.path}`}>
          <label className="git-worktree-file-select" title={selectable ? 'Selecionar ficheiro para commit' : 'Este ficheiro não pode ser commitado daqui'}><input type="checkbox" checked={selected.has(key)} disabled={disabled || !selectable} aria-label={showOrigin ? `Selecionar ${file.path} em ${repositoryLabel(entry)}` : `Selecionar ${file.path}`} onChange={() => onToggle(key)}/></label>
          <span className="git-worktree-file-icon"><Icon name={file.kind === 'unmerged' ? 'alert' : 'file'} size={12}/></span>
          <span className="git-worktree-file-copy"><strong title={file.path}>{file.path}</strong><small>{kindLabel(file.kind)}{showOrigin && <span className="git-repository-origin">{repositoryLabel(entry)}</span>}</small></span>
          <button type="button" className="git-file-diff-action git-line-stats" disabled={disabled || !diffable} title={diffable ? 'Ver alterações deste ficheiro' : 'Este tipo de entrada não tem diff inline'} aria-label={`Abrir diff de ${file.path}`} onClick={() => onOpenDiff(entry.repository.path, file.path)}><b>+{file.additions || 0}</b><i>−{file.deletions || 0}</i></button>
        </li>
      })}</ul>
      {committable > 0 && <div className="git-row"><button type="button" className="git-action small" disabled={disabled || !identityReady} onClick={toggleAll}><Icon name={allSelected ? 'close' : 'check'} size={12}/>{allSelected ? 'Limpar seleção' : `Selecionar todas (${selectableKeys.length})`}</button></div>}
      {committable > 0 && <div className="git-worktree-commit"><label><span>Mensagem do commit</span><input type="text" value={message} disabled={disabled || !identityReady} onChange={(event) => onMessageChange(event.target.value)} placeholder="ex.: fix(ui): ajustar painel Git"/></label><button type="button" className="git-action primary" disabled={disabled || !identityReady || selected.size === 0 || !message.trim()} onClick={onCommit}><Icon name="check" size={13}/> Commitar ({selected.size})</button></div>}
      {missingIdentity && <p className="git-hint warning-card">Configure <code>user.name</code> e <code>user.email</code> nos repositórios sem identidade para criar commits manuais neles.</p>}
    </>}
  </section>
}

function kindLabel(kind: GitOverview['working']['files'][number]['kind']) {
  return ({ change: 'alterado', gitlink: 'gitlink alterado', submodule: 'submódulo com alterações', embedded_repository: 'repositório embebido', unmerged: 'conflito não resolvido' } as const)[kind]
}
