import { useCallback, useEffect, useState } from 'react'

export type OperationalTab = 'terminal' | 'problems' | 'output'
function load(key: string): OperationalTab {
  try { const value = localStorage.getItem(key); if (value === 'problems' || value === 'output') return value } catch { /* best effort */ }
  return 'terminal'
}
export function useOperationalTab(projectPath: string, runRequestId?: number, terminalActivation?: number) {
  const key = `wharnex.workbench.bottom-tool.v1:${projectPath}`
  const [tab, setTab] = useState<OperationalTab>(() => load(key))
  const [visited, setVisited] = useState<Set<OperationalTab>>(() => new Set([tab]))
  useEffect(() => { const next = load(key); setTab(next); setVisited(new Set([next])) }, [key])
  const select = useCallback((next: OperationalTab) => {
    setTab(next); setVisited((current) => new Set([...current, next]))
    try { localStorage.setItem(key, next) } catch { /* best effort */ }
  }, [key])
  // A human "Run in terminal" request reveals its real destination. Merely
  // selecting another tool must never replay or manufacture a command.
  useEffect(() => { if (runRequestId !== undefined) select('terminal') }, [runRequestId, select])
  useEffect(() => { if (terminalActivation) select('terminal') }, [select, terminalActivation])
  return { tab, select, visited }
}
