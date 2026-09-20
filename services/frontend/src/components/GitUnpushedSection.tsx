import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import type { GitBranch, GitCommitDetail, GitRemote, GitUnpushedOverview } from '../types'
import { api, APIError } from '../lib/api'
import { Icon } from './Icon'
import { GitDiffReview } from './GitDiffReview'

export function GitUnpushedSection({ sessionId, activeBranch, remotes, disabled, onFullPush, onSelectedPush }: {
  sessionId: string
  activeBranch?: GitBranch
  remotes: GitRemote[]
  disabled: boolean
  onFullPush: (remote: string, branch: string, setUpstream: boolean) => Promise<void>
  onSelectedPush: (commitSHAs: string[]) => Promise<void>
}) {
  const [overview, setOverview] = useState<GitUnpushedOverview | null>(null)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [detail, setDetail] = useState<GitCommitDetail | null>(null)
  const [loading, setLoading] = useState(false)
  const [actionBusy, setActionBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    let alive = true
    setLoading(true)
    setError('')
    setSelected(new Set())
    setDetail(null)
    api.gitUnpushed(sessionId)
      .then((next) => { if (alive) setOverview({ ...next, commits: Array.isArray(next.commits) ? next.commits : [] }) })
      .catch((cause) => { if (alive) setError(messageOf(cause)) })
      .finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [sessionId, activeBranch?.commit_sha, activeBranch?.ahead, activeBranch?.upstream])

  const oldestFirst = useMemo(() => [...(overview?.commits || [])].reverse(), [overview?.commits])
  const defaultRemote = overview?.remote || remotes[0]?.name || ''
  const branch = overview?.branch || activeBranch?.name || ''
  const canPushSelected = overview?.has_upstream === true

  function toggleCommit(sha: string, checked: boolean) {
    const index = oldestFirst.findIndex((commit) => commit.sha === sha)
    if (index < 0) return
    const count = checked ? index + 1 : index
    setSelected(new Set(oldestFirst.slice(0, count).map((commit) => commit.sha)))
  }

  async function run(action: () => Promise<void>) {
    setActionBusy(true)
    setError('')
    try {
      await action()
      const next = await api.gitUnpushed(sessionId)
      setOverview({ ...next, commits: Array.isArray(next.commits) ? next.commits : [] })
      setSelected(new Set())
      setDetail(null)
    } catch (cause) {
      setError(messageOf(cause))
    } finally {
      setActionBusy(false)
    }
  }

  async function openDetail(sha: string) {
    setError('')
    try {
      setDetail(await api.gitUnpushedCommit(sessionId, sha))
    } catch (cause) {
      setError(messageOf(cause))
    }
  }

  const blocked = disabled || loading || actionBusy
  return <section className="git-change-surface git-unpushed-section">
    <div className="git-change-surface-heading">
      <div><span>Branch local</span><strong>Commits por publicar</strong></div>
      <span className="git-section-count">{overview?.commits.length || 0}</span>
    </div>

    <div className="git-unpushed-summary">
      <div className="git-unpushed-branch-copy">
        <strong>{branch || 'HEAD destacado'}</strong>
        <small>{overview?.has_upstream ? `upstream ${overview.upstream}` : 'sem upstream configurado'}</small>
      </div>
      <button type="button" className="git-action primary" disabled={blocked || !branch || !defaultRemote} onClick={() => void run(() => onFullPush(defaultRemote, branch, !overview?.has_upstream))}>
        <Icon name="arrow-up" size={13}/> Push completo
      </button>
    </div>

    {error && <p className="git-notice error-card" role="alert">{error}</p>}
    {loading && <p className="git-empty inline">A comparar a branch local com a origem…</p>}
    {!loading && overview && !overview.has_upstream && <p className="git-empty inline">{overview.commits.length > 0
      ? 'Sem upstream, estes são os commits locais que ainda não aparecem em nenhuma referência remota. O push completo publica a branch e configura a origem.'
      : 'Ainda não existe upstream e não há commits locais por publicar. O push completo publica a branch e configura a origem.'}</p>}
    {!loading && overview?.has_upstream && overview.commits.length === 0 && <div className="git-clean-state"><span><Icon name="check" size={13}/></span><div><strong>Branch sincronizada</strong><small>Não há commits locais por publicar nesta branch.</small></div></div>}

    {!loading && overview && overview.commits.length > 0 && <>
      <div className="git-unpushed-actions">
        <span>{canPushSelected ? 'Selecione um prefixo contínuo desde o commit mais antigo.' : 'Configure um upstream para ativar o push seletivo.'}</span>
        {canPushSelected && <button type="button" className="git-action" disabled={blocked || selected.size === 0} onClick={() => void run(() => onSelectedPush(oldestFirst.filter((commit) => selected.has(commit.sha)).map((commit) => commit.sha)))}>
          <Icon name="arrow-up" size={13}/> Push selecionado ({selected.size})
        </button>}
      </div>
      <ul className="git-unpushed-list">
        {overview.commits.map((commit) => <li key={commit.sha}>
          <input type="checkbox" aria-label={`Selecionar ${commit.subject}`} checked={selected.has(commit.sha)} disabled={blocked || !canPushSelected} onChange={(event) => toggleCommit(commit.sha, event.target.checked)}/>
          <span className="git-unpushed-commit-icon"><Icon name="git" size={12}/></span>
          <button type="button" className="git-unpushed-commit-link" disabled={blocked} onClick={() => void openDetail(commit.sha)}>
            <span className="git-unpushed-copy">
              <strong>{commit.subject}</strong>
              <span><code>{commit.short_sha}</code> · {commit.author_name} · <time dateTime={commit.committed_at}>{formatDate(commit.committed_at)}</time></span>
            </span>
          </button>
          <button type="button" className="git-file-diff-action" aria-label={`Abrir diff do commit ${commit.short_sha}`} disabled={blocked} onClick={() => void openDetail(commit.sha)}><Icon name="code" size={11}/><span>Diff</span></button>
        </li>)}
      </ul>
    </>}

    {detail && <CommitDetailModal sessionId={sessionId} detail={detail} onClose={() => setDetail(null)}/>}
  </section>
}

