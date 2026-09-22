import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type * as Monaco from 'monaco-editor'
import { api } from '../lib/api'
import { editorLanguageForPath } from '../lib/editorLanguage'
import { activeMonacoTheme, configureMonaco, monaco, useMonacoRuntime } from '../lib/monaco'
import { buildDiffDocument, type DiffDocument } from '../lib/unifiedDiff'
import { subscribeUIPreferences, workspaceEditorFontSize } from '../lib/uiPreferences'
import type { ChatChangeFile } from '../types'
import { Icon } from './Icon'
import { ContentSkeleton } from './Skeleton'

type ChangeDiffEditorProps = { sessionId: string; file: ChatChangeFile; fragmentOnly?: boolean }

// The surface below dereferences `monaco` from several effects, so it is only
// mounted once the runtime is actually loaded. A Git diff can be the first
// thing in the app that needs Monaco — opened from the explorer, a chat or the
// inspector — and startup no longer loads it for everyone.
export function ChangeDiffEditor(props: ChangeDiffEditorProps) {
  const runtimeReady = useMonacoRuntime()
  if (!runtimeReady) return <div className="diff-editor-loading"><ContentSkeleton label="A carregar editor" rows={6}/></div>
  return <ChangeDiffSurface {...props}/>
}

function ChangeDiffSurface({ sessionId, file, fragmentOnly = false }: ChangeDiffEditorProps) {
  const host = useRef<HTMLDivElement>(null)
  const editor = useRef<Monaco.editor.IStandaloneDiffEditor | null>(null)
  type DiffLineChange = { modifiedStartLineNumber: number; originalStartLineNumber: number }

  const changes = useRef<DiffLineChange[]>([])
  const [document, setDocument] = useState<DiffDocument>()
  const [sideBySide, setSideBySide] = useState(true)
  const [activeChange, setActiveChange] = useState(0)
  const [changeCount, setChangeCount] = useState(0)

  useEffect(() => {
    let cancelled = false
    setDocument(undefined)
    setActiveChange(0)
    setChangeCount(0)
    changes.current = []
    if (fragmentOnly) {
      setDocument(buildDiffDocument(file.diff))
      return () => { cancelled = true }
    }
    api.readFile(sessionId, file.path)
      .then((current) => { if (!cancelled) setDocument(buildDiffDocument(file.diff, current.content)) })
      .catch(() => { if (!cancelled) setDocument(buildDiffDocument(file.diff)) })
    return () => { cancelled = true }
  }, [sessionId, file.path, file.diff, fragmentOnly])

  useLayoutEffect(() => {
    if (!host.current || !document) return
    configureMonaco()
    const language = editorLanguageForPath(file.path)
    const original = monaco.editor.createModel(document.original, language)
    const modified = monaco.editor.createModel(document.modified, language)
    const instance = monaco.editor.createDiffEditor(host.current, {
      theme: activeMonacoTheme(),
      automaticLayout: true,
      readOnly: true,
      originalEditable: false,
      renderSideBySide: true,
      enableSplitViewResizing: true,
      renderIndicators: true,
      renderOverviewRuler: true,
      diffAlgorithm: 'advanced',
      ignoreTrimWhitespace: false,
      hideUnchangedRegions: { enabled: document.complete, contextLineCount: 3, minimumLineCount: 4, revealLineCount: 12 },
      fontFamily: "ui-monospace, 'SFMono-Regular', Consolas, 'Liberation Mono', monospace",
      fontSize: workspaceEditorFontSize(),
      lineHeight: 20,
      lineNumbersMinChars: 3,
      glyphMargin: true,
      folding: true,
      minimap: { enabled: false },
      scrollBeyondLastLine: false,
      smoothScrolling: true,
      wordWrap: 'off',
      padding: { top: 8, bottom: 12 },
    })
    editor.current = instance
    instance.setModel({ original, modified })
    const refreshChanges = () => {
      changes.current = (instance.getLineChanges() || []).map((change) => ({ modifiedStartLineNumber: change.modifiedStartLineNumber, originalStartLineNumber: change.originalStartLineNumber }))
      setChangeCount(changes.current.length)
      setActiveChange((current) => changes.current.length ? Math.min(current || 1, changes.current.length) : 0)
    }
    const subscription = instance.onDidUpdateDiff(refreshChanges)
    refreshChanges()
    return () => {
      subscription.dispose()
      instance.dispose()
      original.dispose()
      modified.dispose()
      editor.current = null
      changes.current = []
    }
  }, [document, file.path])

  useEffect(() => subscribeUIPreferences((preferences) => {
    monaco.editor.setTheme(activeMonacoTheme())
    editor.current?.updateOptions({ fontSize: workspaceEditorFontSize(preferences) })
  }), [])
  useEffect(() => { editor.current?.updateOptions({ renderSideBySide: sideBySide }) }, [sideBySide])

  function navigate(direction: -1 | 1) {
    const instance = editor.current
    if (!instance || !changes.current.length) return
    const currentIndex = Math.max(0, activeChange - 1)
    const nextIndex = (currentIndex + direction + changes.current.length) % changes.current.length
    const line = changes.current[nextIndex].modifiedStartLineNumber || changes.current[nextIndex].originalStartLineNumber || 1
    instance.getModifiedEditor().revealLineInCenter(line)
    setActiveChange(nextIndex + 1)
  }

  return <div className="change-diff-shell">
    <div className="change-diff-toolbar">
      <div className="change-diff-legend" role="group" aria-label="Comparação antes e depois">
        <span className="diff-before"><small>Antes</small><strong>Versão anterior</strong></span>
        <span className="diff-after"><small>Depois</small><strong>Versão aplicada</strong></span>
        {document && !document.complete && <span className="diff-fragment-badge">excerto do patch</span>}
      </div>
      <div className="change-diff-controls">
        <button type="button" className="icon-button light" onClick={() => navigate(-1)} disabled={!changeCount} title="Alteração anterior" aria-label="Alteração anterior"><Icon name="arrow-up" size={12}/></button>
        <span className="change-diff-position">{changeCount ? `${activeChange}/${changeCount}` : '0/0'}</span>
        <button type="button" className="icon-button light" onClick={() => navigate(1)} disabled={!changeCount} title="Alteração seguinte" aria-label="Alteração seguinte"><Icon name="arrow-down" size={12}/></button>
        <div className="diff-layout-toggle" aria-label="Modo do diff">
          <button type="button" className={sideBySide ? 'active' : ''} onClick={() => setSideBySide(true)}>Lado a lado</button>
          <button type="button" className={!sideBySide ? 'active' : ''} onClick={() => setSideBySide(false)}>Inline</button>
        </div>
      </div>
    </div>
    {document
      ? <div className="change-diff-editor" ref={host} aria-label={`Comparação de ${file.path}`} />
      : <div className="change-diff-loading"><span className="lamp blinking"/>A preparar comparação…</div>}
  </div>
}
