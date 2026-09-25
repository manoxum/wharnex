import { FormEvent, useMemo, useState } from 'react'
import type { CSSProperties } from 'react'
import type { AppConfig } from '../types'
import { desktopBridge, isDesktop } from '../lib/desktop'
import { confirmDialog, noticeDialog } from '../lib/appDialog'
import { loadProjectLogo, removeRecent, savePendingProjectPrompt, saveProjectLogo } from '../lib/workspaceMemory'
import { Icon } from './Icon'
import { ThemeToggle } from './ThemeToggle'
import { SignalCore } from './SignalCore'
import { WorkspaceSkeleton } from './Skeleton'

type SetupMode = 'open' | 'create' | 'clone' | ''

export function Bootstrap({ config, busy, error, recent, restoring, onStart, onCreate, onClone, onBootstrap, onRecentChanged }: {
  config?: AppConfig
  busy: boolean
  error?: string
  recent: string[]
  restoring: boolean
  onStart: (path: string) => Promise<void>
  onCreate: (parentPath: string, name: string) => Promise<void>
  onClone: (repositoryURL: string, parentPath: string, directory: string) => Promise<void>
  onBootstrap?: (parentPath: string, name: string, prompt: string) => Promise<void>
  onRecentChanged?: () => void
}) {
  const [mode, setMode] = useState<SetupMode>('')
  const [path, setPath] = useState('')
  const [parent, setParent] = useState(() => parentDirectory(recent[0] || ''))
  const [name, setName] = useState('')
  const [repository, setRepository] = useState('')
  const [directory, setDirectory] = useState('')
  const [briefing, setBriefing] = useState('')
  const [logoRevision, setLogoRevision] = useState(0)
  const suggestedName = useMemo(() => name.trim() || projectSlug(briefing), [name, briefing])

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

  async function chooseParent(title = mode === 'clone' ? 'Selecionar destino do clone' : 'Selecionar pasta pai') {
    const selected = await choose(title, parent)
    if (selected) setParent(selected)
    return selected
  }

  async function submitCreate(event: FormEvent) {
    event.preventDefault()
    if (parent.trim() && name.trim()) await onCreate(parent.trim(), name.trim())
  }

  async function submitClone(event: FormEvent) {
    event.preventDefault()
    if (repository.trim() && parent.trim()) await onClone(repository.trim(), parent.trim(), directory.trim())
  }

  async function submitBriefing(event: FormEvent) {
    event.preventDefault()
    if (!briefing.trim() || !onBootstrap) return
    let destination = parent.trim()
    if (!destination && isDesktop()) destination = await chooseParent('Selecionar workspace para o novo projeto')
    if (!destination) return
    setParent(destination)
    await onBootstrap(destination, suggestedName, buildBootstrapPrompt(briefing))
  }

  async function openRecent(projectPath: string) {
    const windows = desktopBridge()?.windows
    try {
      if (!windows?.open) { await onStart(projectPath); return }
      try {
        const snapshot = await windows.projects?.()
        const existing = snapshot?.items.find((item) => item.projectPath === projectPath)
        if (existing) { await windows.focusProject(projectPath); return }
      } catch { /* a stale window snapshot should not block opening the project */ }
      await windows.open({ projectPath })
    } catch (reason) {
      await noticeDialog({ title: 'Não foi possível abrir o projeto', message: messageOf(reason), tone: 'danger' })
    }
  }

  function forgetRecent(projectPath: string) {
    removeRecent(projectPath)
    onRecentChanged?.()
  }

  async function deleteRecent(projectPath: string) {
    if (!(await confirmDialog({ title: `Eliminar ${projectName(projectPath)}?`, message: 'O projeto será movido para o lixo do sistema e removido da lista de recentes.', tone: 'danger', confirmLabel: 'Mover para o lixo' }))) return
    const bridge = desktopBridge()
    if (!bridge?.projects.trash) return
    try {
      await bridge.projects.trash(projectPath)
      removeRecent(projectPath)
      saveProjectLogo(projectPath, '')
      onRecentChanged?.()
    } catch (reason) {
      await noticeDialog({ title: 'Não foi possível eliminar o projeto', message: messageOf(reason), tone: 'danger' })
    }
  }

  async function chooseLogo(projectPath: string) {
    try {
      const picked = await desktopBridge()?.projects.pickImage?.({ title: `Logo de ${projectName(projectPath)}` })
      if (!picked || picked.cancelled || !picked.dataURL) return
      saveProjectLogo(projectPath, picked.dataURL)
      setLogoRevision((value) => value + 1)
    } catch (reason) {
      await noticeDialog({ title: 'Não foi possível alterar o logotipo', message: messageOf(reason), tone: 'danger' })
    }
  }

  async function askGPTForLogos(projectPath: string) {
    savePendingProjectPrompt(projectPath, logoGenerationPrompt(projectPath))
    await openRecent(projectPath)
  }

  return (
    <main className="bootstrap-shell bootstrap-home">
      <div className="bootstrap-home-shell">
        <header className="bootstrap-home-header">
          <div className="brand-lockup bootstrap-home-brand"><SignalCore size="large" decorative /><div><strong>Wharnex</strong><span>Local Agent Harness</span></div></div>
          <div className="bootstrap-theme-toggle"><ThemeToggle /></div>
        </header>

        {restoring ? <section className="bootstrap-home-restoring"><WorkspaceSkeleton/></section> : <>
          <section className="bootstrap-prompt-card">
            <div className="bootstrap-prompt-heading"><span className="bootstrap-prompt-icon"><Icon name="sparkles" size={19}/></span><div><strong>Novo projeto</strong><small>Comece pelo que quer construir.</small></div></div>
            <form onSubmit={submitBriefing}>
              <textarea aria-label="Descrever novo projeto" autoFocus value={briefing} onChange={(event) => setBriefing(event.target.value)} placeholder="Descreva a aplicação, site, serviço ou ferramenta que quer criar…" rows={6} />
              <div className="bootstrap-prompt-controls">
                <button type="button" className="bootstrap-destination" onClick={() => void chooseParent('Selecionar workspace para o novo projeto')} title="Alterar pasta de destino"><Icon name="folder" size={14}/><span>{parent ? compactPath(parent) : 'Escolher workspace'}</span></button>
                <label className="bootstrap-project-name"><span>Nome</span><input aria-label="Nome do novo projeto" value={name} onChange={(event) => setName(event.target.value)} placeholder={projectSlug(briefing)} spellCheck={false}/></label>
                <button className="bootstrap-prompt-submit" disabled={busy || !briefing.trim() || !onBootstrap} type="submit" aria-label="Criar projeto a partir deste prompt" title="Criar projeto"><Icon name="arrow-up" size={18}/></button>
              </div>
            </form>
          </section>

          <section className="bootstrap-quick-actions" aria-label="Ações de projeto">
            <button className={mode === 'open' ? 'active' : ''} onClick={() => setMode(mode === 'open' ? '' : 'open')}><span><Icon name="folder" size={19}/></span><strong>Abrir pasta</strong><small>Projeto existente</small></button>
            <button className={mode === 'create' ? 'active' : ''} onClick={() => setMode(mode === 'create' ? '' : 'create')}><span><Icon name="plus" size={19}/></span><strong>Criar projeto</strong><small>Pasta vazia</small></button>
            <button className={mode === 'clone' ? 'active' : ''} onClick={() => setMode(mode === 'clone' ? '' : 'clone')}><span><Icon name="git" size={19}/></span><strong>Clonar Git</strong><small>Repositório remoto</small></button>
          </section>

          {mode && <section className="bootstrap-inline-provision">
            {mode === 'open' && <div className="project-form project-form-browser">
              {isDesktop() ? <button className="project-picker-button" disabled={busy} onClick={() => void openFolder()}>
                <span className="project-picker-icon"><Icon name="folder" size={20}/></span><span><strong>{path || 'Escolher pasta do projeto'}</strong><small>Abre noutra área de trabalho</small></span><Icon name="chevron" size={16}/>
              </button> : <form onSubmit={(event) => { event.preventDefault(); if (path.trim()) void onStart(path.trim()) }} className="input-row"><input value={path} onChange={(event) => setPath(event.target.value)} placeholder="/home/user/project" spellCheck={false}/><button className="primary-button" disabled={busy || !path.trim()} type="submit">Abrir</button></form>}
            </div>}
            {mode === 'create' && <form onSubmit={submitCreate} className="project-form provision-form bootstrap-inline-form">
              <div className="path-picker-row"><input value={parent} onChange={(event) => setParent(event.target.value)} placeholder="Pasta pai" spellCheck={false} readOnly={isDesktop()}/><button type="button" onClick={() => void chooseParent()} disabled={busy}><Icon name="folder" size={15}/> Procurar</button></div>
              <input value={name} onChange={(event) => setName(event.target.value)} placeholder="Nome do projeto" spellCheck={false}/><button className="primary-button" disabled={busy || !parent.trim() || !name.trim()} type="submit">Criar e abrir</button>
            </form>}
            {mode === 'clone' && <form onSubmit={submitClone} className="project-form provision-form bootstrap-inline-form">
              <input value={repository} onChange={(event) => setRepository(event.target.value)} placeholder="https://github.com/org/projeto.git" spellCheck={false}/><div className="path-picker-row"><input value={parent} onChange={(event) => setParent(event.target.value)} placeholder="Destino" spellCheck={false} readOnly={isDesktop()}/><button type="button" onClick={() => void chooseParent()} disabled={busy}><Icon name="folder" size={15}/> Procurar</button></div><input value={directory} onChange={(event) => setDirectory(event.target.value)} placeholder="Nome da pasta (opcional)" spellCheck={false}/><button className="primary-button" disabled={busy || !repository.trim() || !parent.trim()} type="submit">Clonar e abrir</button>
            </form>}
          </section>}

          {error && <div className="error-banner bootstrap-home-error">{error}</div>}

          <section className="bootstrap-recents-section">
            <div className="bootstrap-section-heading"><div><strong>Projetos recentes</strong><small>{recent.length ? (recent.length === 1 ? '1 disponível' : `${recent.length} disponíveis`) : 'Os projetos abertos aparecem aqui.'}</small></div><span className="bootstrap-meta-inline">{config?.model || ''}</span></div>
            {recent.length ? <div className="bootstrap-project-grid">
              {recent.map((item) => {
                const logo = loadProjectLogo(item)
                return <article className="bootstrap-project-card" key={`${item}:${logoRevision}`} style={projectAccentStyle(item)}>
                  <button type="button" className="bootstrap-project-open" disabled={busy} onClick={() => void openRecent(item)}>
                    <ProjectMark projectPath={item} logo={logo}/><span className="bootstrap-project-copy"><strong>{projectName(item)}</strong><small>{compactPath(item)}</small></span><Icon name="external" size={14}/>
                  </button>
                  <div className="bootstrap-project-card-actions">
                    <button type="button" disabled={busy} onClick={() => forgetRecent(item)} title="Remover dos recentes" aria-label={`Remover ${projectName(item)} dos recentes`}><Icon name="close" size={13}/></button>
                    <button type="button" disabled={busy || !isDesktop()} onClick={() => void chooseLogo(item)} title="Alterar logotipo" aria-label={`Alterar logotipo de ${projectName(item)}`}><Icon name="image" size={13}/></button>
                    <button type="button" disabled={busy} onClick={() => void askGPTForLogos(item)} title="Pedir 16 opções de logotipo ao GPT" aria-label={`Pedir opções de logotipo para ${projectName(item)}`}><Icon name="sparkles" size={13}/></button>
                    <button type="button" disabled={busy || !isDesktop()} onClick={() => void deleteRecent(item)} title="Mover projeto para o lixo" aria-label={`Eliminar ${projectName(item)}`}><Icon name="trash" size={13}/></button>
                  </div>
                </article>
              })}
            </div> : <div className="bootstrap-empty-recents"><Icon name="workspace" size={21}/><span>Abra uma pasta ou descreva o primeiro projeto.</span></div>}
          </section>
        </>}
      </div>
    </main>
  )
}

