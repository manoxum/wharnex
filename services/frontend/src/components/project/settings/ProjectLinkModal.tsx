import { FormEvent, useState } from 'react'
import { desktopBridge, isDesktop } from '../../../lib/desktop/bridge/desktop'
import { Icon } from '../../presentation/chrome/Icon'
import { InternalWindow } from '../../workspace/window/InternalWindow'

type Mode = 'recent' | 'create' | 'clone'

export function ProjectLinkModal({ recent, boundProjects, busy, error, onOpen, onBrowse, onCreate, onClone, onClose }: {
  recent: string[]
  boundProjects: string[]
  busy: boolean
  error?: string
  onOpen: (projectPath: string) => Promise<boolean>
  onBrowse: () => Promise<boolean>
  onCreate: (parentPath: string, name: string) => Promise<boolean>
  onClone: (repositoryURL: string, parentPath: string, directory: string) => Promise<boolean>
  onClose: () => void
}) {
  const [mode, setMode] = useState<Mode>('recent')
  const [parent, setParent] = useState('')
  const [name, setName] = useState('')
  const [repository, setRepository] = useState('')
  const [directory, setDirectory] = useState('')

  async function chooseParent(title: string) {
    const picked = await desktopBridge()?.projects.pickDirectory({ title, defaultPath: parent || undefined })
    if (picked && !picked.cancelled && picked.path) setParent(picked.path)
  }

  async function openRecent(projectPath: string) {
    if (await onOpen(projectPath)) onClose()
  }

  async function browse() {
    if (await onBrowse()) onClose()
  }

  async function create(event: FormEvent) {
    event.preventDefault()
    if (parent.trim() && name.trim() && await onCreate(parent.trim(), name.trim())) onClose()
  }

  async function clone(event: FormEvent) {
    event.preventDefault()
    if (repository.trim() && parent.trim() && await onClone(repository.trim(), parent.trim(), directory.trim())) onClose()
  }

  return <InternalWindow title="Vincular projeto" layerClassName="project-link-backdrop" onClose={onClose} closeDisabled={busy}>
    <section className="project-link-modal" role="dialog" aria-modal="false" aria-labelledby="project-link-title">
      <header>
        <div><span className="panel-kicker">Workspace</span><h2 id="project-link-title">Vincular projeto</h2><p>Retome um projeto usado recentemente ou escolha como adicionar outro a esta janela.</p></div>
        <button type="button" className="agent-drawer-icon" disabled={busy} onClick={onClose} aria-label="Fechar vinculação"><Icon name="close" size={14}/></button>
      </header>

      {mode === 'recent' && <div className="project-link-recent">
        <div className="project-link-section-heading"><strong>Projetos recentes</strong><small>{recent.length ? 'Acesso rápido sem voltar ao localizador de pastas.' : 'Ainda não existem projetos recentes neste perfil.'}</small></div>
        {recent.length > 0 ? <div className="project-link-recent-list">{recent.map((item) => {
          const linked = boundProjects.includes(item)
          return <button type="button" key={item} disabled={busy} onClick={() => void openRecent(item)} title={item}>
            <span className="project-link-recent-icon"><Icon name="workspace" size={16}/></span>
            <span><strong>{projectName(item)}</strong><small>{item}</small></span>
            <em>{linked ? 'Vinculado' : 'Abrir'}</em>
          </button>
        })}</div> : <div className="project-link-empty"><Icon name="workspace" size={20}/><span>Os projetos que abrir aparecerão aqui.</span></div>}
      </div>}

      {mode === 'create' && <form className="project-link-form" onSubmit={create}>
        <div className="project-link-section-heading"><strong>Criar novo projeto</strong><small>O novo projeto é criado e vinculado imediatamente a esta janela.</small></div>
        <label>Pasta pai</label>
        <div className="path-picker-row"><input value={parent} onChange={(event) => setParent(event.target.value)} placeholder="Escolha a pasta de destino" spellCheck={false} readOnly={isDesktop()}/><button type="button" disabled={busy} onClick={() => void chooseParent('Selecionar pasta pai')}><Icon name="folder" size={14}/> Procurar</button></div>
        <label>Nome do projeto</label>
        <input autoFocus value={name} onChange={(event) => setName(event.target.value)} placeholder="meu-projeto" spellCheck={false}/>
        <button className="primary-button" type="submit" disabled={busy || !parent.trim() || !name.trim()}>{busy ? 'A criar…' : 'Criar e vincular'}</button>
      </form>}

      {mode === 'clone' && <form className="project-link-form" onSubmit={clone}>
        <div className="project-link-section-heading"><strong>Clonar projeto Git</strong><small>O clone é preparado e vinculado a esta janela assim que terminar.</small></div>
        <label>Repositório Git</label>
        <input autoFocus value={repository} onChange={(event) => setRepository(event.target.value)} placeholder="https://github.com/org/projeto.git" spellCheck={false}/>
        <label>Pasta de destino</label>
        <div className="path-picker-row"><input value={parent} onChange={(event) => setParent(event.target.value)} placeholder="Escolha a pasta de destino" spellCheck={false} readOnly={isDesktop()}/><button type="button" disabled={busy} onClick={() => void chooseParent('Selecionar destino do clone')}><Icon name="folder" size={14}/> Procurar</button></div>
        <label>Nome da pasta <span className="optional-label">opcional</span></label>
        <input value={directory} onChange={(event) => setDirectory(event.target.value)} placeholder="Derivado do repositório" spellCheck={false}/>
        <button className="primary-button" type="submit" disabled={busy || !repository.trim() || !parent.trim()}>{busy ? 'A clonar…' : 'Clonar e vincular'}</button>
      </form>}

      {error && <div className="project-link-error" role="alert">{error}</div>}
      <footer className="project-link-actions">
        <button type="button" disabled={busy} onClick={() => mode === 'recent' ? void browse() : setMode('recent')}><Icon name={mode === 'recent' ? 'folder' : 'workspace'} size={16}/><span><strong>{mode === 'recent' ? 'Carregar outro' : 'Projetos recentes'}</strong><small>{mode === 'recent' ? 'Escolher uma pasta' : 'Voltar à lista rápida'}</small></span></button>
        <button type="button" className={mode === 'create' ? 'active' : ''} disabled={busy} onClick={() => setMode('create')}><Icon name="plus" size={16}/><span><strong>Criar projeto</strong><small>Novo workspace local</small></span></button>
        <button type="button" className={mode === 'clone' ? 'active' : ''} disabled={busy} onClick={() => setMode('clone')}><Icon name="git" size={16}/><span><strong>Clonar Git</strong><small>Trazer um repositório</small></span></button>
      </footer>
    </section>
  </InternalWindow>
}

function projectName(projectPath: string) { return projectPath.split('/').filter(Boolean).at(-1) || projectPath }
