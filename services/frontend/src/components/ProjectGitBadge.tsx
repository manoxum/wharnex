import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { GitOverview, Session } from '../types'
import { api } from '../lib/api'
import { announceHeaderPopover, subscribeOtherHeaderPopover } from '../lib/headerPopover'
import { Icon } from './Icon'
import { GitOperationModal, type GitOperation } from './GitOperationModal'

export function ProjectGitBadge({ session, sessionID, busy, onSession, onSync }: { session?: Session; sessionID?: string; busy: boolean; onSession?: (session: Session) => void; onSync?: () => void }) {
  const id = session?.id || sessionID || ''
  const [overview, setOverview] = useState<GitOverview>()
  const [open, setOpen] = useState(false)
  const [working, setWorking] = useState(false)
  const [branch, setBranch] = useState('')
  const [notice, setNotice] = useState('')
  const [operation, setOperation] = useState<GitOperation | null>(null)
  const rootRef = useRef<HTMLDivElement>(null)
  const autoFetchRunning = useRef(false)

  const refresh = useCallback(async () => {
    if (!id) throw new Error('Sessão Git ainda não disponível.')
    const next = await api.gitOverview(id)
    setOverview(next)
    setBranch(next.current_branch || '')
    return next
  }, [id])

  useEffect(() => {
    let alive = true
    if (!id) { setOverview(undefined); setBranch(''); return }
    void api.gitOverview(id).then((next) => {
      if (!alive) return
      setOverview(next)
      setBranch(next.current_branch || '')
    }).catch(() => {})
    return () => { alive = false }
  }, [id, session?.state, session?.last_host_applied_at])

  useEffect(() => {
    if (!id) return
    let alive = true
    const timer = window.setInterval(() => {
      if (busy || working || autoFetchRunning.current) return
      autoFetchRunning.current = true
      void (async () => {
        try {
          const snapshot = await api.gitOverview(id)
          if (!snapshot.available || snapshot.remotes.length === 0) return
          for (const remote of snapshot.remotes) await api.gitFetch(id, remote.name)
          const updated = await api.gitOverview(id)
          if (alive) setOverview(updated)
        } catch {
          // Periodic remote refresh is best-effort; explicit actions report failures.
        } finally {
          autoFetchRunning.current = false
        }
      })()
    }, 60_000)
    return () => {
      alive = false
      window.clearInterval(timer)
    }
  }, [id, busy, working])

  useEffect(() => subscribeOtherHeaderPopover('git', () => setOpen(false)), [])

  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: PointerEvent) => {
      if (event.target instanceof Node && !rootRef.current?.contains(event.target)) setOpen(false)
    }
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpen(false) }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  const locals = useMemo(() => (overview?.branches || []).filter((item) => !item.remote), [overview])
  const current = locals.find((item) => item.current)
  const remote = current?.upstream?.split('/')[0] || overview?.remotes[0]?.name || ''
  const currentBranch = overview?.detached ? 'HEAD destacado' : overview?.current_branch || 'sem branch'
  const workingCount = overview?.working.files.length || overview?.working.stageable_count || 0
  const pendingCommitCount = overview?.pending.length || 0
  const outgoingCount = current?.has_upstream && !current.gone ? current.ahead : (overview?.commits || []).filter((commit) => !commit.pushed).length
  const gitStateLabel = gitProjectStateLabel(workingCount, pendingCommitCount, outgoingCount)

  async function run(action: () => Promise<string>, syncSession = false) {
    setWorking(true); setNotice('')
    try {
      const message = await action()
      await refresh()
      if (syncSession && onSession) onSession(await api.getSession(id))
      if (syncSession) onSync?.()
      setNotice(message)
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error))
    } finally { setWorking(false) }
  }

  async function runGitOperation(title: string, detail: string, action: () => Promise<string>, syncSession = false) {
    let phase: 'running' | 'refreshing' = 'running'
    let actionMessage = ''
    setWorking(true); setNotice('')
    setOperation({ title, detail, phase })
    try {
      actionMessage = await action()
      phase = 'refreshing'
      setOperation({ title, detail, phase })
      await refresh()
      if (syncSession && onSession) onSession(await api.getSession(id))
      if (syncSession) onSync?.()
      setNotice(actionMessage)
      setOperation({ title, detail, phase: 'success', message: actionMessage })
    } catch (error) {
      const cause = error instanceof Error ? error.message : String(error)
      const message = phase === 'refreshing' && actionMessage ? `${actionMessage} Não foi possível atualizar o painel: ${cause}` : cause
      setNotice(message)
      setOperation({ title, detail, phase: 'error', message, failedPhase: phase })
    } finally { setWorking(false) }
  }

  const disabled = busy || working || !id || !overview?.available
  return <div ref={rootRef} className="project-git-badge-wrap">
    <button type="button" className={`project-git-badge ${workingCount ? 'has-working' : ''} ${pendingCommitCount ? 'has-pending-commit' : ''} ${outgoingCount ? 'has-outgoing' : ''} ${open ? 'active' : ''}`.trim()} onClick={() => { if (!open) announceHeaderPopover('git'); setOpen((value) => !value) }} aria-expanded={open} aria-label={`Git: ${currentBranch}, projeto ${overview?.project_version || 'sem versão'}`}>
      <span className="project-git-branch"><span className="project-git-icon"><Icon name="git" size={13}/>{gitStateLabel && <span className="project-git-state-dots" aria-label={gitStateLabel}>{workingCount ? <i className="working" title={`${workingCount} alteração${workingCount === 1 ? '' : 'ões'} sem commit`}/> : null}{pendingCommitCount ? <i className="pending" title={`${pendingCommitCount} commit${pendingCommitCount === 1 ? '' : 's'} pendente${pendingCommitCount === 1 ? '' : 's'}`}/> : null}{outgoingCount ? <i className="outgoing" title={`${outgoingCount} commit${outgoingCount === 1 ? '' : 's'} por enviar`}/> : null}</span>}</span><strong>{currentBranch}</strong></span>
      <span className="project-git-version">{overview?.project_version || 'v…'}</span>
      <Icon name="chevron" size={11}/>
    </button>
    {open && <section className="project-git-menu" aria-label="Operações da branch atual">
      <header><div><span>Branch de trabalho</span><strong>{currentBranch}</strong></div><span className="project-git-menu-version">{overview?.project_version || '—'}</span></header>
      <label>Alternar branch<select value={branch} disabled={disabled} onChange={(event) => setBranch(event.target.value)}>{locals.map((item) => <option key={item.name} value={item.name}>{item.name}{item.current ? ' · atual' : ''}</option>)}</select></label>
      <div className="project-git-actions">
        <button type="button" disabled={disabled || !branch || branch === overview?.current_branch} onClick={() => void run(async () => { await api.gitSwitch(id, branch); return `Branch alterada para ${branch}.` }, true)}><Icon name="bridge" size={12}/> Alternar</button>
        <button type="button" disabled={disabled || !remote} onClick={() => void runGitOperation(
          'A procurar alterações na origem',
          `A atualizar as referências remotas a partir de ${remote}.`,
          async () => { await api.gitFetch(id, remote); return `Fetch de ${remote} concluído.` },
        )}><Icon name="refresh" size={12}/> Fetch</button>
        <button type="button" disabled={disabled || !remote || !overview?.current_branch} onClick={() => void runGitOperation(
          'A integrar alterações da origem',
          `A trazer ${remote}/${overview?.current_branch || ''} para a branch local.`,
          async () => { const result = await api.gitPull(id, remote, overview?.current_branch || ''); return result.conflict_id ? 'Pull encontrou conflito. Escolha resolução manual ou GPT no chat.' : `Pull: ${result.outcome}.` },
          true,
        )}><Icon name="arrow-down" size={12}/> Pull</button>
        <button type="button" disabled={disabled || !remote || !overview?.current_branch} onClick={() => void runGitOperation(
          'A publicar alterações',
          `A enviar ${overview?.current_branch || ''} para ${remote}${!current?.has_upstream ? ' e a configurar o upstream' : ''}.`,
          async () => { const result = await api.gitPush(id, remote, overview?.current_branch || '', !current?.has_upstream); return result.conflict_id ? 'Push encontrou conflito. Escolha resolução manual ou GPT no chat.' : `Push: ${result.outcome}.` },
          true,
        )}><Icon name="arrow-up" size={12}/> Push</button>
      </div>
      {current && <p className="project-git-sync">{current.has_upstream ? `${current.upstream} · ↑${current.ahead} ↓${current.behind}` : 'Sem upstream configurado'}</p>}
      {notice && <p className="project-git-notice" role="status">{notice}</p>}
    </section>}
    {operation && createPortal(
      <div className="project-git-operation-layer"><GitOperationModal operation={operation} onClose={() => setOperation(null)}/></div>,
      document.body,
    )}
  </div>
}

function gitProjectStateLabel(working: number, pending: number, outgoing: number) {
  const parts: string[] = []
  if (working) parts.push(`${working} alteração${working === 1 ? '' : 'ões'} sem commit`)
  if (pending) parts.push(`${pending} commit${pending === 1 ? '' : 's'} pendente${pending === 1 ? '' : 's'}`)
  if (outgoing) parts.push(`${outgoing} commit${outgoing === 1 ? '' : 's'} por enviar`)
  return parts.join(' · ')
}
