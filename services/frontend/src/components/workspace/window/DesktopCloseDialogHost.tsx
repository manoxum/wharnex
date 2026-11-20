import { useEffect, useState } from 'react'
import { desktopBridge } from '../../../lib/desktop/bridge/desktop'
import { ConfirmationDialog } from '../../presentation/dialogs'
import { TerminalProcessCloseDialog } from '../../terminal/workspace/TerminalProcessCloseDialog'
import { runningTerminalProcesses, terminateTerminalProcesses, type TerminalRuntimeRecord } from '../../terminal/runtime/terminalRuntime'

type CloseAction = 'background' | 'close-window' | 'close-all' | 'cancel'
type ClosePrompt = { projectPath: string; projectName: string; hasProject: boolean }

export function DesktopCloseDialogHost({ terminals = [] }: { terminals?: TerminalRuntimeRecord[] }) {
  const [prompt, setPrompt] = useState<ClosePrompt>()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [terminalAction, setTerminalAction] = useState<Extract<CloseAction, 'close-window' | 'close-all'>>()

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

  if (!prompt) return null
  const subject = prompt.hasProject ? prompt.projectName : 'esta janela'
  const running = runningTerminalProcesses(terminals)
  if (terminalAction) return <TerminalProcessCloseDialog count={running.length} subject={terminalAction === 'close-all' ? 'o Desktop' : 'esta janela'} busy={busy} error={error} onKeep={() => void finishTerminalChoice(false)} onTerminate={() => void finishTerminalChoice(true)} onCancel={() => { if (!busy) { setTerminalAction(undefined); setError('') } }} />
  return <ConfirmationDialog title={`O que deseja fazer com ${subject}?`} description="Escolha como o Wharnex deve continuar. O seu trabalho permanece protegido em qualquer opção abaixo." icon="workspace" busy={busy} error={error} onCancel={() => { void choose('cancel') }} actions={[
    { label: 'Continuar em background', description: 'Mantém projetos e agentes ativos no ícone da área de notificação.', icon: 'minus', run: () => { void choose('background') } },
    { label: 'Fechar esta janela', description: prompt.hasProject ? 'Fecha a janela e liberta todos os projetos vinculados a ela.' : 'Fecha somente esta janela do Wharnex.', icon: 'workspace', run: () => { void choose('close-window') } },
    { label: 'Guardar sessão e sair', description: 'Guarda a sessão recuperável e encerra todos os projetos do Desktop.', icon: 'archive', tone: 'danger', run: () => { void choose('close-all') } },
  ]}/>
}
