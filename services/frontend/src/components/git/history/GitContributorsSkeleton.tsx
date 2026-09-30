import { SkeletonBlock, SkeletonLine } from '../../presentation/chrome/Skeleton'

export function GitContributorsSkeleton({ repositoryLabel }: { repositoryLabel?: string }) {
  const label = repositoryLabel ? `A calcular contribuições do repositório: ${repositoryLabel}` : 'A calcular contribuições do repositório'
  return <section className="git-section git-contributors-section" aria-busy="true" aria-label={label}>
    <div className="git-section-heading">
      <div><SkeletonLine width="34%"/><SkeletonLine width="58%"/></div>
      <SkeletonBlock width={28} height={20}/>
    </div>
    <div className="git-contributor-summary">
      {[0, 1, 2].map((index) => <div key={index}><SkeletonLine width="38%"/><SkeletonLine width="72%"/></div>)}
    </div>
    <div className="git-contribution-calendar-card">
      <div className="git-contribution-chart-heading"><div><SkeletonLine width={164}/><SkeletonLine width={210}/></div><SkeletonLine width={94}/></div>
      <SkeletonBlock height={112}/>
    </div>
    <div className="git-contribution-chart-card">
      <div className="git-contribution-chart-heading"><div><SkeletonLine width={132}/><SkeletonLine width={96}/></div></div>
      <SkeletonBlock height={132}/>
      <div className="git-contribution-chart-axis"><SkeletonLine width={46}/><SkeletonLine width={46}/></div>
    </div>
    <div className="git-contributor-ranking-heading"><div><SkeletonLine width={62}/><SkeletonLine width={176}/></div><SkeletonLine width={122}/></div>
    <ol className="git-contributor-ranking">
      {[0, 1].map((index) => <li key={index} className="git-contributor-card">
        <div className="git-contributor-card-head">
          <SkeletonBlock width={22} height={22}/><SkeletonBlock width={30} height={30}/>
          <div className="git-contributor-copy"><SkeletonLine width="56%"/><SkeletonLine width="88%"/></div>
          <div className="git-contributor-totals"><SkeletonLine width={64}/><SkeletonLine width={52}/></div>
        </div>
        <div className="git-contributor-card-chart"><SkeletonBlock height={74}/></div>
      </li>)}
    </ol>
  </section>
}
