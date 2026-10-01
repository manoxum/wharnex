import { api } from '../../../lib/transport/http/api'

export type TerminalRuntimeRecord = {
  projectPath: string
  sessionID: string
  terminalID: string
  status: string
}

type RuntimeTab = { terminalID: string; status: string; session: { id: string } }

export function publishTerminalRuntime(projectPath: string, tabs: RuntimeTab[]) {
  if (!projectPath || window.parent === window) return
  const terminals = tabs.flatMap((tab) => tab.terminalID ? [{
    terminalID: tab.terminalID.slice(0, 128),
    sessionID: String(tab.session.id || '').slice(0, 200),
    status: String(tab.status || '').slice(0, 24),
  }] : [])
  window.parent.postMessage({ type: 'wharness:terminal-runtime', projectPath, terminals }, window.location.origin)
}

export function runningTerminalProcesses(records: TerminalRuntimeRecord[]) {
  const seen = new Set<string>()
  return records.filter((record) => {
    if (!record.terminalID || !record.sessionID || record.status === 'closed') return false
    const key = `${record.sessionID}\u0000${record.terminalID}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

export async function terminateTerminalProcesses(records: TerminalRuntimeRecord[]) {
  const running = runningTerminalProcesses(records)
  const results = await Promise.allSettled(running.map((record) => api.closeTerminal(record.sessionID, record.terminalID)))
  const failed = results.filter((result) => result.status === 'rejected').length
  if (failed) throw new Error(`Não foi possível encerrar ${failed} processo${failed === 1 ? '' : 's'} de terminal.`)
}
