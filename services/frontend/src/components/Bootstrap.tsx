import { FormEvent, useState } from 'react'
import type { AppConfig } from '../types'
import { Icon } from './Icon'

export function Bootstrap({ config, busy, error, recent, restoring, onStart }: {
  config?: AppConfig
  busy: boolean
  error?: string
  recent: string[]
  restoring: boolean
  onStart: (path: string) => Promise<void>
}) {
  const [path, setPath] = useState('')
  async function submit(event: FormEvent) {
    event.preventDefault()
    if (path.trim()) await onStart(path.trim())
  }
  return (
    <main className="bootstrap-shell">
      <section className="bootstrap-card">
        <div className="brand-lockup"><div className="brand-mark">K</div><div><strong>Wharness</strong><span>Local Agent Harness</span></div></div>
        <div className="bootstrap-copy">
          <span className="eyebrow">Execution workspace</span>
          <h1>{restoring ? 'A reabrir o seu workspace…' : <>Editor e agente.<br />Um único workspace.</>}</h1>
          <p>{restoring ? 'A recuperar a última sessão e o projeto local.' : 'Explore ficheiros, edite código, use um terminal isolado e alterne para o agente quando quiser planeamento e execução assistida por IA.'}</p>
        </div>
        {!restoring && <>
          <form onSubmit={submit} className="project-form">
            <label htmlFor="project-path">Diretório do projeto</label>
            <div className="input-row">
              <input id="project-path" autoFocus value={path} onChange={(e) => setPath(e.target.value)} placeholder="/home/user/project" spellCheck={false} />
              <button className="primary-button" disabled={busy || !path.trim()} type="submit">{busy ? 'A preparar…' : <>Abrir projeto <Icon name="external" size={16}/></>}</button>
            </div>
            <div className="bootstrap-meta">
              <span><i className="dot" /> Planner: {config?.planner || '—'}</span>
              <span>Sandbox: {config?.sandbox || '—'}</span>
              <span>Modelo: {config?.model || '—'}</span>
            </div>
            {error && <div className="error-banner">{error}</div>}
          </form>
          {recent.length > 0 && <div className="recent-workspaces">
            <span className="field-label">Workspaces recentes</span>
            {recent.map((item) => <button key={item} onClick={() => onStart(item)} disabled={busy}><Icon name="workspace" size={15}/><span>{item}</span><Icon name="chevron" size={14}/></button>)}
          </div>}
        </>}
      </section>
    </main>
  )
}