function ProjectMark({ projectPath, logo }: { projectPath: string; logo: string }) {
  return <span className="bootstrap-project-mark" style={projectAccentStyle(projectPath)}>{logo ? <img src={logo} alt=""/> : <span>{projectInitials(projectPath)}</span>}</span>
}

function projectName(projectPath: string) { return projectPath.split(/[\\/]/).filter(Boolean).at(-1) || projectPath }
function parentDirectory(projectPath: string) { const parts = projectPath.split(/[\\/]/); parts.pop(); return parts.join(projectPath.includes('\\') ? '\\' : '/') }
function compactPath(projectPath: string) { return projectPath.length > 54 ? `…${projectPath.slice(-53)}` : projectPath }
function projectInitials(projectPath: string) { return projectName(projectPath).split(/[-_.\s]+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase()).join('') || 'WH' }
function stableProjectHue(projectPath: string) { let hash = 2166136261; for (let index = 0; index < projectPath.length; index += 1) hash = Math.imul(hash ^ projectPath.charCodeAt(index), 16777619); return Math.abs(hash >>> 0) % 360 }
function projectAccentStyle(projectPath: string) { return { '--project-hue': stableProjectHue(projectPath) } as CSSProperties }
function projectSlug(prompt: string) {
  const slug = prompt.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().split(/\s+/).filter((part) => part.length > 2).slice(0, 4).join('-')
  return slug || 'novo-projecto'
}
function buildBootstrapPrompt(prompt: string) {
  return `Crie e implemente este projeto do zero. Estruture a solução completa, escolha uma arquitetura coerente com o briefing, crie os ficheiros necessários e deixe uma primeira versão funcional e verificável. Preserve decisões úteis no próprio projeto e evite scaffolding desnecessário.\n\nBriefing inicial:\n${prompt.trim()}`
}
function messageOf(reason: unknown) { return reason instanceof Error ? reason.message : 'Erro inesperado' }
function logoGenerationPrompt(projectPath: string) {
  return `Crie uma proposta visual de logotipo para o projeto “${projectName(projectPath)}”. Gere pelo menos 16 opções realmente distintas, organizadas numa grelha 4x4, com estética moderna, limpa e profissional, silhuetas reconhecíveis em tamanho pequeno e sem aparência genérica de “IA”. Varie símbolo, geometria e composição, mantendo cada opção simples. Apresente a grelha para comparação e identifique cada conceito para eu poder escolher um deles como logotipo do projeto.`
}
