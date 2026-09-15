import { useEffect, useRef, useState } from 'react'
import { Terminal as XTerm } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'
import { api, APIError } from '../lib/api'
import { confirmDialog } from '../lib/appDialog'
import { desktopBridge } from '../lib/desktop'
import type { Session, TerminalFrame, TerminalRunRequest, TerminalTarget } from '../types'
import { Icon } from './Icon'

const terminalTheme = {
  background: '#121411', foreground: '#cfd5c7', cursor: '#95cf50', selectionBackground: '#556b3f88',
  black: '#121411', red: '#e36a60', green: '#95cf50', yellow: '#d6a56b', blue: '#7da9d8',
  magenta: '#c594d8', cyan: '#75b9ad', white: '#d8ddd1', brightBlack: '#697064',
  brightRed: '#f08b82', brightGreen: '#b5e57b', brightYellow: '#edc487', brightBlue: '#9ac3ec',
  brightMagenta: '#d8afe7', brightCyan: '#96d5ca', brightWhite: '#f2f4ef',
}

type ConnectionStatus = 'connecting' | 'connected' | 'closed' | 'error'

export function InteractiveTerminal({ session, height, onHeight, onError, visible = true, runRequest }: { session: Session; height: number; onHeight: (value: number) => void; onError: (message: string) => void; visible?: boolean; runRequest?: TerminalRunRequest }) {
  const [target, setTarget] = useState<TerminalTarget>('sandbox')
  const [hostConfirmed, setHostConfirmed] = useState(false)
  const [network, setNetwork] = useState(false)
  const [generation, setGeneration] = useState(0)
  const [status, setStatus] = useState<ConnectionStatus>('connecting')
  const terminalRootRef = useRef<HTMLDivElement>(null)
  const fitRef = useRef<FitAddon | null>(null)
  const terminalIDRef = useRef('')
  const deliveredRunRef = useRef(0)
  const onErrorRef = useRef(onError)
  onErrorRef.current = onError

  useEffect(() => {
    const root = terminalRootRef.current
    if (!root) return
    let active = true
    let source: EventSource | undefined
    let terminalID = ''
    let inputBuffer = ''
    let inputTimer = 0
    let inputQueue = Promise.resolve()
    let resizeTimer = 0
    const terminal = new XTerm({
      cursorBlink: true, scrollback: 10_000, allowProposedApi: false,
      fontFamily: "ui-monospace, 'SFMono-Regular', Consolas, 'Liberation Mono', monospace",
      fontSize: 11, lineHeight: 1.35, theme: terminalTheme,
    })
    const fit = new FitAddon()
    terminal.loadAddon(fit); terminal.open(root); fitRef.current = fit

    const reportError = (error: unknown) => {
      if (!active) return
      const message = messageOf(error)
      setStatus('error'); terminal.writeln(`\r\n\x1b[38;2;227;106;96m${message}\x1b[0m`); onErrorRef.current(message)
    }
    const flushInput = () => {
      window.clearTimeout(inputTimer)
      inputTimer = 0
      if (!terminalID) {
        if (active && inputBuffer) inputTimer = window.setTimeout(flushInput, 25)
        return
      }
      const data = inputBuffer
      inputBuffer = ''
      if (!data) return
      for (const chunk of splitTerminalInput(data)) {
        inputQueue = inputQueue.then(() => api.terminalInput(session.id, terminalID, chunk)).catch(reportError)
      }
    }
    const inputDisposable = terminal.onData((data) => {
      inputBuffer += data
      if (!inputTimer) inputTimer = window.setTimeout(flushInput, 12)
    })
    const clipboardShortcut = (event: KeyboardEvent) => {
      const key = event.key.toLowerCase()
      const copy = key === 'c' && ((event.ctrlKey && event.shiftKey) || event.metaKey)
      const paste = key === 'v' && ((event.ctrlKey && event.shiftKey) || event.metaKey)
      if (!copy && !paste) return
      event.preventDefault()
      event.stopPropagation()
      const bridge = desktopBridge()
      if (copy) {
        const text = terminal.getSelection()
        if (!text) return
        if (bridge) void bridge.clipboard.writeText(text).catch(reportError)
        else if (navigator.clipboard?.writeText) void navigator.clipboard.writeText(text).catch(reportError)
        return
      }
      const read = bridge?.clipboard.readText ? bridge.clipboard.readText() : navigator.clipboard?.readText?.()
      if (read) void read.then((text) => { if (active && text) terminal.paste(text) }).catch(reportError)
    }
    root.addEventListener('keydown', clipboardShortcut, true)
    const resizeDisposable = terminal.onResize(({ cols, rows }) => {
      window.clearTimeout(resizeTimer)
      resizeTimer = window.setTimeout(() => {
        if (terminalID) void api.resizeTerminal(session.id, terminalID, cols, rows).catch(reportError)
      }, 80)
    })
    const fitTerminal = () => { try { fit.fit() } catch { /* hidden while the IDE layout changes */ } }
    const frame = window.requestAnimationFrame(fitTerminal)
    const observer = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(fitTerminal)
    observer?.observe(root)

    async function connect() {
      setStatus('connecting')
      try {
        const descriptor = await api.openTerminal(session.id, { cwd: '.', network: target === 'sandbox' && network, cols: terminal.cols || 80, rows: terminal.rows || 24 }, target, target === 'host' && hostConfirmed)
        if (!active) { void api.closeTerminal(session.id, descriptor.terminal_id).catch(() => undefined); return }
        terminalID = descriptor.terminal_id; terminalIDRef.current = terminalID
        void api.resizeTerminal(session.id, terminalID, terminal.cols || 80, terminal.rows || 24).catch(reportError)
        source = new EventSource(api.terminalEventsURL(session.id, terminalID))
        source.onmessage = (event) => {
          if (!active) return
          try {
            const terminalFrame = JSON.parse(event.data) as TerminalFrame
            if (terminalFrame.type === 'ready') { setStatus('connected'); terminal.focus() }
            else if (terminalFrame.type === 'output' && terminalFrame.data) terminal.write(terminalFrame.data)
            else if (terminalFrame.type === 'exit') {
              setStatus('closed')
              if (terminalFrame.message) terminal.writeln(`\r\n\x1b[38;2;214;165;107m${terminalFrame.message}\x1b[0m`)
              source?.close()
            } else if (terminalFrame.type === 'error') reportError(terminalFrame.message || 'Erro no terminal')
          } catch { /* ignore malformed transport frames */ }
        }
        source.onerror = () => { if (active) setStatus((value) => value === 'closed' ? value : 'connecting') }
      } catch (error) { reportError(error) }
    }
    void connect()

    return () => {
      active = false
      window.cancelAnimationFrame(frame); window.clearTimeout(inputTimer); window.clearTimeout(resizeTimer)
      observer?.disconnect(); source?.close(); root.removeEventListener('keydown', clipboardShortcut, true); inputDisposable.dispose(); resizeDisposable.dispose(); terminal.dispose()
      fitRef.current = null
      if (terminalIDRef.current === terminalID) terminalIDRef.current = ''
      if (terminalID) void api.closeTerminal(session.id, terminalID).catch(() => undefined)
    }
  }, [session.id, target, hostConfirmed, network, generation])

  useEffect(() => { if (!visible) return; try { fitRef.current?.fit() } catch { /* panel may still be resizing */ } }, [height, visible])

  useEffect(() => {
    if (!runRequest || status !== 'connected' || !terminalIDRef.current || deliveredRunRef.current === runRequest.id) return
    deliveredRunRef.current = runRequest.id
    void api.terminalInput(session.id, terminalIDRef.current, `${runRequest.command}\r`).catch((error) => onErrorRef.current(messageOf(error)))
  }, [runRequest, session.id, status])

  async function selectTarget(next: TerminalTarget) {
    if (next === target) return
    if (next === 'host') {
      const accepted = await confirmDialog({
        title: 'Ativar Terminal HOST?',
        message: 'Este terminal abre um shell real no projeto com todos os direitos do seu utilizador. Pode editar, criar e apagar ficheiros, instalar dependências e executar qualquer programa disponível. As alterações são imediatas e não têm rollback automático.',
        tone: 'danger', confirmLabel: 'Abrir shell no HOST',
      })
      if (!accepted) return
      setHostConfirmed(true); setNetwork(false); setTarget('host')
    } else {
      setHostConfirmed(false); setTarget('sandbox')
    }
  }

  async function reset() {
    if (target !== 'sandbox') return
    const terminalID = terminalIDRef.current
    terminalIDRef.current = ''
    try {
      if (terminalID) await api.closeTerminal(session.id, terminalID)
      await api.resetTerminal(session.id)
      setGeneration((value) => value + 1)
    } catch (error) { onError(messageOf(error)) }
  }

  return <section className={`ide-terminal terminal-target-${target}`} style={{ height }}>
    <header>
      <div><Icon name="terminal" size={14}/><strong>Terminal</strong><div className="terminal-target-switch" role="group" aria-label="Destino do terminal"><button className={target === 'sandbox' ? 'active' : ''} onClick={() => void selectTarget('sandbox')}>Sandbox</button><button className={target === 'host' ? 'active host' : 'host'} onClick={() => void selectTarget('host')}>Host</button></div><span className={`terminal-status terminal-status-${status}`}>{statusLabel(status)}</span></div>
      <div className="terminal-controls">
        {target === 'sandbox' ? <label title="Reabrir a sessão com acesso à rede"><input type="checkbox" checked={network} onChange={(event) => setNetwork(event.target.checked)}/><Icon name="network" size={13}/> rede</label> : <span className="host-network-label">acesso total</span>}
        <button className="icon-button" title="Reconectar shell" onClick={() => setGeneration((value) => value + 1)}><Icon name="refresh" size={14}/></button>
        <button className="icon-button" disabled={target !== 'sandbox'} title="Recriar sandbox a partir do projeto host" onClick={() => void reset()}><Icon name="reset" size={14}/></button>
        <button className="terminal-size-button" title="Aumentar/reduzir terminal" onClick={() => onHeight(height < 320 ? 390 : 245)}>↕</button>
      </div>
    </header>
    {target === 'host' && <div className="terminal-host-warning"><strong>HOST DIRECTO</strong><span>Sessão real do utilizador do sistema, com HOME, PATH, hostname e ferramentas do host. Ctrl+Shift+C/V copia e cola.</span></div>}
    <div ref={terminalRootRef} className="terminal-xterm" aria-label="Terminal interactivo" title="Tab completa; Ctrl+R pesquisa; ↑/↓ navega; Ctrl+C interrompe; Ctrl+Shift+C/V copia e cola (⌘C/⌘V no macOS)." />
  </section>
}

function statusLabel(status: ConnectionStatus) {
  return ({ connecting: 'a ligar…', connected: 'ligado', closed: 'encerrado', error: 'erro' })[status]
}

function messageOf(error: unknown) {
  if (error instanceof APIError || error instanceof Error) return error.message
  return 'Erro inesperado no terminal'
}

function splitTerminalInput(data: string) {
  const chunks: string[] = []
  let chunk = ''
  let bytes = 0
  const encoder = new TextEncoder()
  for (const character of data) {
    const size = encoder.encode(character).length
    if (bytes + size > 60_000 && chunk) { chunks.push(chunk); chunk = ''; bytes = 0 }
    chunk += character; bytes += size
  }
  if (chunk) chunks.push(chunk)
  return chunks
}
