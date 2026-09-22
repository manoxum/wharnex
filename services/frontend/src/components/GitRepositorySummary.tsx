import { Icon } from './Icon'
import { currentBranch, repositoryLabel, type GitRepositoryOverviewEntry } from '../lib/gitProjectOverview'

export function GitRepositorySummary({ entries, compact = false }: { entries: GitRepositoryOverviewEntry[]; compact?: boolean }) {
  return <section className={`git-repository-summary ${compact ? 'compact' : ''}`} aria-label="Executar operações em">
    <div className="git-repository-summary-heading">
      <div><span>Executar operações em</span><strong>Repositórios do projeto</strong></div>
      <span>{entries.length}</span>
    </div>
    <ul>{entries.map((entry) => {
      const branch = currentBranch(entry.overview)
      const available = entry.repository.available && Boolean(entry.overview)
      const linked = Boolean(branch?.has_upstream && !branch.gone)
      const branchName = entry.overview?.detached ? 'HEAD destacado' : branch?.name || entry.repository.current_branch || 'sem branch'
      return <li key={entry.repository.path || '__root__'} className={!available ? 'unavailable' : ''}>
        <span className="git-repository-summary-icon"><Icon name={entry.repository.root ? 'git' : 'package'} size={12}/></span>
        <span className="git-repository-summary-copy"><strong>{repositoryLabel(entry)}</strong><small>{branchName}</small></span>
        <span className="git-repository-summary-sync">
          {!available ? <b className="unavailable">Indisponível</b> : linked ? <>
            <b className="linked" title={branch?.upstream}><Icon name="link" size={9}/>{branch?.upstream}</b>
            <b className="outgoing" title="Commits por enviar"><Icon name="arrow-up" size={9}/>{branch?.ahead || 0}</b>
            <b className="incoming" title="Commits por receber"><Icon name="arrow-down" size={9}/>{branch?.behind || 0}</b>
          </> : <b className="local">Apenas local</b>}
        </span>
      </li>
    })}</ul>
    <small className="git-repository-summary-hint">A escolha dos repositórios é feita ao executar cada operação Git.</small>
  </section>
}
