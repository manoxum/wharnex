import { translate, formatMessage } from '../../../../lib/workspace/localization'
import { useEffect, useRef, useState, type Dispatch, type SetStateAction, type MutableRefObject } from 'react'
import type { WorkspaceFile } from '../../../../types'
import { saveChangesDialog } from '../../../../lib/desktop/bridge/appDialog'
import { disposeEditorModel } from '../../../../lib/editor/runtime/monaco'
export type EditorDocument = WorkspaceFile & { draft: string }
export type CloseScope = 'current' | 'others' | 'all' | 'right'
export function documentCloseTargets(documents: EditorDocument[], path: string, scope: CloseScope, pinned: Set<string>, hidden: Set<string>) {
  const index = documents.findIndex((item) => item.path === path)
  return documents.filter((item, position) => !hidden.has(item.path) && (scope === 'current' ? item.path === path : !pinned.has(item.path) && (scope === 'all' || scope === 'others' && item.path !== path || scope === 'right' && index >= 0 && position > index)))
}
function loadPins(key: string): Set<string> { try { const value = JSON.parse(localStorage.getItem(key) || '[]'); return new Set(Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []) } catch { return new Set() } }
export function useDocumentActions({ projectPath, sessionID = '', documentsRef, setDocuments, activePath, setActivePath, setPreviewPaths, hiddenPaths, save, reopen }: {
  projectPath: string; sessionID?: string; documentsRef: MutableRefObject<EditorDocument[]>; setDocuments: Dispatch<SetStateAction<EditorDocument[]>>
  activePath?: string; setActivePath: Dispatch<SetStateAction<string | undefined>>; setPreviewPaths: Dispatch<SetStateAction<Set<string>>>
  hiddenPaths: Set<string>; save: (path: string) => Promise<boolean>; reopen: (path: string) => Promise<void>
}) {
  const key = `wharnex.editor.pins.v1:${projectPath}`
  const [pinned, setPinned] = useState(() => loadPins(key))
  const [closed, setClosed] = useState<string[]>([])
  const busy = useRef(false)
  const identity = `${projectPath}:${sessionID}`
  const owner = useRef(identity); owner.current = identity
  useEffect(() => { setPinned(loadPins(key)); setClosed([]) }, [key])
  function togglePin(path: string) { setPinned((current) => { const next = new Set(current); if (next.has(path)) next.delete(path); else next.add(path); try { localStorage.setItem(key, JSON.stringify([...next])) } catch { /* best effort */ } return next }) }
  async function close(path: string, scope: CloseScope = 'current') {
    if (busy.current) return
    busy.current = true
    try {
      const candidates = documentCloseTargets(documentsRef.current, path, scope, pinned, hiddenPaths)
      if (!candidates.length) return
      const dirty = candidates.filter((item) => item.draft !== item.content)
      let discard = false
      if (dirty.length) {
        const choice = await saveChangesDialog({ title: dirty.length === 1 ? translate('Guardar alterações?') : formatMessage('Guardar alterações em {count} ficheiros?', { count: dirty.length }), message: dirty.map((item) => item.path).join('\n'), tone: 'warning', confirmLabel: translate('Guardar') })
        if (choice === 'cancel') return
        discard = choice === 'discard'
        if (!discard) for (const item of dirty) { if (owner.current !== identity || !(await save(item.path))) return }
      }
      if (owner.current !== identity) return
      // A later edit while the confirmation/save was pending must remain open.
      if (candidates.some((candidate) => { const current = documentsRef.current.find((item) => item.path === candidate.path); return current && (discard ? current.draft !== candidate.draft : current.draft !== current.content) })) return
      const paths = new Set(candidates.map((item) => item.path))
      const current = documentsRef.current
      const remaining = current.filter((item) => !paths.has(item.path))
      const index = current.findIndex((item) => item.path === activePath)
      documentsRef.current = remaining
      setDocuments(remaining)
      setPreviewPaths((items) => new Set([...items].filter((item) => !paths.has(item))))
      if (activePath && paths.has(activePath)) setActivePath(remaining[Math.min(index, remaining.length - 1)]?.path)
      setClosed((history) => [...history, ...candidates.map((item) => item.path)].slice(-24))
      paths.forEach(disposeEditorModel)
    } finally { busy.current = false }
  }
  return { pinned, togglePin, close, canReopen: closed.length > 0, reopen: async () => { const path = closed.at(-1); if (path) { await reopen(path); setClosed((items) => items.slice(0, -1)) } } }
}
