import { useId, useState } from 'react'
import { Icon } from './Icon'
import { currentBranch, repositoryLabel, type GitRepositoryOverviewEntry } from '../lib/gitProjectOverview'

export function GitRepositorySummary({ entries, compact = false }: { entries: GitRepositoryOverviewEntry[]; compact?: boolean }) {
  const [expanded, setExpanded] = useState(false)
  const listID = useId()
  const status = repositoryStatus(entries)

  return <section className={`git-repository-summary ${compact ? 'compact' : ''}`} aria-label="Repositórios do projeto">
    <button type="button" className="git-repository-summary-toggle" aria-expanded={expanded} aria-controls={listID} onClick={() => setExpanded((value) => !value)}>
      <span className="git-repository-summary-icon"><Icon name="git" size={13}/></span>
      <span className="git-repository-summary-copy">
        <span>Executar operações em</span>
        <strong>Repositórios do projeto</strong>
        <small>{status}</small>
      </span>
      <span className="git-repository-summary-count" aria-label={`${entries.length} repositório(s)`}>{entries.length}</span>
      <span className="git-repository-summary-chevron" aria-hidden="true"><Icon name="chevron" size={11}/></span>
    </button>
    <ul id={listID} hidden={!expanded}>{entries.map((entry) => {
      const branch = currentBranch(entry.overview)
      const available = entry.repository.available && Boolean(entry.overview)
      const linked = Boolean(branch?.has_upstream && !branch.gone)
      const branchName = entry.overview?.detached ? 'HEAD destacado' : branch?.name || entry.repository.current_branch || 'sem branch'
      return <li key={entry.repository.path || '__root__'} className={!available ? 'unavailable' : ''}>
        <span className="git-repository-row-icon"><Icon name={entry.repository.root ? 'git' : 'package'} size={12}/></span>
        <span className="git-repository-row-copy"><strong>{repositoryLabel(entry)}</strong><small>{branchName}</small></span>
        <span className="git-repository-summary-sync">
          {!available ? <b className="unavailable">Indisponível</b> : linked ? <>
            <b className="linked" title={branch?.upstream}><Icon name="link" size={9}/>{branch?.upstream}</b>
            <b className="outgoing" title="Commits por enviar"><Icon name="arrow-up" size={9}/>{branch?.ahead || 0}</b>
            <b className="incoming" title="Commits por receber"><Icon name="arrow-down" size={9}/>{branch?.behind || 0}</b>
          </> : <b className="local">Apenas local</b>}
        </span>
      </li>
    })}</ul>
    {expanded && <small className="git-repository-summary-hint">A escolha dos repositórios é feita ao executar cada operação Git.</small>}
  </section>
}

function repositoryStatus(entries: GitRepositoryOverviewEntry[]) {
  let linked = 0
  let local = 0
  let unavailable = 0
  for (const entry of entries) {
    if (!entry.repository.available || !entry.overview) { unavailable += 1; continue }
    const branch = currentBranch(entry.overview)
    if (branch?.has_upstream && !branch.gone) linked += 1
    else local += 1
  }
  const parts = [linked ? `${linked} ${linked === 1 ? 'ligado' : 'ligados'}` : '', local ? `${local} ${local === 1 ? 'local' : 'locais'}` : '', unavailable ? `${unavailable} ${unavailable === 1 ? 'indisponível' : 'indisponíveis'}` : ''].filter(Boolean)
  return parts.join(' · ') || 'Sem repositórios disponíveis'
}
