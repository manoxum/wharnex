import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { desktopBridge } from '../../../lib/desktop/bridge/desktop'
import { Icon } from '../../presentation/chrome/Icon'
import { TerminalProcessCloseDialog } from '../../terminal/workspace/TerminalProcessCloseDialog'
import { runningTerminalProcesses, terminateTerminalProcesses, type TerminalRuntimeRecord } from '../../terminal/runtime/terminalRuntime'

type CloseAction = 'background' | 'close-window' | 'close-all' | 'cancel'
type ClosePrompt = { projectPath: string; projectName: string; hasProject: boolean }

export function DesktopCloseDialogHost({ terminals = [] }: { terminals?: TerminalRuntimeRecord[] }) {
  const [prompt, setPrompt] = useState<ClosePrompt>()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [terminalAction, setTerminalAction] = useState<Extract<CloseAction, 'close-window' | 'close-all'>>()
  const defaultActionRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    const windows = desktopBridge()?.windows
    if (!windows?.onCloseConfirmation) return
    return windows.onCloseConfirmation((next) => {
      setPrompt(next)
      setBusy(false)
      setError('')
      setTerminalAction(undefined)
      // Tell the main process the modal is up, so it stands down its native
      // fallback prompt instead of racing the decision being read here.
      void windows.acknowledgeClose?.()
    })
  }, [])

  useEffect(() => {
    if (prompt) defaultActionRef.current?.focus()
  }, [prompt])

  async function resolve(action: CloseAction) {
    const windows = desktopBridge()?.windows
    if (!windows?.resolveClose) return
    setBusy(true); setError('')
    try {
      const result = await windows.resolveClose(action)
      if (result.ok || result.reason === 'not-pending') { setPrompt(undefined); setTerminalAction(undefined) }
      else setError('A decisão já não está pendente. Tente fechar a janela novamente.')
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Não foi possível concluir a ação de fechamento.')
    } finally { setBusy(false) }
  }

  async function choose(action: CloseAction) {
    if (busy) return
    const running = runningTerminalProcesses(terminals)
    if ((action === 'close-window' || action === 'close-all') && running.length) {
      setError(''); setTerminalAction(action)
      return
    }
    await resolve(action)
  }

  async function finishTerminalChoice(terminate: boolean) {
    if (!terminalAction || busy) return
    setBusy(true); setError('')
    try {
      if (terminate) await terminateTerminalProcesses(terminals)
      const action = terminalAction
      setTerminalAction(undefined); setBusy(false)
      await resolve(action)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Não foi possível concluir a ação de fechamento.')
      setBusy(false)
    }
  }

  useEffect(() => {
    if (!prompt) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || busy) return
      event.preventDefault()
      if (terminalAction) { setTerminalAction(undefined); setError(''); return }
      void choose('cancel')
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  })

  if (!prompt) return null
  const subject = prompt.hasProject ? prompt.projectName : 'esta janela'
  const running = runningTerminalProcesses(terminals)
  if (terminalAction) return createPortal(<div className="desktop-close-backdrop" data-chatgpt-overlay-blocker="true">
    <TerminalProcessCloseDialog count={running.length} subject={terminalAction === 'close-all' ? 'o Desktop' : 'esta janela'} busy={busy} error={error} onKeep={() => void finishTerminalChoice(false)} onTerminate={() => void finishTerminalChoice(true)} onCancel={() => { if (!busy) { setTerminalAction(undefined); setError('') } }} />
  </div>, document.body)

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
        <button type="button" className="desktop-close-option" aria-label="Fechar esta janela" disabled={busy} onClick={() => void choose('close-window')}>
          <span className="desktop-close-option-icon"><Icon name="workspace" size={18}/></span>
          <span><strong>Fechar esta janela</strong><small>{prompt.hasProject ? 'Fecha a janela e liberta todos os projetos vinculados a ela.' : 'Fecha somente esta janela do Wharnex.'}</small></span>
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
