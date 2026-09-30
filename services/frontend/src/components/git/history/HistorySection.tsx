import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { GitBranch, GitCommitDetail, GitOverview } from '../../../types'
import { api } from '../../../lib/transport/http/api'
import { buildGitGraphRows, type GitGraphRow } from '../../../lib/git/workflow/gitGraph'
import { Icon } from '../../presentation/chrome/Icon'
import { InternalWindow } from '../../workspace/window/InternalWindow'
import { GitDiffReview } from '../review/GitDiffReview'

export function HistorySection({ sessionId, repository, repositoryLabel: scopeLabel, branches }: { sessionId: string; repository: string; repositoryLabel?: string; branches: GitOverview['branches'] }) {
  const [mode, setMode] = useState<'current' | 'selected' | 'all'>('current')
  const [selectedRefs, setSelectedRefs] = useState<Set<string>>(new Set())
  const [history, setHistory] = useState<GitOverview['commits']>([])
  const [offset, setOffset] = useState(0)
  const [hasMore, setHasMore] = useState(true)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [detail, setDetail] = useState<GitCommitDetail | null>(null)
  const sentinel = useRef<HTMLDivElement>(null)
  const refsKey = Array.from(selectedRefs).sort().join('\u0000')

  const loadPage = useCallback(async (reset: boolean) => {
    if (loading || (!reset && !hasMore)) return
    setLoading(true); setError('')
    try {
      const next = await api.gitHistoryPage(sessionId, mode === 'selected' ? Array.from(selectedRefs) : [], mode === 'all', reset ? 0 : offset, 50, repository)
      setHistory((current) => reset ? next.commits : [...current, ...next.commits])
      setOffset(next.next_offset); setHasMore(next.has_more)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally { setLoading(false) }
  }, [sessionId, repository, mode, refsKey, offset, hasMore, loading])

  useEffect(() => {
    setHistory([]); setOffset(0); setHasMore(true); setDetail(null); setLoading(true)
    void api.gitHistoryPage(sessionId, mode === 'selected' ? Array.from(selectedRefs) : [], mode === 'all', 0, 50, repository)
      .then((next) => { setHistory(next.commits); setOffset(next.next_offset); setHasMore(next.has_more); setError('') })
      .catch((cause) => setError(cause instanceof Error ? cause.message : String(cause)))
      .finally(() => setLoading(false))
  }, [sessionId, repository, mode, refsKey])

  useEffect(() => {
    const node = sentinel.current
    if (!node || !hasMore || history.length === 0 || loading) return
    const observer = new IntersectionObserver((entries) => { if (entries.some((entry) => entry.isIntersecting)) void loadPage(false) }, { rootMargin: '180px' })
    observer.observe(node)
    return () => observer.disconnect()
  }, [hasMore, history.length, loading, loadPage])

  function selectRefs(values: string[]) { setSelectedRefs(new Set(values)); setMode('selected') }
  async function openCommit(sha: string) { try { setDetail(await api.gitHistoryCommit(sessionId, sha, repository)) } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)) } }

  const rows = buildGitGraphRows(history)
  const refsBySHA = new Map<string, GitBranch[]>()
  for (const branch of branches) refsBySHA.set(branch.commit_sha, [...(refsBySHA.get(branch.commit_sha) || []), branch])
  return <section className="git-section git-history-section">
    <div className="git-section-heading"><div><span>Timeline{scopeLabel ? ` · ${scopeLabel}` : ''}</span><strong>Histórico de commits</strong></div><span className="git-section-count">{history.length}{hasMore ? '+' : ''}</span></div>
    <div className="git-history-scope" role="group" aria-label="Âmbito do histórico">
      <button type="button" className={mode === 'current' ? 'active' : ''} onClick={() => setMode('current')}>Branch atual</button>
      <button type="button" className={mode === 'selected' ? 'active' : ''} onClick={() => setMode('selected')}>Selecionadas {selectedRefs.size ? `(${selectedRefs.size})` : ''}</button>
      <button type="button" className={mode === 'all' ? 'active' : ''} onClick={() => setMode('all')}>Todas</button>
    </div>
    <label className="git-history-branch-picker"><span>Branches específicas <small>{selectedRefs.size ? `${selectedRefs.size} selecionada(s)` : 'Selecione uma ou mais'}</small></span><select multiple value={Array.from(selectedRefs)} aria-label="Branches do histórico" onChange={(event) => selectRefs(Array.from(event.currentTarget.selectedOptions, (option) => option.value))}>{branches.map((branch) => <option key={branch.name} value={branch.name}>{branch.name}{branch.current ? ' · atual' : ''}</option>)}</select></label>
    {error && <p className="git-notice warning-card">{error}</p>}
    {!loading && history.length === 0 && <p className="git-empty inline">Sem commits para o âmbito selecionado.</p>}
    <ul className="git-commit-list">{rows.map((row) => <li key={row.commit.sha} className="git-history-row">
      <CommitGraph row={row}/>
      <button type="button" className="git-history-copy git-history-open" onClick={() => void openCommit(row.commit.sha)}>
        <div className="git-history-subject-line"><span className="git-commit-subject">{row.commit.subject}</span>{(refsBySHA.get(row.commit.sha) || []).slice(0, 3).map((branch) => <span key={branch.name} className={`git-ref-badge ${branch.current ? 'current' : ''}`}>{branch.current && <Icon name="git" size={10}/>} {branch.name}</span>)}</div>
        <div className="git-history-details"><span>{row.commit.author_name}</span><time dateTime={row.commit.committed_at}>{formatCommitDate(row.commit.committed_at)}</time></div>
      </button>
      <div className="git-history-tail">
        <span className="git-commit-meta"><code>{row.commit.short_sha}</code>{row.commit.wharnex && <span className="git-commit-tag" title="Originado por uma alteração do Wharnex">WHX</span>}{row.commit.merge && <span className="git-commit-tag">merge</span>}{!row.commit.pushed && <span className="git-commit-tag local">local</span>}</span>
        <button type="button" className="git-file-diff-action git-line-stats" aria-label={`Abrir diff do commit ${row.commit.short_sha}`} onClick={() => void openCommit(row.commit.sha)}><b>+{row.commit.additions || 0}</b><i>−{row.commit.deletions || 0}</i></button>
      </div>
    </li>)}</ul>
    <div ref={sentinel} className="git-history-sentinel" aria-hidden="true">{loading ? 'A carregar mais…' : hasMore ? '' : history.length ? 'Fim do histórico' : ''}</div>
    {detail && <HistoryCommitDetailModal sessionId={sessionId} detail={detail} onClose={() => setDetail(null)}/>}
  </section>
}

