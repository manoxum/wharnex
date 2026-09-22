import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { desktopBridge } from '../lib/desktop'
import { Icon } from './Icon'

type CloseAction = 'background' | 'close-project' | 'close-all' | 'cancel'
type ClosePrompt = { projectPath: string; projectName: string; hasProject: boolean }

export function DesktopCloseDialogHost() {
  const [prompt, setPrompt] = useState<ClosePrompt>()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const defaultActionRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    const windows = desktopBridge()?.windows
    if (!windows?.onCloseConfirmation) return
    return windows.onCloseConfirmation((next) => {
      setPrompt(next)
      setBusy(false)
      setError('')
    })
  }, [])

  useEffect(() => {
    if (prompt) defaultActionRef.current?.focus()
  }, [prompt])

  async function choose(action: CloseAction) {
    if (busy) return
    const windows = desktopBridge()?.windows
    if (!windows?.resolveClose) return
    setBusy(true)
    setError('')
    try {
      const result = await windows.resolveClose(action)
      if (result.ok || result.reason === 'not-pending') setPrompt(undefined)
      else setError('A decisão já não está pendente. Tente fechar a janela novamente.')
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Não foi possível concluir a ação de fechamento.')
    } finally {
      setBusy(false)
    }
  }

  useEffect(() => {
    if (!prompt) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || busy) return
      event.preventDefault()
      void choose('cancel')
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  })

  if (!prompt) return null
  const subject = prompt.hasProject ? prompt.projectName : 'esta janela'

  return createPortal(<div className="desktop-close-backdrop" data-chatgpt-overlay-blocker="true">
    <section className="desktop-close-dialog" role="alertdialog" aria-modal="true" aria-labelledby="desktop-close-title" aria-describedby="desktop-close-description">
      <header className="desktop-close-heading">
        <span className="desktop-close-symbol"><Icon name="workspace" size={20}/></span>
        <div><span className="desktop-close-kicker">Antes de fechar</span><h2 id="desktop-close-title">O que deseja fazer com {subject}?</h2></div>
        <button type="button" className="desktop-close-dismiss" disabled={busy} onClick={() => void choose('cancel')} aria-label="Cancelar fechamento" title="Cancelar"><Icon name="close" size={15}/></button>
      </header>
      <p id="desktop-close-description" className="desktop-close-description">Escolha como o Wharnex deve continuar. O seu trabalho permanece protegido em qualquer opção abaixo.</p>
      <div className="desktop-close-options">
        <button ref={defaultActionRef} type="button" className="desktop-close-option recommended" aria-label="Continuar em background" disabled={busy} onClick={() => void choose('background')}>
          <span className="desktop-close-option-icon"><Icon name="minus" size={18}/></span>
          <span><strong>Continuar em background</strong><small>Mantém projetos e agentes ativos no ícone da área de notificação.</small></span>
          <em>Recomendado</em>
        </button>
        <button type="button" className="desktop-close-option" aria-label={prompt.hasProject ? 'Fechar projeto atual' : 'Fechar esta janela'} disabled={busy} onClick={() => void choose('close-project')}>
          <span className="desktop-close-option-icon"><Icon name="workspace" size={18}/></span>
          <span><strong>{prompt.hasProject ? 'Fechar projeto atual' : 'Fechar esta janela'}</strong><small>{prompt.hasProject ? 'Liberta este workspace sem encerrar os outros projetos.' : 'Fecha somente esta janela do Wharnex.'}</small></span>
          <Icon name="chevron-right" size={15}/>
        </button>
        <button type="button" className="desktop-close-option danger" aria-label="Guardar sessão e sair" disabled={busy} onClick={() => void choose('close-all')}>
          <span className="desktop-close-option-icon"><Icon name="archive" size={18}/></span>
          <span><strong>Guardar sessão e sair</strong><small>Guarda a sessão recuperável e encerra todos os projetos do Desktop.</small></span>
          <Icon name="chevron-right" size={15}/>
        </button>
      </div>
      {error && <p className="desktop-close-error" role="status"><Icon name="alert" size={14}/>{error}</p>}
      <footer><span><Icon name="info" size={13}/> Pode pressionar Esc para continuar no Wharnex.</span><button type="button" disabled={busy} onClick={() => void choose('cancel')}>Cancelar</button></footer>
    </section>
  </div>, document.body)
}
