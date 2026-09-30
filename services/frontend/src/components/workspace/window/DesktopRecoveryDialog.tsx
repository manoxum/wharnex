import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { Icon } from '../../presentation/chrome/Icon'

function projectName(projectPath: string) {
  return projectPath.split('/').filter(Boolean).pop() || projectPath
}

// Replaces the native Electron message box that used to ask this once per
// project before any window existed. The decision now belongs to the window
// that would restore the session, so it can be themed and answered once.
export function DesktopRecoveryDialog({ projects, busy, onRecover, onDiscard }: {
  projects: string[]
  busy: boolean
  onRecover: () => void
  onDiscard: () => void
}) {
  const recoverRef = useRef<HTMLButtonElement>(null)

  useEffect(() => { recoverRef.current?.focus() }, [])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || busy) return
      event.preventDefault()
      onDiscard()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [busy, onDiscard])

  const many = projects.length > 1

  return createPortal(<div className="desktop-recovery-backdrop" data-chatgpt-overlay-blocker="true">
    <section className="desktop-recovery-dialog" role="alertdialog" aria-modal="true" aria-labelledby="desktop-recovery-title" aria-describedby="desktop-recovery-description">
      <header className="desktop-recovery-heading">
        <span className="desktop-recovery-symbol"><Icon name="archive" size={20}/></span>
        <div>
          <span className="desktop-recovery-kicker">Sessão anterior</span>
          <h2 id="desktop-recovery-title">{many ? `Recuperar os ${projects.length} projetos da última sessão?` : `Recuperar a última sessão de ${projectName(projects[0] || '')}?`}</h2>
        </div>
      </header>
      <p id="desktop-recovery-description" className="desktop-recovery-description">
        Recuperar repõe {many ? 'estes workspaces' : 'este workspace'} e o estado persistido de cada um. Descartar remove apenas esta sessão de janela — os chats guardados do projeto são preservados.
      </p>
      <ul className="desktop-recovery-projects">
        {projects.map((projectPath) => <li key={projectPath} className="desktop-recovery-project">
          <span className="desktop-recovery-project-icon"><Icon name="workspace" size={15}/></span>
          <span>
            <strong>{projectName(projectPath)}</strong>
            <small title={projectPath}>{projectPath}</small>
          </span>
        </li>)}
      </ul>
      <div className="desktop-recovery-actions">
        <button type="button" disabled={busy} onClick={onDiscard}>Descartar sessão</button>
        <button ref={recoverRef} type="button" className="primary" disabled={busy} onClick={onRecover}>
          <Icon name="refresh" size={14}/>Recuperar sessão
        </button>
      </div>
    </section>
  </div>, document.body)
}