function HistoryCommitDetailModal({ sessionId, detail, onClose }: { sessionId: string; detail: GitCommitDetail; onClose: () => void }) {
  const commit = detail.commit
  return createPortal(<InternalWindow title={`Commit ${commit.short_sha}`} onClose={onClose} layerClassName="git-diff-backdrop">
    <div className="git-diff-modal git-commit-detail-modal git-history-commit-modal" role="dialog" aria-modal="false" aria-label={`Commit ${commit.short_sha}`}>
      <header className="git-history-commit-header">
        <div className="git-history-commit-heading">
          <span className="git-history-commit-icon"><Icon name="git" size={15}/></span>
          <div className="git-history-commit-copy">
            <span className="git-history-commit-eyebrow"><span className="panel-kicker">Histórico Git</span><code>{commit.short_sha}</code></span>
            <strong>{commit.subject}</strong>
            <span className="git-history-commit-byline"><span>{commit.author_name}</span><time dateTime={commit.committed_at}>{formatCommitDate(commit.committed_at)}</time></span>
          </div>
        </div>
        <div className="git-history-commit-actions">
          <div className="git-history-commit-stats" role="group" aria-label="Resumo do commit">
            <span className="git-history-commit-stat additions"><b>+{commit.additions || 0}</b><small>adições</small></span>
            <span className="git-history-commit-stat deletions"><b>−{commit.deletions || 0}</b><small>remoções</small></span>
            <span className="git-history-commit-stat files"><b>{commit.files_changed || 0}</b><small>ficheiro(s)</small></span>
          </div>
          <button type="button" className="agent-drawer-icon git-history-commit-close" onClick={onClose} aria-label="Fechar detalhes"><Icon name="close" size={13}/></button>
        </div>
      </header>
      <details className="git-commit-detail-disclosure git-history-commit-disclosure">
        <summary><span>Detalhes do commit</span><code>{commit.short_sha}</code></summary>
        <div className="git-commit-detail-meta">
          <span><strong>SHA</strong><code>{commit.sha}</code></span>
          <span><strong>Autor</strong>{commit.author_name} &lt;{commit.author_email}&gt;</span>
          <span><strong>Data</strong><time dateTime={commit.committed_at}>{formatCommitDate(commit.committed_at)}</time></span>
          <span><strong>Pais</strong><code>{commit.parents.length ? commit.parents.join(', ') : 'commit inicial'}</code></span>
          {commit.request_id && <span><strong>Request</strong><code>{commit.request_id}</code></span>}
          {commit.plan_id && <span><strong>Plano</strong><code>{commit.plan_id}</code></span>}
        </div>
        {(commit.body || commit.subject) && <pre className="git-commit-message-inline">{commit.body ? `${commit.subject}\n\n${commit.body}` : commit.subject}</pre>}
      </details>
      <GitDiffReview sessionId={sessionId} diff={detail.diff} emptyText="Este commit não contém alterações de ficheiros."/>
      {detail.diff_truncated && <p className="git-hint">O diff foi truncado apenas para apresentação.</p>}
    </div>
  </InternalWindow>, document.body)
}

function CommitGraph({ row }: { row: GitGraphRow }) {
  const laneWidth = 14
  const padding = 7
  const width = Math.max(row.before.length, row.after.length, 1) * laneWidth + padding * 2
  const x = (lane: number) => padding + lane * laneWidth + laneWidth / 2
  const color = (tone: number) => `var(--git-lane-${tone})`
  return <div className="git-commit-graph" style={{ width }} aria-hidden="true">
    <svg className="git-commit-graph-lines" viewBox={`0 0 ${width} 34`} preserveAspectRatio="none" focusable="false">
      {row.before.map((lane, index) => {
        if (index === row.lane) return null
        const target = row.after.findIndex((next) => next.sha === lane.sha)
        if (target < 0) return null
        return <path key={`carry-${lane.sha}-${index}`} d={`M ${x(index)} 0 C ${x(index)} 10, ${x(target)} 24, ${x(target)} 34`} stroke={color(lane.tone)}/>
      })}
      <path d={`M ${x(row.lane)} 0 L ${x(row.lane)} 17`} stroke={color(row.tone)}/>
      {row.parentLanes.map((parentLane, index) => <path key={`parent-${index}`} d={`M ${x(row.lane)} 17 C ${x(row.lane)} 22, ${x(parentLane)} 25, ${x(parentLane)} 34`} stroke={color(index === 0 ? row.tone : row.after[parentLane]?.tone ?? row.tone)}/>)}
    </svg>
    <span className="git-graph-node" style={{ left: x(row.lane), borderColor: color(row.tone) }}/>
  </div>
}

function formatCommitDate(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat('pt-PT', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }).format(date)
}
