import { useCallback, useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import type { GitOverview, Session } from '../types'
import { api } from '../lib/api'
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

  const locals = useMemo(() => (overview?.branches || []).filter((item) => !item.remote), [overview])
  const current = locals.find((item) => item.current)
  const remote = current?.upstream?.split('/')[0] || overview?.remotes[0]?.name || ''
  const currentBranch = overview?.detached ? 'HEAD destacado' : overview?.current_branch || 'sem branch'

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
  return <div className="project-git-badge-wrap">
    <button type="button" className={`project-git-badge ${open ? 'active' : ''}`} onClick={() => setOpen((value) => !value)} aria-expanded={open} aria-label={`Git: ${currentBranch}, projeto ${overview?.project_version || 'sem versão'}`}>
      <span className="project-git-branch"><Icon name="git" size={13}/><strong>{currentBranch}</strong></span>
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
