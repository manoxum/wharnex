import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type * as Monaco from 'monaco-editor'
import { editorLanguageForPath } from '../../../lib/editor/runtime/editorLanguage'
import { activeMonacoTheme, configureMonaco, monaco, useMonacoRuntime } from '../../../lib/editor/runtime/monaco'
import { subscribeUIPreferences, workspaceEditorFontSize } from '../../../lib/workspace/preferences/uiPreferences'
import type { ChatChangeFile } from '../../../types'
import { DiffToolbar } from './diff/DiffToolbar'
import { useDiffDocument } from './diff/useDiffDocument'
import { ContentSkeleton } from '../../presentation/chrome/Skeleton'

type ChangeDiffEditorProps = { sessionId: string; file: ChatChangeFile; fragmentOnly?: boolean; afterLabel?: string }

// The surface below dereferences `monaco` from several effects, so it is only
// mounted once the runtime is actually loaded. A Git diff can be the first
// thing in the app that needs Monaco — opened from the explorer, a chat or the
// inspector — and startup no longer loads it for everyone.
export function ChangeDiffEditor(props: ChangeDiffEditorProps) {
  const runtimeReady = useMonacoRuntime()
  if (!runtimeReady) return <div className="diff-editor-loading"><ContentSkeleton label="A carregar editor" rows={6}/></div>
  return <ChangeDiffSurface {...props}/>
}

function ChangeDiffSurface({ sessionId, file, fragmentOnly = false, afterLabel }: ChangeDiffEditorProps) {
  const host = useRef<HTMLDivElement>(null)
  const editor = useRef<Monaco.editor.IStandaloneDiffEditor | null>(null)
  type DiffLineChange = { modifiedStartLineNumber: number; originalStartLineNumber: number }

  const changes = useRef<DiffLineChange[]>([])
  const document = useDiffDocument(sessionId, file, fragmentOnly)
  const [sideBySide, setSideBySide] = useState(true)
  const [activeChange, setActiveChange] = useState(0)
  const [changeCount, setChangeCount] = useState(0)

  useEffect(() => {
    setActiveChange(0)
    setChangeCount(0)
    changes.current = []
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
      renderSideBySide: sideBySide,
      useInlineViewWhenSpaceIsLimited: false,
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
  useEffect(() => { editor.current?.updateOptions({ renderSideBySide: sideBySide, useInlineViewWhenSpaceIsLimited: false }) }, [sideBySide])

  function navigate(direction: -1 | 1) {
    const instance = editor.current
    if (!instance || !changes.current.length) return
    const currentIndex = Math.max(0, activeChange - 1)
    const nextIndex = (currentIndex + direction + changes.current.length) % changes.current.length
    const line = changes.current[nextIndex].modifiedStartLineNumber || changes.current[nextIndex].originalStartLineNumber || 1
    instance.getModifiedEditor().revealLineInCenter(line)
    setActiveChange(nextIndex + 1)
  }

  return <div className="change-diff-shell flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-whx-bg">
    <DiffToolbar afterLabel={afterLabel} complete={document?.complete} sideBySide={sideBySide} activeChange={activeChange} changeCount={changeCount} onNavigate={navigate} onLayout={setSideBySide}/>

    {document
      ? <div className="change-diff-editor min-h-0 min-w-0 flex-1" ref={host} aria-label={`Comparação de ${file.path}`} />
      : <div className="min-h-0 flex-1"><p className="!m-0 px-4 pt-4 !text-whx-caption !text-whx-faint">A preparar comparação…</p><ContentSkeleton label="A preparar comparação…" rows={6}/></div>}
  </div>
}
