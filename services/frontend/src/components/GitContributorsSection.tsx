import { useEffect, useState } from 'react'
import type { GitContributionDay, GitContributorsOverview } from '../types'
import { api } from '../lib/api'

const CONTRIBUTION_CALENDAR_WEEKS = 53

export function GitContributorsSection({ sessionId, repository }: { sessionId: string; repository: string }) {
  const [overview, setOverview] = useState<GitContributorsOverview | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError('')
    void api.gitContributors(sessionId, repository)
      .then((next) => { if (!cancelled) setOverview(next) })
      .catch((cause) => { if (!cancelled) setError(cause instanceof Error ? cause.message : String(cause)) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [sessionId, repository])

  if (loading) return <section className="git-section git-contributors-section"><p className="git-empty inline">A calcular contribuições do repositório…</p></section>
  if (error) return <section className="git-section git-contributors-section"><p className="git-notice warning-card">{error}</p></section>
  if (!overview || overview.contributors.length === 0) return <section className="git-section git-contributors-section"><p className="git-empty inline">Ainda não existem contribuições no histórico.</p></section>

  const chartWeeks = overview.weeks.slice(-52)
  const activeWeeks = overview.weeks.filter((week) => week.commits > 0).length
  return <section className="git-section git-contributors-section">
    <div className="git-section-heading"><div><span>Insights</span><strong>Contribuidores</strong></div><span className="git-section-count">{overview.contributors.length}</span></div>
    <div className="git-contributor-summary" aria-label="Resumo de contribuições">
      <div><strong>{overview.contributors.length}</strong><span>contribuidores</span></div>
      <div><strong>{overview.total_commits}</strong><span>commits</span></div>
      <div><strong>{activeWeeks}</strong><span>semanas ativas</span></div>
    </div>
    <ContributionCalendar days={overview.days ?? []}/>
    <div className="git-contribution-chart-card">
      <div className="git-contribution-chart-heading">
        <div><strong>Atividade temporal</strong><span>{chartWeeks.length < overview.weeks.length ? 'Últimas 52 semanas' : 'Histórico semanal'}</span></div>
        {overview.truncated && <span className="git-contribution-sampled">amostra limitada</span>}
      </div>
      <ContributionAreaChart values={chartWeeks.map((week) => week.commits)} ariaLabel={`Commits por semana em ${chartWeeks.length} semanas`} variant="overall"/>
      <div className="git-contribution-chart-axis"><span>{chartWeeks[0] ? shortContributionDate(chartWeeks[0].started_at) : ''}</span><span>{chartWeeks.at(-1) ? shortContributionDate(chartWeeks.at(-1)!.started_at) : ''}</span></div>
    </div>
    <div className="git-contributor-ranking-heading"><div><span>Ranking</span><strong>Contribuidores por commits</strong></div><small>atividade semanal · linhas alteradas</small></div>
    <ol className="git-contributor-ranking">{overview.contributors.map((contributor, index) => <li key={`${contributor.email}:${contributor.name}`} className="git-contributor-card">
      <div className="git-contributor-card-head">
        <span className={`git-contributor-rank ${index < 3 ? 'top' : ''}`}>{index + 1}</span>
        <span className="git-contributor-avatar" aria-hidden="true">{contributorInitials(contributor.name)}</span>
        <div className="git-contributor-copy"><strong>{contributor.name || contributor.email || 'Autor desconhecido'}</strong><span>{contributor.email || 'sem email'} · última contribuição {formatCommitDate(contributor.last_commit_at)}</span></div>
        <div className="git-contributor-totals"><strong>{contributor.commits} <small>commits</small></strong><span><b>+{contributor.additions}</b><i>−{contributor.deletions}</i></span></div>
      </div>
      <div className="git-contributor-card-chart">
        <ContributionAreaChart values={contributor.weekly_commits.slice(-52)} ariaLabel={`Atividade semanal de ${contributor.name || contributor.email || 'contribuidor'}`} variant="contributor"/>
        <div className="git-contributor-card-axis"><span>{chartWeeks[0] ? shortContributionDate(chartWeeks[0].started_at) : ''}</span><span>{chartWeeks.at(-1) ? shortContributionDate(chartWeeks.at(-1)!.started_at) : ''}</span></div>
      </div>
    </li>)}</ol>
  </section>
}

function ContributionCalendar({ days }: { days: GitContributionDay[] }) {
  const calendar = buildContributionCalendar(days)
  return <div className="git-contribution-calendar-card">
    <div className="git-contribution-chart-heading">
      <div><strong>{calendar.total} contribuições no período</strong><span>Calendário diário · últimas {CONTRIBUTION_CALENDAR_WEEKS} semanas</span></div>
      <span className="git-contribution-calendar-legend" aria-hidden="true"><small>Menos</small>{[0, 1, 2, 3, 4].map((level) => <i key={level} className={`level-${level}`}/>)}<small>Mais</small></span>
    </div>
    <div className="git-contribution-calendar-scroll">
      <div className="git-contribution-calendar-frame" role="img" aria-label={`Calendário de contribuições de ${calendar.firstDate} a ${calendar.lastDate}`}>
        <div className="git-contribution-calendar-months" aria-hidden="true">
          {calendar.months.map((month) => <span key={`${month.label}-${month.column}`} style={{ gridColumn: month.column }}>{month.label}</span>)}
        </div>
        <div className="git-contribution-calendar-body">
          <div className="git-contribution-calendar-weekdays" aria-hidden="true"><span>Seg</span><span>Qua</span><span>Sex</span></div>
          <div className="git-contribution-calendar-grid" aria-hidden="true">
            {calendar.cells.map((cell) => <span key={cell.key} className={`git-contribution-day level-${cell.level}`} title={`${cell.key} · ${cell.commits} commit(s) · +${cell.additions} −${cell.deletions}`}/>)}
          </div>
        </div>
      </div>
    </div>
  </div>
}

function ContributionAreaChart({ values, ariaLabel, variant }: { values: number[]; ariaLabel: string; variant: 'overall' | 'contributor' }) {
  const width = 640
  const height = variant === 'overall' ? 140 : 92
  const baseline = height - 10
  const top = 8
  const series = values.length ? values : [0]
  const max = Math.max(1, ...series)
  const points = series.map((value, index) => {
    const x = series.length === 1 ? width / 2 : (index / (series.length - 1)) * width
    const y = baseline - (value / max) * (baseline - top)
    return [x, y] as const
  })
  const line = points.map(([x, y], index) => `${index === 0 ? 'M' : 'L'} ${x.toFixed(1)} ${y.toFixed(1)}`).join(' ')
  const areaLine = points.map(([x, y]) => `L ${x.toFixed(1)} ${y.toFixed(1)}`).join(' ')
  const firstX = points[0][0].toFixed(1)
  const lastX = points.at(-1)![0].toFixed(1)
  const area = `M ${firstX} ${baseline} ${areaLine} L ${lastX} ${baseline} Z`
  return <svg className={`git-contribution-area-chart ${variant}`} viewBox={`0 0 ${width} ${height}`} role="img" aria-label={ariaLabel} preserveAspectRatio="none">
    <line x1="0" y1={top + (baseline - top) * .33} x2={width} y2={top + (baseline - top) * .33}/>
    <line x1="0" y1={top + (baseline - top) * .66} x2={width} y2={top + (baseline - top) * .66}/>
    <line x1="0" y1={baseline} x2={width} y2={baseline}/>
    <path className="git-contribution-area-fill" d={area}/>
    <path className="git-contribution-area-line" d={line}/>
  </svg>
}

function buildContributionCalendar(days: GitContributionDay[]) {
  const byDate = new Map(days.map((day) => [utcDateKey(new Date(day.started_at)), day]))
  const parsedDates = days.map((day) => new Date(day.started_at)).filter((date) => !Number.isNaN(date.getTime()))
  const lastContribution = parsedDates.length ? new Date(Math.max(...parsedDates.map((date) => date.getTime()))) : new Date()
  const endWeekStart = mondayUTC(lastContribution)
  const start = addUTCDays(endWeekStart, -(CONTRIBUTION_CALENDAR_WEEKS - 1) * 7)
  const maxCommits = Math.max(1, ...days.map((day) => day.commits))
  const cells = Array.from({ length: CONTRIBUTION_CALENDAR_WEEKS * 7 }, (_, index) => {
    const date = addUTCDays(start, index)
    const key = utcDateKey(date)
    const day = byDate.get(key)
    const commits = day?.commits ?? 0
    return { key, commits, additions: day?.additions ?? 0, deletions: day?.deletions ?? 0, level: contributionLevel(commits, maxCommits) }
  })
  const months: Array<{ label: string; column: number }> = []
  let previousMonth = -1
  for (let week = 0; week < CONTRIBUTION_CALENDAR_WEEKS; week++) {
    const date = addUTCDays(start, week * 7)
    if (date.getUTCMonth() !== previousMonth) {
      months.push({ label: new Intl.DateTimeFormat('pt-PT', { month: 'short', timeZone: 'UTC' }).format(date), column: week + 1 })
      previousMonth = date.getUTCMonth()
    }
  }
  const last = addUTCDays(start, CONTRIBUTION_CALENDAR_WEEKS * 7 - 1)
  return {
    cells,
    months,
    total: cells.reduce((sum, cell) => sum + cell.commits, 0),
    firstDate: formatContributionWeek(start.toISOString()),
    lastDate: formatContributionWeek(last.toISOString()),
  }
}

function contributionLevel(commits: number, max: number) {
  if (commits <= 0) return 0
  const ratio = commits / max
  if (ratio <= .25) return 1
  if (ratio <= .5) return 2
  if (ratio <= .75) return 3
  return 4
}

function mondayUTC(value: Date) {
  const date = new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()))
  const weekday = date.getUTCDay() || 7
  date.setUTCDate(date.getUTCDate() - weekday + 1)
  return date
}

function addUTCDays(value: Date, days: number) {
  const date = new Date(value)
  date.setUTCDate(date.getUTCDate() + days)
  return date
}

function utcDateKey(value: Date) {
  if (Number.isNaN(value.getTime())) return ''
  return value.toISOString().slice(0, 10)
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
