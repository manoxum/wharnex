import { useEffect, useRef, useState } from 'react'
import { Terminal as XTerm } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'
import { api, APIError } from '../../../lib/transport/http/api'
import { openLiveEventStream, type LiveEventStream } from '../../../lib/transport/http/liveEventStream'
import type { Session, TerminalFrame, TerminalRunRequest } from '../../../types'
import { subscribeUIPreferences, workspaceTerminalFontSize } from '../../../lib/workspace/preferences/uiPreferences'

import { activeTerminalTheme } from '../runtime/interactiveTerminalSupport'
import { createTerminalInputQueue } from '../runtime/terminalInputQueue'
import { expireTerminalWorkspaces, observeTerminalGeneration } from './terminalWorkspaceState'
import { createTerminalHistory } from '../runtime/terminalHistory'
import { handleExpiredTerminal, isTerminalTransportExit } from '../runtime/terminalExpiration'
import { terminalClipboardShortcut } from '../runtime/terminalClipboard'

export type ConnectionStatus = 'connecting' | 'connected' | 'closed' | 'error'

export function InteractiveTerminal({ session, height, onError, visible = true, runRequest, reconnectNonce = 0, onStatusChange, cwd = '.', initialHistory = '', initialViewportY = 0, onSnapshot, terminalID: persistedTerminalID = '', onTerminalIDChange }: { session: Session; height: number; onError: (message: string) => void; visible?: boolean; runRequest?: TerminalRunRequest; reconnectNonce?: number; onStatusChange?: (status: ConnectionStatus) => void; cwd?: string; initialHistory?: string; initialViewportY?: number; onSnapshot?: (snapshot: { cwd: string; history: string; viewportY: number }) => void; terminalID?: string; onTerminalIDChange?: (terminalID: string) => void }) {
  const [status, setStatus] = useState<ConnectionStatus>('connecting')
  const statusRef = useRef<ConnectionStatus>('connecting')
  const terminalRootRef = useRef<HTMLDivElement>(null)
  const fitRef = useRef<FitAddon | null>(null)
  const terminalIDRef = useRef('')
  const terminalRef = useRef<XTerm | null>(null)
  const deliveredRunRef = useRef(0)
  const onErrorRef = useRef(onError)
  const onStatusChangeRef = useRef(onStatusChange)
  const onSnapshotRef = useRef(onSnapshot)
  const onTerminalIDChangeRef = useRef(onTerminalIDChange)
  onErrorRef.current = onError
  onStatusChangeRef.current = onStatusChange
  onSnapshotRef.current = onSnapshot
  onTerminalIDChangeRef.current = onTerminalIDChange

  useEffect(() => {
    const root = terminalRootRef.current
    if (!root) return
    let active = true
    let source: LiveEventStream | undefined
    let terminalID = persistedTerminalID || terminalIDRef.current || ''
    let reconnectTimer = 0
    let connectInFlight = false
    let resizeTimer = 0
    const rememberedCwd = cwd || '.'
    const terminal = new XTerm({
      cursorBlink: true, scrollback: 10_000, allowProposedApi: false,
      fontFamily: "ui-monospace, 'SFMono-Regular', Consolas, 'Liberation Mono', monospace",
      fontSize: workspaceTerminalFontSize(), lineHeight: 1.35, theme: activeTerminalTheme(),
    })
    const fit = new FitAddon()
    terminal.loadAddon(fit); terminal.open(root); fitRef.current = fit; terminalRef.current = terminal
    const history = createTerminalHistory(String(initialHistory || ''), rememberedCwd, () => terminal.buffer.active.viewportY, (snapshot) => onSnapshotRef.current?.(snapshot))
    if (history.initial) {
      terminal.write(history.initial, () => {
        try { terminal.scrollToLine(Math.max(0, initialViewportY)) } catch { /* xterm may still be sizing */ }
      })
    }
    const scrollDisposable = terminal.onScroll(history.schedule)

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
    const input = createTerminalInputQueue((chunk) => api.terminalInput(session.id, terminalID, chunk), () => scheduleReconnect(100))
    const inputDisposable = terminal.onData(input.push)
    const clipboardShortcut = terminalClipboardShortcut(terminal, reportError, () => active)
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

    const scheduleReconnect = (delay = 250) => {
      if (!active || statusRef.current === 'closed' || reconnectTimer) return
      input.setReady(false)
      setConnectionStatus('connecting')
      reconnectTimer = window.setTimeout(() => {
        reconnectTimer = 0
        void connect()
      }, delay)
    }
    async function connect() {
      if (!active || connectInFlight) return
      connectInFlight = true
      input.setReady(false)
      setConnectionStatus('connecting')
      source?.close()
      source = undefined
      try {
        const descriptor = await api.openTerminal(session.id, { terminal_id: terminalID || undefined, cwd: rememberedCwd, network: false, cols: terminal.cols || 80, rows: terminal.rows || 24 }, 'host', true)
        if (!active) return
        if (observeTerminalGeneration(descriptor.generation || '')) {
          await api.closeTerminal(session.id, descriptor.terminal_id).catch(() => undefined)
          setConnectionStatus('closed')
          expireTerminalWorkspaces()
          return
        }
        terminalID = descriptor.terminal_id; terminalIDRef.current = terminalID; onTerminalIDChangeRef.current?.(terminalID)
        input.setReady(true)
        void api.resizeTerminal(session.id, terminalID, terminal.cols || 80, terminal.rows || 24).catch(() => scheduleReconnect(100))
        source = openLiveEventStream(api.terminalEventsURL(session.id, terminalID))
        source.onmessage = (event) => {
          if (!active) return
          try {
            const terminalFrame = JSON.parse(event.data) as TerminalFrame
            if (terminalFrame.type === 'ready') { setConnectionStatus('connected'); terminal.focus() }
            else if (terminalFrame.type === 'output' && terminalFrame.data) { history.append(terminalFrame.data); terminal.write(terminalFrame.data) }
            else if (terminalFrame.type === 'exit') {
              if (isTerminalTransportExit(terminalFrame)) { source?.close(); scheduleReconnect(250); return }
              setConnectionStatus('closed')
              if (terminalFrame.message) { const line = `\r\n\x1b[38;2;214;165;107m${terminalFrame.message}\x1b[0m`; history.append(line); terminal.writeln(line) }
              source?.close()
            } else if (terminalFrame.type === 'error') reportError(terminalFrame.message || 'Erro no terminal')
          } catch { /* ignore malformed transport frames */ }
        }
        source.onerror = () => {
          if (!active || statusRef.current === 'closed') return
          source?.close()
          source = undefined
          scheduleReconnect()
        }
      } catch (error) {
        if (active) {
          if (terminalID && handleExpiredTerminal(error, () => { terminalID = ''; terminalIDRef.current = ''; onTerminalIDChangeRef.current?.('') })) {
            setConnectionStatus('closed')
            return
          }
          const message = messageOf(error)
          onErrorRef.current(message)
          scheduleReconnect(500)
        }
      } finally {
        connectInFlight = false
      }
    }
    void connect()

    return () => {
      active = false
      input.dispose()
      history.flush()
      window.cancelAnimationFrame(frame); window.clearTimeout(reconnectTimer); window.clearTimeout(resizeTimer)
      observer?.disconnect(); source?.close(); root.removeEventListener('keydown', clipboardShortcut, true); inputDisposable.dispose(); resizeDisposable.dispose(); scrollDisposable.dispose(); terminal.dispose()
      fitRef.current = null
      if (terminalRef.current === terminal) terminalRef.current = null
    }
  // `cwd` and restored history are initial conditions for a new PTY. They do not
  // reconnect a live shell merely because its remembered metadata changed.
  }, [session.id, reconnectNonce])

  useEffect(() => subscribeUIPreferences((preferences) => {
    if (!terminalRef.current) return
    const theme = activeTerminalTheme()
    terminalRef.current.options.theme = theme
    if (terminalRootRef.current) terminalRootRef.current.style.background = theme.background
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
    <div ref={terminalRootRef} className="terminal-xterm" style={{ background: activeTerminalTheme().background }} aria-label="Terminal interactivo" title="Tab completa; Ctrl+R pesquisa; ↑/↓ navega; Ctrl+C interrompe; Ctrl+Shift+C/V copia e cola (⌘C/⌘V no macOS)." />
  </section>
}

function messageOf(error: unknown) {
  if (error instanceof APIError || error instanceof Error) return error.message
  return 'Erro inesperado no terminal'
}
