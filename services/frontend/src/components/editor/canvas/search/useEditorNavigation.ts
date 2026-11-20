import { useEffect, useRef } from 'react'
import type { EditorSearchMode } from '../EditorSearchPalette'

export function useEditorNavigation({ active, searchMode, setSearchMode, openPath, openNonce, openLocation, onOpen, onOpenAt }: {
  active: boolean; searchMode?: EditorSearchMode; setSearchMode: (mode: EditorSearchMode) => void
  openPath?: string; openNonce: number; openLocation?: { line: number; column: number }
  onOpen: (path: string) => Promise<void>; onOpenAt: (path: string, line?: number, column?: number) => Promise<void>
}) {
  const lastShiftAt = useRef(0)
  useEffect(() => {
    if (!active) return
    const shortcut = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.shiftKey && event.key.toLowerCase() === 'f') {
        event.preventDefault(); event.stopPropagation(); setSearchMode('project'); return
      }
      if (event.key !== 'Shift' || event.repeat || event.ctrlKey || event.metaKey || event.altKey || searchMode) return
      const now = performance.now()
      if (now - lastShiftAt.current <= 360) { event.preventDefault(); setSearchMode('files'); lastShiftAt.current = 0 }
      else lastShiftAt.current = now
    }
    window.addEventListener('keydown', shortcut, true)
    return () => window.removeEventListener('keydown', shortcut, true)
  }, [active, searchMode])
  useEffect(() => {
    const reveal = (event: Event) => { const problem = (event as CustomEvent<{ path: string; line: number; column: number }>).detail; if (problem?.path) void onOpenAt(problem.path, problem.line, problem.column) }
    window.addEventListener('wharnex:open-code-problem', reveal)
    return () => window.removeEventListener('wharnex:open-code-problem', reveal)
  }, [onOpenAt])
  useEffect(() => {
    if (!openPath || !openNonce) return
    if (openLocation) void onOpenAt(openPath, openLocation.line, openLocation.column)
    else void onOpen(openPath)
    // Only an explicit navigation request reopens a document. The callbacks
    // intentionally read the latest documents without retriggering on edits.
  }, [openPath, openNonce])
}
