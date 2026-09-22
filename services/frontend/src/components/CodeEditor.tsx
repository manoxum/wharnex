import { useEffect, useLayoutEffect, useRef } from 'react'
import type * as Monaco from 'monaco-editor'
import { activeMonacoTheme, configureMonaco, editorModelURI, monaco, useMonacoRuntime } from '../lib/monaco'
import { editorLanguageForPath } from '../lib/editorLanguage'
import type { EditorGitChange } from '../lib/editorGitChanges'
import type { EditorRuntimeMarker } from '../lib/editorRuntimeMarkers'
import { subscribeUIPreferences, workspaceEditorFontSize } from '../lib/uiPreferences'
import { ContentSkeleton } from './Skeleton'

type Cursor = { line: number; column: number }
type RunAction = { id: string; label: string; line?: number }

type Props = {
  path: string
  viewStateScope?: string
  value: string
  onChange: (value: string) => void
  onSave: () => void
  onCursorChange: (cursor: Cursor) => void
  onRunSelection?: (text: string) => void
  runActions?: RunAction[]
  onRunAction?: (id: string) => void
  gitChanges?: EditorGitChange[]
  onGitChangeClick?: (change: EditorGitChange) => void
  runtimeMarkers?: EditorRuntimeMarker[]
  readOnly?: boolean
  revealLine?: number
  revealColumn?: number
  revealNonce?: number
}

// The surface below dereferences `monaco` from most of its effects, so it is
// only mounted once the runtime is actually loaded. A file preview or the
// conflict resolver can open without the editor workspace ever having been
// activated, and startup no longer loads Monaco for everyone.
export function CodeEditor(props: Props) {
  const runtimeReady = useMonacoRuntime()
  if (!runtimeReady) return <div className="code-editor-loading"><ContentSkeleton label="A carregar editor" rows={8}/></div>
  return <CodeEditorSurface {...props}/>
}

