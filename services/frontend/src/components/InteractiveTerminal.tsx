import { useEffect, useRef, useState } from 'react'
import { Terminal as XTerm } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'
import { api, APIError } from '../lib/api'
import { desktopBridge } from '../lib/desktop'
import type { Session, TerminalFrame, TerminalRunRequest } from '../types'
import { subscribeUIPreferences, workspaceTerminalFontSize } from '../lib/uiPreferences'

const terminalThemes = {
  dark: {
    background: '#151715', foreground: '#D8DDD7', cursor: '#9FCB73', selectionBackground: '#3C473588',
    black: '#111311', red: '#E27676', green: '#9FCB73', yellow: '#D8BB70', blue: '#7DA7D9',
    magenta: '#B58AC9', cyan: '#71B7B0', white: '#D8DDD7', brightBlack: '#747B74',
    brightRed: '#EE9188', brightGreen: '#B5DD8B', brightYellow: '#E4CB91', brightBlue: '#9ABEE5',
    brightMagenta: '#CBA6DA', brightCyan: '#92CEC7', brightWhite: '#F0F2EE',
  },
  light: {
    background: '#f7f8f4', foreground: '#30362e', cursor: '#527c20', selectionBackground: '#cadab8aa',
    black: '#20241d', red: '#a54038', green: '#39734b', yellow: '#996117', blue: '#4777a5',
    magenta: '#8d5aa1', cyan: '#397e75', white: '#e8ebe5', brightBlack: '#697066',
    brightRed: '#c55f55', brightGreen: '#557d24', brightYellow: '#b77a26', brightBlue: '#5b8fbe',
    brightMagenta: '#a86aba', brightCyan: '#4b978d', brightWhite: '#ffffff',
  },
  'high-contrast': {
    background: '#000000', foreground: '#ffffff', cursor: '#ffffff', selectionBackground: '#ffffff55',
    black: '#000000', red: '#ff6b6b', green: '#7dff7d', yellow: '#fff56b', blue: '#70b7ff',
    magenta: '#ff8cff', cyan: '#72ffff', white: '#ffffff', brightBlack: '#a0a0a0',
    brightRed: '#ff9494', brightGreen: '#a6ffa6', brightYellow: '#fff99a', brightBlue: '#9bd0ff',
    brightMagenta: '#ffb2ff', brightCyan: '#adffff', brightWhite: '#ffffff',
  },
}

function activeTerminalTheme() {
  const scheme = document.documentElement.dataset.contentScheme
  return terminalThemes[scheme === 'light' || scheme === 'high-contrast' ? scheme : 'dark']
}

export type ConnectionStatus = 'connecting' | 'connected' | 'closed' | 'error'

