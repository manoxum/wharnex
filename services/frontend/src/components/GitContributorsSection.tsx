import { useEffect, useState } from 'react'
import type { GitContributorsOverview } from '../types'
import { api } from '../lib/api'

export function GitContributorsSection({ sessionId }: { sessionId: string }) {
  const [overview, setOverview] = useState<GitContributorsOverview | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError('')
    void api.gitContributors(sessionId)
      .then((next) => { if (!cancelled) setOverview(next) })
      .catch((cause) => { if (!cancelled) setError(cause instanceof Error ? cause.message : String(cause)) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [sessionId])

  if (loading) return <section className="git-section git-contributors-section"><p className="git-empty inline">A calcular contribuições do repositório…</p></section>
  if (error) return <section className="git-section git-contributors-section"><p className="git-notice warning-card">{error}</p></section>
  if (!overview || overview.contributors.length === 0) return <section className="git-section git-contributors-section"><p className="git-empty inline">Ainda não existem contribuições no histórico.</p></section>

  const chartWeeks = overview.weeks.slice(-52)
  const maxCommits = Math.max(1, ...chartWeeks.map((week) => week.commits))
  const activeWeeks = overview.weeks.filter((week) => week.commits > 0).length
  return <section className="git-section git-contributors-section">
    <div className="git-section-heading"><div><span>Insights</span><strong>Contribuidores</strong></div><span className="git-section-count">{overview.contributors.length}</span></div>
    <div className="git-contributor-summary" aria-label="Resumo de contribuições">
      <div><strong>{overview.contributors.length}</strong><span>contribuidores</span></div>
      <div><strong>{overview.total_commits}</strong><span>commits</span></div>
      <div><strong>{activeWeeks}</strong><span>semanas ativas</span></div>
    </div>
    <div className="git-contribution-chart-card">
      <div className="git-contribution-chart-heading">
        <div><strong>Atividade temporal</strong><span>{chartWeeks.length < overview.weeks.length ? 'Últimas 52 semanas' : 'Histórico semanal'}</span></div>
        {overview.truncated && <span className="git-contribution-sampled">amostra limitada</span>}
      </div>
      <div className="git-contribution-chart" role="img" aria-label={`Commits por semana em ${chartWeeks.length} semanas`}>
        {chartWeeks.map((week) => <div key={week.started_at} className="git-contribution-week" title={`${formatContributionWeek(week.started_at)} · ${week.commits} commit(s) · +${week.additions} −${week.deletions}`}>
          <span style={{ height: `${Math.max(week.commits ? 8 : 2, Math.round((week.commits / maxCommits) * 100))}%` }}/>
        </div>)}
      </div>
      <div className="git-contribution-chart-axis"><span>{chartWeeks[0] ? shortContributionDate(chartWeeks[0].started_at) : ''}</span><span>{chartWeeks.at(-1) ? shortContributionDate(chartWeeks.at(-1)!.started_at) : ''}</span></div>
    </div>
    <div className="git-contributor-ranking-heading"><div><span>Ranking</span><strong>Contribuidores por commits</strong></div><small>commits · linhas alteradas</small></div>
    <ol className="git-contributor-ranking">{overview.contributors.map((contributor, index) => <li key={`${contributor.email}:${contributor.name}`}>
      <span className={`git-contributor-rank ${index < 3 ? 'top' : ''}`}>{index + 1}</span>
      <span className="git-contributor-avatar" aria-hidden="true">{contributorInitials(contributor.name)}</span>
      <div className="git-contributor-copy"><strong>{contributor.name || contributor.email || 'Autor desconhecido'}</strong><span>{contributor.email || 'sem email'} · última contribuição {formatCommitDate(contributor.last_commit_at)}</span></div>
      <ContributionSparkline values={contributor.weekly_commits.slice(-52)}/>
      <div className="git-contributor-totals"><strong>{contributor.commits}</strong><span><b>+{contributor.additions}</b><i>−{contributor.deletions}</i></span></div>
    </li>)}</ol>
  </section>
}

function ContributionSparkline({ values }: { values: number[] }) {
  const width = 86
  const height = 24
  const series = values.length ? values : [0]
  const max = Math.max(1, ...series)
  const points = series.map((value, index) => {
    const x = series.length === 1 ? width : (index / (series.length - 1)) * width
    const y = height - 2 - (value / max) * (height - 5)
    return `${x.toFixed(1)},${y.toFixed(1)}`
  }).join(' ')
  return <svg className="git-contributor-sparkline" viewBox={`0 0 ${width} ${height}`} aria-hidden="true" preserveAspectRatio="none"><polyline points={points}/></svg>
}

function contributorInitials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '?'
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return `${parts[0][0]}${parts.at(-1)![0]}`.toUpperCase()
}

function formatContributionWeek(value: string) {
  return new Intl.DateTimeFormat('pt-PT', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(new Date(value))
}

function shortContributionDate(value: string) {
  return new Intl.DateTimeFormat('pt-PT', { month: 'short', year: '2-digit', timeZone: 'UTC' }).format(new Date(value))
}

function formatCommitDate(value: string) {
  if (!value) return 'data desconhecida'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat('pt-PT', { day: '2-digit', month: 'short', year: 'numeric' }).format(date)
}
