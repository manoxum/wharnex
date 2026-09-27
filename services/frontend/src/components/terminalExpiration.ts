import { expireTerminalWorkspaces, observeTerminalGeneration } from './terminalWorkspaceState'
import type { TerminalFrame } from '../types'

export function isTerminalTransportExit(frame: TerminalFrame) {
  return frame.code === -1 && ['host PTY bridge disconnected', 'host PTY input transport', 'host PTY resize transport'].some((prefix) => frame.message?.startsWith(prefix))
}

// A missing shell in the same daemon generation is isolated to its own tab.
// A daemon replacement invalidates every project's remembered PTYs.
export function handleExpiredTerminal(error: unknown, clearOne: () => void): boolean {
  if (!error || typeof error !== 'object' || !('status' in error)) return false
  const data = 'data' in error ? error.data : undefined
  const code = data && typeof data === 'object' && 'error' in data && data.error && typeof data.error === 'object' && 'code' in data.error ? data.error.code : undefined
  if (error.status === 503 && code === 'terminal_daemon_unavailable') { expireTerminalWorkspaces(); return true }
  if (error.status !== 410) return false
  const detail = data && typeof data === 'object' && 'detail' in data ? data.detail : undefined
  const generation = detail && typeof detail === 'object' && 'generation' in detail && typeof detail.generation === 'string' ? detail.generation : ''
  if (!generation || observeTerminalGeneration(generation, true)) expireTerminalWorkspaces()
  else clearOne()
  return true
}
