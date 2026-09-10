import { useCallback, useEffect, useMemo, useState } from 'react'
import type { GitCommitMode, GitOverview, GitPendingCommit, Session } from '../types'
import { api, APIError } from '../lib/api'
import { Icon } from './Icon'

/**
 * The project's Git surface: what happens to history after an Apply, what is
 * waiting to be committed, and the branch operations a human drives.
 *
 * Everything here is an explicit human action. None of it is reachable from a
 * model plan — those still go through Policy and Protected execution — which
 * is why committing, pushing and merging live on this panel rather than
 * becoming plan operations.
 */
export function GitDrawer({ session, busy, onClose, onError }: {
  session: Session
  busy: boolean
  onClose: () => void
  onError?: (message: string) => void
}) {
  const [overview, setOverview] = useState<GitOverview | null>(null)
  const [loading, setLoading] = useState(true)
  const [working, setWorking] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [notice, setNotice] = useState('')
  const [openDiff, setOpenDiff] = useState<GitPendingCommit | null>(null)
  const [mergeRef, setMergeRef] = useState('')

  const report = useCallback((error: unknown) => {
    const message = error instanceof APIError ? error.message : error instanceof Error ? error.message : String(error)
    setNotice(message)
    onError?.(message)
  }, [onError])

  const refresh = useCallback(async () => {
    try {
      setOverview(await api.gitOverview(session.id))
    } catch (error) {
      report(error)
    } finally {
      setLoading(false)
    }
  }, [session.id, report])

  useEffect(() => { void refresh() }, [refresh])

  // Applying a change is what creates pending records, so the panel follows the
  // session's apply timestamp rather than polling on a timer.
  useEffect(() => { void refresh() }, [session.last_host_applied_at, session.state, refresh])

  const localBranches = useMemo(() => (overview?.branches || []).filter((branch) => !branch.remote), [overview])
  const remoteBranches = useMemo(() => (overview?.branches || []).filter((branch) => branch.remote), [overview])
  const current = useMemo(() => localBranches.find((branch) => branch.current), [localBranches])
  const pending = overview?.pending || []

  async function run(action: () => Promise<void>) {
    setWorking(true)
    setNotice('')
    try {
      await action()
      await refresh()
    } catch (error) {
      report(error)
    } finally {
      setWorking(false)
    }
  }

  const disabled = busy || working || loading

  function toggle(id: string) {
    setSelected((currentSelection) => {
      const next = new Set(currentSelection)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  async function commit(ids: string[]) {
    await run(async () => {
      const result = await api.commitGitPending(session.id, ids)
      setSelected(new Set())
      const made = result.outcomes.filter((outcome) => outcome.commit_sha).length
      const skipped = result.outcomes.filter((outcome) => outcome.skipped).length
      setNotice(`${made} commit(s) criado(s)${skipped ? `, ${skipped} registo(s) obsoleto(s) retirado(s)` : ''}.`)
    })
  }

  return <section className="git-drawer" aria-label="Git do projeto">
    <header className="agent-drawer-heading">
      <div><span className="panel-kicker">Repositório</span><strong>Git do projeto</strong></div>
      <div className="git-heading-actions">
        <button type="button" className="agent-drawer-icon" disabled={disabled} onClick={() => void refresh()} aria-label="Atualizar estado do Git"><Icon name="refresh" size={13}/></button>
        <button type="button" className="agent-drawer-icon" onClick={onClose} aria-label="Fechar Git"><Icon name="close" size={13}/></button>
      </div>
    </header>

    {loading && <p className="git-empty">A ler o estado do repositório…</p>}
    {!loading && overview && !overview.available && (
      <p className="git-empty warning-card">Não foi possível inspecionar o repositório: {overview.unavailable}</p>
    )}
    {notice && <p className="git-notice" role="status">{notice}</p>}

    {overview?.available && <>
      <CommitModeSection overview={overview} disabled={disabled} onChange={(mode) => run(async () => {
        await api.setGitCommitMode(session.id, mode)
      })}/>

      {overview.conflict && <div className="git-conflict-card warning-card">
        <strong>Conflito de Git em resolução</strong>
        <p>A integrar <code>{overview.conflict.ref}</code>. O pedido de resolução está no chat; assim que a resposta chegar, o merge é concluído e commitado localmente.</p>
      </div>}

      {overview.in_progress && <p className="git-notice warning-card">
        Há um <strong>{overview.in_progress}</strong> em curso no host. Termine-o ou aborte-o antes de aplicar ou fazer merge.
      </p>}

      <BranchSection
        current={current?.name || overview.current_branch}
        detached={overview.detached}
        localBranches={localBranches}
        remoteBranches={remoteBranches}
        remotes={overview.remotes}
        disabled={disabled}
        mergeRef={mergeRef}
        onMergeRefChange={setMergeRef}
        onMerge={() => run(async () => {
          const result = await api.gitMerge(session.id, mergeRef)
          setMergeRef('')
          setNotice(result.conflict_id
            ? `Merge de ${result.ref} entrou em conflito; foi pedida uma resolução ao ChatGPT.`
            : `Merge de ${result.ref}: ${result.outcome}.`)
        })}
        onPush={(remote, branch, setUpstream) => run(async () => {
          const result = await api.gitPush(session.id, remote, branch, setUpstream)
          setNotice(pushMessage(result.outcome, result.integrated, result.conflict_id))
        })}
      />

      <PendingSection
        pending={pending}
        selected={selected}
        disabled={disabled}
        hasIdentity={overview.has_identity}
        commitMode={overview.commit_mode}
        onToggle={toggle}
        onCommitAll={() => void commit([])}
        onCommitSelected={() => void commit(Array.from(selected))}
        onDiscard={(id) => void run(async () => { await api.discardGitPending(session.id, [id]) })}
        onOpenDiff={(record) => void (async () => {
          try {
            setOpenDiff(await api.gitPendingCommit(session.id, record.id))
          } catch (error) { report(error) }
        })()}
      />

      <HistorySection commits={overview.commits} />
    </>}

    {openDiff && <DiffModal record={openDiff} onClose={() => setOpenDiff(null)} />}
  </section>
}

function pushMessage(outcome: string, integrated?: boolean, conflictID?: string) {
  if (conflictID) return 'O remoto tinha trabalho que entrou em conflito; foi pedida uma resolução ao ChatGPT. Nada foi publicado.'
  switch (outcome) {
    case 'pushed': return integrated ? 'Trabalho do remoto integrado e push concluído.' : 'Push concluído.'
    case 'up_to_date': return 'O remoto já estava atualizado.'
    case 'auth_required': return 'O remoto pediu credenciais. Configure um credential helper do Git e repita.'
    case 'rejected': return 'O remoto rejeitou o push e a integração automática não foi possível.'
    default: return `Push: ${outcome}.`
  }
}

function CommitModeSection({ overview, disabled, onChange }: {
  overview: GitOverview
  disabled: boolean
  onChange: (mode: GitCommitMode) => void
}) {
  return <section className="git-section">
    <h4>Modo de commit</h4>
    <div className="git-mode-switch" role="group" aria-label="Modo de commit">
      <button type="button" className={overview.commit_mode === 'auto' ? 'active' : ''} disabled={disabled || overview.commit_mode_fixed} onClick={() => onChange('auto')}>
        <Icon name="check" size={13}/> Auto-commit
      </button>
      <button type="button" className={overview.commit_mode === 'manual' ? 'active' : ''} disabled={disabled || overview.commit_mode_fixed} onClick={() => onChange('manual')}>
        <Icon name="clipboard" size={13}/> Sem auto-commit
      </button>
    </div>
    <p className="git-hint">
      {overview.commit_mode === 'auto'
        ? 'Cada alteração aplicada e verificada fica commitada de imediato no histórico local.'
        : 'As alterações aplicadas ficam no worktree por commitar. A mensagem de commit e o diff são guardados para os fazer à mão.'}
    </p>
    {overview.commit_mode_fixed && <p className="git-hint">A auto-evolução do Wharnex commita sempre: o rollback e a ativação assentam em commits reais.</p>}
    {!overview.has_identity && <p className="git-hint warning-card">O repositório não tem <code>user.name</code>/<code>user.email</code> configurados; os commits manuais vão falhar até os definir.</p>}
  </section>
}

function BranchSection({ current, detached, localBranches, remoteBranches, remotes, disabled, mergeRef, onMergeRefChange, onMerge, onPush }: {
  current?: string
  detached: boolean
  localBranches: GitOverview['branches']
  remoteBranches: GitOverview['branches']
  remotes: GitOverview['remotes']
  disabled: boolean
  mergeRef: string
  onMergeRefChange: (value: string) => void
  onMerge: () => void
  onPush: (remote: string, branch: string, setUpstream: boolean) => void
}) {
  const active = localBranches.find((branch) => branch.current)
  const defaultRemote = remotes[0]?.name || 'origin'
  const canPush = Boolean(current) && !detached && remotes.length > 0
  return <section className="git-section">
    <h4>Branches</h4>
    <p className="git-current-branch">
      <Icon name="git" size={13}/>
      <strong>{detached ? 'HEAD destacado' : current || '—'}</strong>
      {active?.has_upstream && <span className="git-track">↑{active.ahead} ↓{active.behind} · {active.upstream}</span>}
      {active && !active.has_upstream && <span className="git-track">sem upstream</span>}
    </p>

    {canPush && active && <div className="git-row">
      <button type="button" className="git-action" disabled={disabled} onClick={() => onPush(defaultRemote, active.name, !active.has_upstream)}>
        <Icon name="arrow-up" size={13}/> Push para {defaultRemote}/{active.name}
      </button>
    </div>}

    <div className="git-row">
      <label className="sr-only" htmlFor="git-merge-ref">Branch a fazer merge</label>
      <select id="git-merge-ref" value={mergeRef} disabled={disabled} onChange={(event) => onMergeRefChange(event.target.value)}>
        <option value="">Fazer merge de…</option>
        {[...localBranches.filter((branch) => !branch.current), ...remoteBranches].map((branch) => (
          <option key={branch.name} value={branch.name}>{branch.name}</option>
        ))}
      </select>
      <button type="button" className="git-action" disabled={disabled || !mergeRef} onClick={onMerge}>
        <Icon name="bridge" size={13}/> Merge
      </button>
    </div>

    <ul className="git-branch-list">
      {localBranches.map((branch) => (
        <li key={branch.name} className={branch.current ? 'current' : ''}>
          <span className="git-branch-name">{branch.name}</span>
          <span className="git-branch-subject">{branch.subject}</span>
        </li>
      ))}
      {remoteBranches.map((branch) => (
        <li key={branch.name} className="remote">
          <span className="git-branch-name">{branch.name}</span>
          <span className="git-branch-subject">{branch.subject}</span>
        </li>
      ))}
    </ul>
  </section>
}

function PendingSection({ pending, selected, disabled, hasIdentity, commitMode, onToggle, onCommitAll, onCommitSelected, onDiscard, onOpenDiff }: {
  pending: GitPendingCommit[]
  selected: Set<string>
  disabled: boolean
  hasIdentity: boolean
  commitMode: GitCommitMode
  onToggle: (id: string) => void
  onCommitAll: () => void
  onCommitSelected: () => void
  onDiscard: (id: string) => void
  onOpenDiff: (record: GitPendingCommit) => void
}) {
  return <section className="git-section">
    <h4>Commits pendentes <span className="tab-count">{pending.length}</span></h4>
    {pending.length === 0 && <p className="git-empty">
      {commitMode === 'manual'
        ? 'Nada por commitar. As alterações aplicadas aparecem aqui com a mensagem que o planner escreveu.'
        : 'Este projeto commita automaticamente, por isso não acumula pendentes.'}
    </p>}
    {pending.length > 0 && <>
      <div className="git-row">
        <button type="button" className="git-action primary" disabled={disabled || !hasIdentity} onClick={onCommitAll}>
          <Icon name="check" size={13}/> Commitar todos
        </button>
        <button type="button" className="git-action" disabled={disabled || !hasIdentity || selected.size === 0} onClick={onCommitSelected}>
          <Icon name="check" size={13}/> Commitar selecionados ({selected.size})
        </button>
      </div>
      <ul className="git-pending-list">
        {pending.map((record) => (
          <li key={record.id}>
            <label className="git-pending-head">
              <input type="checkbox" checked={selected.has(record.id)} disabled={disabled} onChange={() => onToggle(record.id)} />
              <span className="git-pending-subject">{record.subject}</span>
            </label>
            <p className="git-pending-paths">{record.paths.join(', ')}</p>
            <div className="git-row">
              <button type="button" className="git-action small" disabled={disabled} onClick={() => onOpenDiff(record)}><Icon name="file" size={12}/> Ver diff</button>
              <button type="button" className="git-action small danger" disabled={disabled} onClick={() => onDiscard(record.id)} title="Remove apenas o registo; os ficheiros ficam intactos">
                <Icon name="trash" size={12}/> Descartar registo
              </button>
            </div>
          </li>
        ))}
      </ul>
    </>}
  </section>
}

function HistorySection({ commits }: { commits: GitOverview['commits'] }) {
  return <section className="git-section">
    <h4>Histórico</h4>
    {commits.length === 0 && <p className="git-empty">Sem commits.</p>}
    <ul className="git-commit-list">
      {commits.map((commit) => (
        <li key={commit.sha}>
          <span className={`git-commit-dot ${commit.pushed ? 'pushed' : 'local'}`} title={commit.pushed ? 'Enviado para o upstream' : 'Ainda local'} />
          <span className="git-commit-subject">{commit.subject}</span>
          <span className="git-commit-meta">
            {commit.short_sha}
            {commit.wharnex && <span className="git-commit-tag" title="Originado por uma alteração do Wharnex">WHX</span>}
            {commit.merge && <span className="git-commit-tag">merge</span>}
          </span>
        </li>
      ))}
    </ul>
  </section>
}

function DiffModal({ record, onClose }: { record: GitPendingCommit; onClose: () => void }) {
  return <div className="git-diff-modal" role="dialog" aria-label={`Diff de ${record.subject}`}>
    <header>
      <strong>{record.subject}</strong>
      <button type="button" className="agent-drawer-icon" onClick={onClose} aria-label="Fechar diff"><Icon name="close" size={13}/></button>
    </header>
    <pre className="git-diff-body">{record.diff || 'Sem diff registado.'}</pre>
    {record.diff_truncated && <p className="git-hint">O diff foi truncado para apresentação; o commit usa sempre o conteúdo atual dos ficheiros.</p>}
    <details className="git-message-preview">
      <summary>Mensagem de commit</summary>
      <pre>{record.message}</pre>
    </details>
  </div>
}
