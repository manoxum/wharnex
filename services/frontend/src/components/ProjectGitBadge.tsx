import { useCallback, useEffect, useMemo, useState } from 'react'
import type { GitOverview, Session } from '../types'
import { api } from '../lib/api'
import { Icon } from './Icon'

export function ProjectGitBadge({ session, busy, onSession }: { session: Session; busy: boolean; onSession?: (session: Session) => void }) {
  const [overview, setOverview] = useState<GitOverview>()
  const [open, setOpen] = useState(false)
  const [working, setWorking] = useState(false)
  const [branch, setBranch] = useState('')
  const [notice, setNotice] = useState('')

  const refresh = useCallback(async () => {
    const next = await api.gitOverview(session.id)
    setOverview(next)
    setBranch(next.current_branch || '')
    return next
  }, [session.id])

  useEffect(() => {
    let alive = true
    void api.gitOverview(session.id).then((next) => {
      if (!alive) return
      setOverview(next)
      setBranch(next.current_branch || '')
    }).catch(() => {})
    return () => { alive = false }
  }, [session.id, session.state, session.last_host_applied_at])

  const locals = useMemo(() => (overview?.branches || []).filter((item) => !item.remote), [overview])
  const current = locals.find((item) => item.current)
  const remote = current?.upstream?.split('/')[0] || overview?.remotes[0]?.name || ''
  const currentBranch = overview?.detached ? 'HEAD destacado' : overview?.current_branch || 'sem branch'

  async function run(action: () => Promise<string>, syncSession = false) {
    setWorking(true); setNotice('')
    try {
      const message = await action()
      await refresh()
      if (syncSession && onSession) onSession(await api.getSession(session.id))
      setNotice(message)
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error))
    } finally { setWorking(false) }
  }

  const disabled = busy || working || !overview?.available
  return <div className="project-git-badge-wrap">
    <button type="button" className={`project-git-badge ${open ? 'active' : ''}`} onClick={() => setOpen((value) => !value)} aria-expanded={open} aria-label={`Git: ${currentBranch}, projeto ${overview?.project_version || 'sem versão'}`}>
      <span className="project-git-branch"><Icon name="git" size={13}/><strong>{currentBranch}</strong></span>
      <span className="project-git-version">{overview?.project_version || 'v…'}</span>
      <Icon name="chevron" size={11}/>
    </button>
    {open && <section className="project-git-menu" aria-label="Operações da branch atual">
      <header><div><span>Branch de trabalho</span><strong>{currentBranch}</strong></div><span>{overview?.project_version || '—'}</span></header>
      <label>Alternar branch<select value={branch} disabled={disabled} onChange={(event) => setBranch(event.target.value)}>{locals.map((item) => <option key={item.name} value={item.name}>{item.name}{item.current ? ' · atual' : ''}</option>)}</select></label>
      <div className="project-git-actions">
        <button type="button" disabled={disabled || !branch || branch === overview?.current_branch} onClick={() => void run(async () => { await api.gitSwitch(session.id, branch); return `Branch alterada para ${branch}.` }, true)}><Icon name="bridge" size={12}/> Alternar</button>
        <button type="button" disabled={disabled || !remote} onClick={() => void run(async () => { await api.gitFetch(session.id, remote); return `Fetch de ${remote} concluído.` })}><Icon name="refresh" size={12}/> Fetch</button>
        <button type="button" disabled={disabled || !remote || !overview?.current_branch} onClick={() => void run(async () => { const result = await api.gitPull(session.id, remote, overview?.current_branch || ''); return result.conflict_id ? 'Pull encontrou conflito. Escolha resolução manual ou GPT no chat.' : `Pull: ${result.outcome}.` }, true)}><Icon name="arrow-down" size={12}/> Pull</button>
        <button type="button" disabled={disabled || !remote || !overview?.current_branch} onClick={() => void run(async () => { const result = await api.gitPush(session.id, remote, overview?.current_branch || '', !current?.has_upstream); return result.conflict_id ? 'Push encontrou conflito. Escolha resolução manual ou GPT no chat.' : `Push: ${result.outcome}.` }, true)}><Icon name="arrow-up" size={12}/> Push</button>
      </div>
      {current && <p className="project-git-sync">{current.has_upstream ? `${current.upstream} · ↑${current.ahead} ↓${current.behind}` : 'Sem upstream configurado'}</p>}
      {notice && <p className="project-git-notice" role="status">{notice}</p>}
    </section>}
  </div>
}
