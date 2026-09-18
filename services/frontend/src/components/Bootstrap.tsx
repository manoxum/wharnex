import { FormEvent, useState } from 'react'
import type { AppConfig } from '../types'
import { desktopBridge, isDesktop } from '../lib/desktop'
import { Icon } from './Icon'
import { ThemeToggle } from './ThemeToggle'
import { SignalCore } from './SignalCore'
import { WorkspaceSkeleton } from './Skeleton'

type SetupMode = 'open' | 'create' | 'clone'

export function Bootstrap({ config, busy, error, recent, restoring, onStart, onCreate, onClone }: {
  config?: AppConfig
  busy: boolean
  error?: string
  recent: string[]
  restoring: boolean
  onStart: (path: string) => Promise<void>
  onCreate: (parentPath: string, name: string) => Promise<void>
  onClone: (repositoryURL: string, parentPath: string, directory: string) => Promise<void>
}) {
  const [mode, setMode] = useState<SetupMode>('open')
  const [path, setPath] = useState('')
  const [parent, setParent] = useState('')
  const [name, setName] = useState('')
  const [repository, setRepository] = useState('')
  const [directory, setDirectory] = useState('')

  async function choose(title: string, current = '') {
    const bridge = desktopBridge()
    if (!bridge?.projects) return ''
    const picked = await bridge.projects.pickDirectory({ title, defaultPath: current || undefined })
    return picked.cancelled ? '' : picked.path
  }

  async function openFolder() {
    const selected = await choose('Selecionar projeto', path)
    if (selected) {
      setPath(selected)
      await onStart(selected)
    }
  }

  async function chooseParent() {
    const selected = await choose(mode === 'clone' ? 'Selecionar destino do clone' : 'Selecionar pasta pai', parent)
    if (selected) setParent(selected)
  }

  async function submitCreate(event: FormEvent) {
    event.preventDefault()
    if (parent.trim() && name.trim()) await onCreate(parent.trim(), name.trim())
  }

  async function submitClone(event: FormEvent) {
    event.preventDefault()
    if (repository.trim() && parent.trim()) await onClone(repository.trim(), parent.trim(), directory.trim())
  }

  return (
    <main className="bootstrap-shell">
      <section className="bootstrap-card bootstrap-card-wide">
        <div className="bootstrap-theme-toggle"><ThemeToggle /></div>
        <SignalCore size="watermark" decorative />
        <div className="brand-lockup"><SignalCore size="large" decorative /><div><strong>Wharnex</strong><span>Local Agent Harness</span></div></div>
        <div className="bootstrap-copy">
          <span className="eyebrow">Execution workspace</span>
          <h1>{restoring ? 'A reabrir o seu workspace…' : <>Abra, crie ou clone.<br />O contexto vem depois.</>}</h1>
          <p>{restoring ? 'A recuperar a última sessão e o projeto local.' : 'Escolha o projeto através do explorador nativo. O Wharnex prepara Git, cria whaness.yml quando necessário e monta um contexto enxuto para o agente.'}</p>
        </div>
        {restoring && <div className="bootstrap-restore-preview"><WorkspaceSkeleton/></div>}
        {!restoring && <>
          <div className="project-source-tabs" role="tablist" aria-label="Origem do projeto">
            <button className={mode === 'open' ? 'active' : ''} onClick={() => setMode('open')}><Icon name="folder" size={15}/> Abrir pasta</button>
            <button className={mode === 'create' ? 'active' : ''} onClick={() => setMode('create')}><Icon name="plus" size={15}/> Criar projeto</button>
            <button className={mode === 'clone' ? 'active' : ''} onClick={() => setMode('clone')}><Icon name="git" size={15}/> Clonar Git</button>
          </div>

          {mode === 'open' && <div className="project-form project-form-browser">
            <label>Projeto local</label>
            {isDesktop() ? <button className="project-picker-button" disabled={busy} onClick={() => void openFolder()}>
              <span className="project-picker-icon"><Icon name="folder" size={22}/></span>
              <span><strong>{path || 'Escolher pasta do projeto'}</strong><small>Abre o explorador de pastas do sistema</small></span>
              <Icon name="chevron" size={16}/>
            </button> : <form onSubmit={(event) => { event.preventDefault(); if (path.trim()) void onStart(path.trim()) }} className="input-row">
              <input autoFocus value={path} onChange={(e) => setPath(e.target.value)} placeholder="/home/user/project" spellCheck={false}/>
              <button className="primary-button" disabled={busy || !path.trim()} type="submit">Abrir projeto</button>
            </form>}
          </div>}

          {mode === 'create' && <form onSubmit={submitCreate} className="project-form provision-form">
            <label>Pasta pai</label>
            <div className="path-picker-row"><input value={parent} onChange={(e) => setParent(e.target.value)} placeholder="Escolha pelo explorador" spellCheck={false} readOnly={isDesktop()}/><button type="button" onClick={() => void chooseParent()} disabled={busy}><Icon name="folder" size={15}/> Procurar</button></div>
            <label>Nome do projeto</label>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="meu-projeto" spellCheck={false}/>
            <button className="primary-button provision-submit" disabled={busy || !parent.trim() || !name.trim()} type="submit">{busy ? 'A criar…' : 'Criar e abrir projeto'}</button>
          </form>}

          {mode === 'clone' && <form onSubmit={submitClone} className="project-form provision-form">
            <label>Repositório Git</label>
            <input value={repository} onChange={(e) => setRepository(e.target.value)} placeholder="https://github.com/org/projeto.git" spellCheck={false}/>
            <label>Pasta de destino</label>
            <div className="path-picker-row"><input value={parent} onChange={(e) => setParent(e.target.value)} placeholder="Escolha pelo explorador" spellCheck={false} readOnly={isDesktop()}/><button type="button" onClick={() => void chooseParent()} disabled={busy}><Icon name="folder" size={15}/> Procurar</button></div>
            <label>Nome da pasta <span className="optional-label">opcional</span></label>
            <input value={directory} onChange={(e) => setDirectory(e.target.value)} placeholder="Derivado automaticamente do repositório" spellCheck={false}/>
            <div className="clone-note"><Icon name="git" size={14}/> O clone usa <code>--recurse-submodules</code>; submódulos aninhados são inicializados junto.</div>
            <button className="primary-button provision-submit" disabled={busy || !repository.trim() || !parent.trim()} type="submit">{busy ? 'A clonar…' : 'Clonar e abrir projeto'}</button>
          </form>}

          <div className="bootstrap-meta">
            <span><i className="dot" /> Planner: {config?.planner || '—'}</span><span>Sandbox: {config?.sandbox || '—'}</span><span>Modelo: {config?.model || '—'}</span>
          </div>
          {error && <div className="error-banner">{error}</div>}
          {recent.length > 0 && <div className="recent-workspaces">
            <span className="field-label">Workspaces recentes</span>
            {recent.map((item) => <button key={item} onClick={() => onStart(item)} disabled={busy}><Icon name="workspace" size={15}/><span>{item}</span><Icon name="chevron" size={14}/></button>)}
          </div>}
        </>}
      </section>
    </main>
  )
}
