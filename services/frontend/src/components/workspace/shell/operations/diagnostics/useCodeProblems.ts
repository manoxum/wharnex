import { useEffect, useState } from 'react'
import { monaco } from '../../../../../lib/editor/runtime/monaco'
export type CodeProblem = { path: string; line: number; column: number; message: string; source: string; error: boolean }
export function useCodeProblems() {
  const [problems, setProblems] = useState<CodeProblem[]>([])
  useEffect(() => {
    let stop: (() => void) | undefined
    const connect = () => {
      if (!monaco?.editor?.onDidChangeMarkers) return
      const refresh = () => setProblems(monaco.editor.getModelMarkers({}).filter((marker) => marker.resource.scheme === 'file' && marker.severity >= 4 && monaco.editor.getModel(marker.resource)).map((marker) => ({
        path: marker.resource.path.replace(/^\//, ''), line: marker.startLineNumber, column: marker.startColumn,
        message: marker.message, source: marker.source || 'Editor', error: marker.severity >= 8,
      })).sort((a, b) => Number(b.error) - Number(a.error) || a.path.localeCompare(b.path) || a.line - b.line))
      refresh()
      const markers = monaco.editor.onDidChangeMarkers(refresh)
      const models = monaco.editor.onWillDisposeModel(() => queueMicrotask(refresh))
      stop = () => { markers.dispose(); models.dispose() }
      window.clearInterval(timer)
    }
    const timer = window.setInterval(connect, 500)
    connect()
    return () => { window.clearInterval(timer); stop?.() }
  }, [])
  return problems
}