function CommitDetailModal({ sessionId, detail, onClose }: { sessionId: string; detail: GitCommitDetail; onClose: () => void }) {
  const commit = detail.commit
  return createPortal(<div className="git-diff-backdrop" onMouseDown={onClose}>
    <div className="git-diff-modal git-commit-detail-modal" role="dialog" aria-modal="true" aria-label={`Commit ${commit.short_sha}`} onMouseDown={(event) => event.stopPropagation()}>
      <header>
        <div><span className="panel-kicker">Commit local</span><strong>{commit.subject}</strong></div>
        <button type="button" className="agent-drawer-icon" onClick={onClose} aria-label="Fechar detalhes"><Icon name="close" size={13}/></button>
      </header>
      <details className="git-commit-detail-disclosure">
        <summary><span>Metadados do commit</span><code>{commit.short_sha}</code></summary>
        <div className="git-commit-detail-meta">
          <span><strong>SHA</strong><code>{commit.sha}</code></span>
          <span><strong>Autor</strong>{commit.author_name} &lt;{commit.author_email}&gt;</span>
          <span><strong>Data</strong><time dateTime={commit.committed_at}>{formatDate(commit.committed_at, true)}</time></span>
          <span><strong>Pais</strong><code>{commit.parents.length ? commit.parents.join(', ') : 'commit inicial'}</code></span>
          {commit.request_id && <span><strong>Request</strong><code>{commit.request_id}</code></span>}
          {commit.plan_id && <span><strong>Plano</strong><code>{commit.plan_id}</code></span>}
        </div>
        {(commit.body || commit.subject) && <pre className="git-commit-message-inline">{commit.body ? `${commit.subject}\n\n${commit.body}` : commit.subject}</pre>}
      </details>
      <GitDiffReview sessionId={sessionId} diff={detail.diff} emptyText="Este commit não contém alterações de ficheiros."/>
      {detail.diff_truncated && <p className="git-hint">O diff foi truncado apenas para apresentação.</p>}
    </div>
  </div>, document.body)
}

function formatDate(value: string, full = false) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat('pt-PT', full
    ? { dateStyle: 'medium', timeStyle: 'medium' }
    : { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }).format(date)
}

function messageOf(error: unknown) {
  return error instanceof APIError ? error.message : error instanceof Error ? error.message : String(error)
}