function CodeEditorSurface({ path, viewStateScope = '', value, onChange, onSave, onCursorChange, onRunSelection, runActions = [], onRunAction, gitChanges = [], onGitChangeClick, runtimeMarkers = [], readOnly = false, revealLine, revealColumn, revealNonce = 0 }: Props) {
  const host = useRef<HTMLDivElement>(null)
  const editor = useRef<Monaco.editor.IStandaloneCodeEditor | null>(null)
  const activePath = useRef(path)
  const viewStates = useRef(new Map<string, Monaco.editor.ICodeEditorViewState | null>())
  const onChangeRef = useRef(onChange)
  const onSaveRef = useRef(onSave)
  const onCursorRef = useRef(onCursorChange)
  const onRunSelectionRef = useRef(onRunSelection)
  const onRunActionRef = useRef(onRunAction)
  const onGitChangeClickRef = useRef(onGitChangeClick)
  const runActionsRef = useRef(runActions)
  const gitChangesRef = useRef(gitChanges)
  const runtimeMarkersRef = useRef(runtimeMarkers)
  const embeddedDecorations = useRef<Monaco.editor.IEditorDecorationsCollection | null>(null)
  const runDecorations = useRef<Monaco.editor.IEditorDecorationsCollection | null>(null)
  const gitDecorations = useRef<Monaco.editor.IEditorDecorationsCollection | null>(null)
  const runtimeDecorations = useRef<Monaco.editor.IEditorDecorationsCollection | null>(null)

  onChangeRef.current = onChange
  onSaveRef.current = onSave
  onCursorRef.current = onCursorChange
  onRunSelectionRef.current = onRunSelection
  onRunActionRef.current = onRunAction
  onGitChangeClickRef.current = onGitChangeClick
  runActionsRef.current = runActions
  gitChangesRef.current = gitChanges
  runtimeMarkersRef.current = runtimeMarkers

  useLayoutEffect(() => {
    if (!host.current) return
    configureMonaco()
    const instance = monaco.editor.create(host.current, {
      theme: activeMonacoTheme(),
      automaticLayout: true,
      fontFamily: "ui-monospace, 'SFMono-Regular', Consolas, 'Liberation Mono', monospace",
      fontSize: workspaceEditorFontSize(),
      lineHeight: 20,
      lineNumbersMinChars: 4,
      glyphMargin: true,
      folding: true,
      foldingHighlight: true,
      showFoldingControls: 'mouseover',
      minimap: { enabled: true, maxColumn: 110, renderCharacters: false, scale: 1 },
      bracketPairColorization: { enabled: true, independentColorPoolPerBracketType: true },
      guides: { bracketPairs: true, indentation: true, highlightActiveIndentation: true },
      stickyScroll: { enabled: true, maxLineCount: 5 },
      renderWhitespace: 'selection',
      renderControlCharacters: true,
      renderLineHighlight: 'all',
      rulers: [100, 120],
      scrollBeyondLastLine: false,
      smoothScrolling: true,
      cursorSmoothCaretAnimation: 'on',
      cursorBlinking: 'smooth',
      mouseWheelZoom: true,
      multiCursorModifier: 'alt',
      wordWrap: 'off',
      formatOnPaste: true,
      formatOnType: true,
      tabSize: 2,
      insertSpaces: true,
      detectIndentation: true,
      suggest: { showWords: true, snippetsPreventQuickSuggestions: false },
      quickSuggestions: { other: true, comments: false, strings: true },
      wordBasedSuggestions: 'allDocuments',
      snippetSuggestions: 'top',
      suggestSelection: 'recentlyUsedByPrefix',
      tabCompletion: 'on',
      inlineSuggest: { enabled: true },
      parameterHints: { enabled: true },
      hover: { enabled: 'on', delay: 250 },
      links: true,
      codeLens: true,
      lightbulb: { enabled: monaco.editor.ShowLightbulbIconMode.On },
      padding: { top: 9, bottom: 12 },
      fixedOverflowWidgets: true,
      readOnly,
    })
    editor.current = instance
    const refreshEmbeddedDecorations = () => {
      const model = instance.getModel()
      if (!model) return
      const decorations: Monaco.editor.IModelDeltaDecoration[] = []
      const expression = /\b(html|sql|css|graphql)\s*`([\s\S]*?)`/gi
      let match: RegExpExecArray | null
      const text = model.getValue()
      while ((match = expression.exec(text))) {
        const bodyOffset = match.index + match[0].indexOf('`') + 1
        const bodyEnd = bodyOffset + match[2].length
        const start = model.getPositionAt(bodyOffset)
        const end = model.getPositionAt(bodyEnd)
        decorations.push({
          range: new monaco.Range(start.lineNumber, start.column, end.lineNumber, end.column),
          options: { inlineClassName: `embedded-code-scope embedded-code-${match[1].toLowerCase()}`, hoverMessage: { value: `${match[1].toUpperCase()} incorporado` } },
        })
      }
      embeddedDecorations.current?.clear()
      embeddedDecorations.current = instance.createDecorationsCollection(decorations)
    }
    const refreshRunDecorations = () => {
      const model = instance.getModel()
      if (!model) return
      runDecorations.current?.clear()
      runDecorations.current = instance.createDecorationsCollection(runActionDecorations(runActionsRef.current, model.getLineCount()))
    }
    const contentSubscription = instance.onDidChangeModelContent(() => {
      onChangeRef.current(instance.getValue())
      refreshEmbeddedDecorations()
      refreshRunDecorations()
    })
    const cursorSubscription = instance.onDidChangeCursorPosition(({ position }) => {
      onCursorRef.current({ line: position.lineNumber, column: position.column })
    })
    const mouseSubscription = instance.onMouseDown((event) => {
      const line = event.target.position?.lineNumber ?? event.target.range?.startLineNumber
      if (event.target.type === monaco.editor.MouseTargetType.GUTTER_LINE_DECORATIONS && line) {
        const change = gitChangeAtLine(gitChangesRef.current, line, instance.getModel()?.getLineCount() || line)
        if (change) { onGitChangeClickRef.current?.(change); return }
      }
      if (event.target.type !== monaco.editor.MouseTargetType.GUTTER_GLYPH_MARGIN) return
      const action = line ? runActionsRef.current.find((item) => item.line === line) : undefined
      if (action) onRunActionRef.current?.(action.id)
    })
    instance.addAction({
      id: 'wharness.save',
      label: 'Wharnex: Guardar ficheiro',
      keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS],
      run: () => onSaveRef.current(),
    })
    instance.addAction({
      id: 'wharness.run-selection',
      label: 'Wharnex: Executar no terminal',
      keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyMod.Shift | monaco.KeyCode.Enter],
      contextMenuGroupId: 'wharness.execution',
      contextMenuOrder: 1,
      run: () => {
        const model = instance.getModel()
        const selection = instance.getSelection()
        if (!model || !selection) return
        if (!selection.isEmpty()) {
          const text = model.getValueInRange(selection).trim()
          if (text) onRunSelectionRef.current?.(text)
          return
        }
        const line = instance.getPosition()?.lineNumber
        const lineAction = line ? runActionsRef.current.find((item) => item.line === line) : undefined
        if (lineAction) { onRunActionRef.current?.(lineAction.id); return }
        const globalAction = runActionsRef.current.find((item) => item.line === undefined)
        if (globalAction) { onRunActionRef.current?.(globalAction.id); return }
        if (line) {
          const text = model.getLineContent(line).trim()
          if (text) onRunSelectionRef.current?.(text)
        }
      },
    })
    instance.addAction({
      id: 'wharness.toggle-word-wrap',
      label: 'Wharnex: Toggle word wrap',
      keybindings: [monaco.KeyMod.Alt | monaco.KeyCode.KeyZ],
      run: () => instance.trigger('keyboard', 'editor.action.toggleWordWrap', null),
    })
    return () => {
      const finalPath = activePath.current
      if (finalPath) persistEditorViewState(viewStateScope, finalPath, instance.saveViewState())
      contentSubscription.dispose()
      cursorSubscription.dispose()
      mouseSubscription.dispose()
      embeddedDecorations.current?.clear()
      embeddedDecorations.current = null
      runDecorations.current?.clear()
      runDecorations.current = null
      gitDecorations.current?.clear()
      gitDecorations.current = null
      runtimeDecorations.current?.clear()
      runtimeDecorations.current = null
      instance.dispose()
      editor.current = null
    }
  }, [])

  useEffect(() => subscribeUIPreferences((preferences) => {
    monaco.editor.setTheme(activeMonacoTheme())
    editor.current?.updateOptions({ fontSize: workspaceEditorFontSize(preferences) })
  }), [])

  useEffect(() => {
    const instance = editor.current
    if (!instance) return
    const previous = activePath.current
    if (previous) {
      const state = instance.saveViewState()
      viewStates.current.set(previous, state)
      persistEditorViewState(viewStateScope, previous, state)
    }
    const uri = editorModelURI(path)
    const language = editorLanguageForPath(path)
    let model = monaco.editor.getModel(uri)
    if (!model) model = monaco.editor.createModel(value, language, uri)
    else {
      monaco.editor.setModelLanguage(model, language)
      if (model.getValue() !== value) model.setValue(value)
    }
    activePath.current = path
    instance.setModel(model)
    const text = model.getValue()
    const decorations: Monaco.editor.IModelDeltaDecoration[] = []
    const expression = /\b(html|sql|css|graphql)\s*`([\s\S]*?)`/gi
    let match: RegExpExecArray | null
    while ((match = expression.exec(text))) {
      const bodyOffset = match.index + match[0].indexOf('`') + 1
      const bodyEnd = bodyOffset + match[2].length
      const start = model.getPositionAt(bodyOffset)
      const end = model.getPositionAt(bodyEnd)
      decorations.push({ range: new monaco.Range(start.lineNumber, start.column, end.lineNumber, end.column), options: { inlineClassName: `embedded-code-scope embedded-code-${match[1].toLowerCase()}` } })
    }
    embeddedDecorations.current?.clear()
    embeddedDecorations.current = instance.createDecorationsCollection(decorations)
    runDecorations.current?.clear()
    runDecorations.current = instance.createDecorationsCollection(runActionDecorations(runActionsRef.current, model.getLineCount()))
    gitDecorations.current?.clear()
    gitDecorations.current = instance.createDecorationsCollection(gitChangeDecorations(gitChangesRef.current, model.getLineCount()))
    runtimeDecorations.current?.clear()
    runtimeDecorations.current = instance.createDecorationsCollection(runtimeMarkerDecorations(runtimeMarkersRef.current, model.getLineCount()))
    const state = viewStates.current.get(path) ?? loadEditorViewState(viewStateScope, path)
    if (state) { viewStates.current.set(path, state); instance.restoreViewState(state) }
    instance.focus()
  }, [path])

  useEffect(() => {
    const instance = editor.current
    const model = instance?.getModel()
    if (!instance || !model || !revealLine || !revealNonce || activePath.current !== path) return
    const lineNumber = Math.min(Math.max(1, revealLine), model.getLineCount())
    const column = Math.min(Math.max(1, revealColumn || 1), model.getLineMaxColumn(lineNumber))
    const position = { lineNumber, column }
    instance.setPosition(position)
    instance.revealPositionInCenter(position)
    instance.focus()
  }, [path, revealColumn, revealLine, revealNonce])

  useEffect(() => {
    const instance = editor.current
    if (!instance || activePath.current !== path) return
    const model = instance.getModel()
    if (model && model.getValue() !== value) model.setValue(value)
  }, [path, value])

  useEffect(() => {
    const instance = editor.current
    const model = instance?.getModel()
    if (!instance || !model || activePath.current !== path) return
    runDecorations.current?.clear()
    runDecorations.current = instance.createDecorationsCollection(runActionDecorations(runActions, model.getLineCount()))
  }, [path, runActions])

  useEffect(() => {
    const instance = editor.current
    const model = instance?.getModel()
    if (!instance || !model || activePath.current !== path) return
    gitDecorations.current?.clear()
    gitDecorations.current = instance.createDecorationsCollection(gitChangeDecorations(gitChanges, model.getLineCount()))
  }, [gitChanges, path])

  useEffect(() => {
    const instance = editor.current
    const model = instance?.getModel()
    if (!instance || !model || activePath.current !== path) return
    runtimeDecorations.current?.clear()
    runtimeDecorations.current = instance.createDecorationsCollection(runtimeMarkerDecorations(runtimeMarkers, model.getLineCount()))
  }, [path, runtimeMarkers])

  return <div className="monaco-editor-host" ref={host} aria-label={`Editor de ${path}`} />
}


