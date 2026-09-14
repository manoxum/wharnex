import { useEffect, useLayoutEffect, useRef } from 'react'
import type * as Monaco from 'monaco-editor'
import { activeMonacoTheme, configureMonaco, editorModelURI, monaco } from '../lib/monaco'
import { editorLanguageForPath } from '../lib/editorLanguage'
import { subscribeUIPreferences } from '../lib/uiPreferences'

type Cursor = { line: number; column: number }

type Props = {
  path: string
  value: string
  onChange: (value: string) => void
  onSave: () => void
  onCursorChange: (cursor: Cursor) => void
  onRunSelection?: (text: string) => void
  readOnly?: boolean
}

export function CodeEditor({ path, value, onChange, onSave, onCursorChange, onRunSelection, readOnly = false }: Props) {
  const host = useRef<HTMLDivElement>(null)
  const editor = useRef<Monaco.editor.IStandaloneCodeEditor | null>(null)
  const activePath = useRef(path)
  const viewStates = useRef(new Map<string, Monaco.editor.ICodeEditorViewState | null>())
  const onChangeRef = useRef(onChange)
  const onSaveRef = useRef(onSave)
  const onCursorRef = useRef(onCursorChange)
  const onRunSelectionRef = useRef(onRunSelection)
  const embeddedDecorations = useRef<Monaco.editor.IEditorDecorationsCollection | null>(null)

  onChangeRef.current = onChange
  onSaveRef.current = onSave
  onCursorRef.current = onCursorChange
  onRunSelectionRef.current = onRunSelection

  useLayoutEffect(() => {
    if (!host.current) return
    configureMonaco()
    const instance = monaco.editor.create(host.current, {
      theme: activeMonacoTheme(),
      automaticLayout: true,
      fontFamily: "ui-monospace, 'SFMono-Regular', Consolas, 'Liberation Mono', monospace",
      fontSize: 12.5,
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
    const contentSubscription = instance.onDidChangeModelContent(() => {
      onChangeRef.current(instance.getValue())
      refreshEmbeddedDecorations()
    })
    const cursorSubscription = instance.onDidChangeCursorPosition(({ position }) => {
      onCursorRef.current({ line: position.lineNumber, column: position.column })
    })
    instance.addAction({
      id: 'wharness.save',
      label: 'Wharnex: Save file',
      keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS],
      run: () => onSaveRef.current(),
    })
    instance.addAction({
      id: 'wharness.run-selection',
      label: 'Wharnex: Run selection in terminal',
      keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyMod.Shift | monaco.KeyCode.Enter],
      run: () => {
        const selection = instance.getSelection()
        if (!selection || selection.isEmpty()) return
        const text = instance.getModel()?.getValueInRange(selection).trim()
        if (text) onRunSelectionRef.current?.(text)
      },
    })
    instance.addAction({
      id: 'wharness.toggle-word-wrap',
      label: 'Wharnex: Toggle word wrap',
      keybindings: [monaco.KeyMod.Alt | monaco.KeyCode.KeyZ],
      run: () => instance.trigger('keyboard', 'editor.action.toggleWordWrap', null),
    })
    return () => {
      contentSubscription.dispose()
      cursorSubscription.dispose()
      embeddedDecorations.current?.clear()
      embeddedDecorations.current = null
      instance.dispose()
      editor.current = null
    }
  }, [])

  useEffect(() => subscribeUIPreferences(() => monaco.editor.setTheme(activeMonacoTheme())), [])

  useEffect(() => {
    const instance = editor.current
    if (!instance) return
    const previous = activePath.current
    if (previous) viewStates.current.set(previous, instance.saveViewState())
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
    const state = viewStates.current.get(path)
    if (state) instance.restoreViewState(state)
    instance.focus()
  }, [path])

  useEffect(() => {
    const instance = editor.current
    if (!instance || activePath.current !== path) return
    const model = instance.getModel()
    if (model && model.getValue() !== value) model.setValue(value)
  }, [path, value])

  return <div className="monaco-editor-host" ref={host} aria-label={`Editor de ${path}`} />
}
