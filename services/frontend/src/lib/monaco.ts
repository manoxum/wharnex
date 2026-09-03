import * as monaco from 'monaco-editor'
import EditorWorker from 'monaco-editor/editor/editor.worker?worker'
import CSSWorker from 'monaco-editor/language/css/css.worker?worker'
import HTMLWorker from 'monaco-editor/language/html/html.worker?worker'
import JSONWorker from 'monaco-editor/language/json/json.worker?worker'
import TypeScriptWorker from 'monaco-editor/language/typescript/ts.worker?worker'

let configured = false

type MonacoScope = typeof globalThis & {
  MonacoEnvironment?: { getWorker: (_moduleId: string, label: string) => Worker }
}

export function configureMonaco() {
  if (configured) return
  configured = true
  ;(globalThis as MonacoScope).MonacoEnvironment = {
    getWorker: (_moduleId, label) => {
      if (label === 'json') return new JSONWorker()
      if (label === 'css' || label === 'scss' || label === 'less') return new CSSWorker()
      if (label === 'html' || label === 'handlebars' || label === 'razor') return new HTMLWorker()
      if (label === 'typescript' || label === 'javascript') return new TypeScriptWorker()
      return new EditorWorker()
    },
  }
  monaco.editor.defineTheme('wharness-ide', {
    base: 'vs-dark',
    inherit: true,
    rules: [],
    colors: {
      'editor.background': '#151713',
      'editor.foreground': '#d6dacf',
      'editorLineNumber.foreground': '#596056',
      'editorLineNumber.activeForeground': '#b8c4ad',
      'editorCursor.foreground': '#b9ff56',
      'editor.selectionBackground': '#344628',
      'editor.inactiveSelectionBackground': '#293522',
      'editorIndentGuide.background1': '#2a2e27',
      'editorIndentGuide.activeBackground1': '#5f6d54',
      'editorBracketMatch.background': '#35442c',
      'editorBracketMatch.border': '#769b46',
      'editorGutter.background': '#151713',
      'minimap.background': '#121410',
      'scrollbarSlider.background': '#69706433',
      'scrollbarSlider.hoverBackground': '#89917f55',
    },
  })
}

export function editorModelURI(path: string) {
  return monaco.Uri.from({ scheme: 'file', path: `/${path.replace(/^\/+/, '')}` })
}

export function disposeEditorModel(path: string) {
  monaco.editor.getModel(editorModelURI(path))?.dispose()
}

export { monaco }
