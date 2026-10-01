import { useEffect, useMemo, useState, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import { TerminalProcessCloseDialog } from './TerminalProcessCloseDialog'
import { runningTerminalProcesses, terminateTerminalProcesses, type TerminalRuntimeRecord } from '../runtime/terminalRuntime'

type Frames = RefObject<Map<string, HTMLIFrameElement>>

type RuntimePayload = { terminalID?: unknown; sessionID?: unknown; status?: unknown }

function recordsFromMessage(projectPath: string, values: unknown): TerminalRuntimeRecord[] {
  if (!Array.isArray(values)) return []
  return values.slice(0, 12).flatMap((value) => {
    if (!value || typeof value !== 'object') return []
    const item = value as RuntimePayload
    const terminalID = String(item.terminalID || '').slice(0, 128)
    const sessionID = String(item.sessionID || '').slice(0, 200)
    const status = String(item.status || '').slice(0, 24)
    return terminalID && sessionID ? [{ projectPath, terminalID, sessionID, status }] : []
  })
}

export function useTerminalCloseGuard(frames: Frames, projects: string[], closeProject: (projectPath: string) => Promise<void>, reportError: (message: string) => void) {
  const [runtime, setRuntime] = useState<Record<string, TerminalRuntimeRecord[]>>({})
  const [pendingProject, setPendingProject] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    const handler = (event: MessageEvent) => {
      if (event.origin !== window.location.origin || event.data?.type !== 'wharness:terminal-runtime') return
      const projectPath = String(event.data.projectPath || '')
      const frame = frames.current?.get(projectPath)
      if (!projectPath || frame?.contentWindow !== event.source) return
      const records = recordsFromMessage(projectPath, event.data.terminals)
      setRuntime((current) => ({ ...current, [projectPath]: records }))
    }
    window.addEventListener('message', handler)
    return () => window.removeEventListener('message', handler)
  }, [frames])

  useEffect(() => {
    setRuntime((current) => {
      const stale = Object.keys(current).filter((projectPath) => !projects.includes(projectPath))
      if (!stale.length) return current
      const next = { ...current }; for (const projectPath of stale) delete next[projectPath]
      return next
    })
  }, [projects])

  const windowTerminals = useMemo(() => projects.flatMap((projectPath) => runtime[projectPath] || []), [projects, runtime])
  const pendingTerminals = runningTerminalProcesses(runtime[pendingProject] || [])

  async function finishProjectClose(terminate: boolean) {
    const projectPath = pendingProject
    if (!projectPath || busy) return
    setBusy(true); setError('')
    try {
      if (terminate) await terminateTerminalProcesses(pendingTerminals)
      setPendingProject('')
      await closeProject(projectPath)
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : 'Não foi possível concluir o fechamento do projeto.'
      setError(message); reportError(message)
    } finally { setBusy(false) }
  }

  function requestProjectClose(projectPath: string) {
    const running = runningTerminalProcesses(runtime[projectPath] || [])
    if (!running.length) { void closeProject(projectPath); return }
    setError(''); setPendingProject(projectPath)
  }

  const dialog = pendingProject ? createPortal(<div className="desktop-close-backdrop">
    <TerminalProcessCloseDialog
      count={pendingTerminals.length}
      subject="este projeto"
      busy={busy}
      error={error}
      onKeep={() => void finishProjectClose(false)}
      onTerminate={() => void finishProjectClose(true)}
      onCancel={() => { if (!busy) { setPendingProject(''); setError('') } }}
    />
  </div>, document.body) : null

  return { requestProjectClose, windowTerminals, dialog }
}