const EDITOR_VIEW_STATE_PREFIX = 'whx.editor.view-state.v1:'

function editorViewStateKey(scope: string, path: string) { return `${EDITOR_VIEW_STATE_PREFIX}${scope}:${path}` }

function persistEditorViewState(scope: string, path: string, state: Monaco.editor.ICodeEditorViewState | null) {
  if (!scope || !state) return
  try { localStorage.setItem(editorViewStateKey(scope, path), JSON.stringify(state)) } catch { /* storage quota is best-effort */ }
}

function loadEditorViewState(scope: string, path: string): Monaco.editor.ICodeEditorViewState | null {
  if (!scope) return null
  try { return JSON.parse(localStorage.getItem(editorViewStateKey(scope, path)) || 'null') as Monaco.editor.ICodeEditorViewState | null }
  catch { return null }
}

function gitChangeAtLine(changes: EditorGitChange[], line: number, lineCount: number) {
  return changes.find((change) => change.kind === 'deleted' ? Math.min(change.anchorLine, lineCount) === line : line >= change.startLine && line <= change.endLine)
}

function gitChangeDecorations(changes: EditorGitChange[], lineCount: number): Monaco.editor.IModelDeltaDecoration[] {
  return changes.flatMap((change) => {
    if (lineCount < 1) return []
    const startLine = Math.min(Math.max(1, change.startLine), lineCount)
    const endLine = Math.min(Math.max(startLine, change.endLine), lineCount)
    const label = change.kind === 'added' ? 'Linhas adicionadas' : change.kind === 'deleted' ? 'Linhas removidas' : 'Linhas modificadas'
    return [{
      range: new monaco.Range(startLine, 1, endLine, 1),
      options: {
        isWholeLine: true,
        className: change.kind === 'deleted' ? undefined : `editor-git-change-line editor-git-change-line-${change.kind}`,
        linesDecorationsClassName: `editor-git-change-marker editor-git-change-marker-${change.kind}`,
        hoverMessage: { value: `${label} · clique no marcador para abrir este diff` },
      },
    }]
  })
}

function runtimeMarkerDecorations(markers: EditorRuntimeMarker[], lineCount: number): Monaco.editor.IModelDeltaDecoration[] {
  return markers.flatMap((marker) => {
    if (marker.line < 1 || marker.line > lineCount) return []
    return [{
      range: new monaco.Range(marker.line, 1, marker.line, 1),
      options: {
        isWholeLine: false,
        glyphMarginClassName: `editor-compose-glyph state-${marker.tone}`,
        glyphMarginHoverMessage: { value: marker.label },
      },
    }]
  })
}

function runActionDecorations(runActions: RunAction[], lineCount: number): Monaco.editor.IModelDeltaDecoration[] {
  return runActions.flatMap((action) => {
    if (!action.line || action.line < 1 || action.line > lineCount) return []
    return [{
      range: new monaco.Range(action.line, 1, action.line, 1),
      options: {
        isWholeLine: false,
        glyphMarginClassName: 'editor-run-glyph',
        glyphMarginHoverMessage: { value: `Executar: ${action.label}` },
      },
    }]
  })
}