export function InteractiveTerminal({ session, height, onError, visible = true, runRequest, reconnectNonce = 0, onStatusChange }: { session: Session; height: number; onError: (message: string) => void; visible?: boolean; runRequest?: TerminalRunRequest; reconnectNonce?: number; onStatusChange?: (status: ConnectionStatus) => void }) {
  const [status, setStatus] = useState<ConnectionStatus>('connecting')
  const statusRef = useRef<ConnectionStatus>('connecting')
  const terminalRootRef = useRef<HTMLDivElement>(null)
  const fitRef = useRef<FitAddon | null>(null)
  const terminalIDRef = useRef('')
  const terminalRef = useRef<XTerm | null>(null)
  const deliveredRunRef = useRef(0)
  const onErrorRef = useRef(onError)
  const onStatusChangeRef = useRef(onStatusChange)
  onErrorRef.current = onError
  onStatusChangeRef.current = onStatusChange

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
      fontSize: workspaceTerminalFontSize(), lineHeight: 1.35, theme: activeTerminalTheme(),
    })
    const fit = new FitAddon()
    terminal.loadAddon(fit); terminal.open(root); fitRef.current = fit; terminalRef.current = terminal

    const setConnectionStatus = (next: ConnectionStatus) => {
      statusRef.current = next
      setStatus(next)
      onStatusChangeRef.current?.(next)
    }
    const reportError = (error: unknown) => {
      if (!active) return
      const message = messageOf(error)
      setConnectionStatus('error'); terminal.writeln(`\r\n\x1b[38;2;227;106;96m${message}\x1b[0m`); onErrorRef.current(message)
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
      setConnectionStatus('connecting')
      try {
        const descriptor = await api.openTerminal(session.id, { cwd: '.', network: false, cols: terminal.cols || 80, rows: terminal.rows || 24 }, 'host', true)
        if (!active) { void api.closeTerminal(session.id, descriptor.terminal_id).catch(() => undefined); return }
        terminalID = descriptor.terminal_id; terminalIDRef.current = terminalID
        void api.resizeTerminal(session.id, terminalID, terminal.cols || 80, terminal.rows || 24).catch(reportError)
        source = new EventSource(api.terminalEventsURL(session.id, terminalID))
        source.onmessage = (event) => {
          if (!active) return
          try {
            const terminalFrame = JSON.parse(event.data) as TerminalFrame
            if (terminalFrame.type === 'ready') { setConnectionStatus('connected'); terminal.focus() }
            else if (terminalFrame.type === 'output' && terminalFrame.data) terminal.write(terminalFrame.data)
            else if (terminalFrame.type === 'exit') {
              setConnectionStatus('closed')
              if (terminalFrame.message) terminal.writeln(`\r\n\x1b[38;2;214;165;107m${terminalFrame.message}\x1b[0m`)
              source?.close()
            } else if (terminalFrame.type === 'error') reportError(terminalFrame.message || 'Erro no terminal')
          } catch { /* ignore malformed transport frames */ }
        }
        source.onerror = () => { if (active && statusRef.current !== 'closed') setConnectionStatus('connecting') }
      } catch (error) { reportError(error) }
    }
    void connect()

    return () => {
      active = false
      window.cancelAnimationFrame(frame); window.clearTimeout(inputTimer); window.clearTimeout(resizeTimer)
      observer?.disconnect(); source?.close(); root.removeEventListener('keydown', clipboardShortcut, true); inputDisposable.dispose(); resizeDisposable.dispose(); terminal.dispose()
      fitRef.current = null
      if (terminalRef.current === terminal) terminalRef.current = null
      if (terminalIDRef.current === terminalID) terminalIDRef.current = ''
      if (terminalID) void api.closeTerminal(session.id, terminalID).catch(() => undefined)
    }
  }, [session.id, reconnectNonce])

  useEffect(() => subscribeUIPreferences((preferences) => {
    if (!terminalRef.current) return
    terminalRef.current.options.theme = activeTerminalTheme()
    terminalRef.current.options.fontSize = workspaceTerminalFontSize(preferences)
    try { fitRef.current?.fit() } catch { /* panel may still be resizing */ }
  }), [])

  useEffect(() => { if (!visible) return; try { fitRef.current?.fit() } catch { /* panel may still be resizing */ } }, [height, visible])

  useEffect(() => {
    if (!runRequest || status !== 'connected' || !terminalIDRef.current || deliveredRunRef.current === runRequest.id) return
    deliveredRunRef.current = runRequest.id
    void api.terminalInput(session.id, terminalIDRef.current, `${runRequest.command}\r`).catch((error) => onErrorRef.current(messageOf(error)))
  }, [runRequest, session.id, status])

  return <section className="ide-terminal" style={{ height }}>
    <div ref={terminalRootRef} className="terminal-xterm" aria-label="Terminal interactivo" title="Tab completa; Ctrl+R pesquisa; ↑/↓ navega; Ctrl+C interrompe; Ctrl+Shift+C/V copia e cola (⌘C/⌘V no macOS)." />
  </section>
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
