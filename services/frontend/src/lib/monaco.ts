import type * as Monaco from 'monaco-editor'

declare const __MONACO_BASE_URL__: string

type AMDRequire = {
  (dependencies: string[], onLoad: () => void, onError: (error: unknown) => void): void
  config: (options: { paths: { vs: string } }) => void
}

type MonacoScope = {
  monaco?: typeof Monaco
  require?: AMDRequire
}

let loadPromise: Promise<typeof Monaco> | undefined
let configured = false

export let monaco: typeof Monaco

export function loadMonaco(): Promise<typeof Monaco> {
  if (monaco) return Promise.resolve(monaco)
  if (loadPromise) return loadPromise

  loadPromise = new Promise((resolve, reject) => {
    const scope = globalThis as unknown as MonacoScope
    const startEditor = () => {
      if (!scope.require) {
        reject(new Error('Monaco AMD loader did not initialize'))
        return
      }
      scope.require.config({ paths: { vs: __MONACO_BASE_URL__ } })
      scope.require(
        ['vs/editor/editor.main'],
        () => {
          if (!scope.monaco) {
            reject(new Error('Monaco editor runtime did not initialize'))
            return
          }
          monaco = scope.monaco
          resolve(monaco)
        },
        reject,
      )
    }

    if (scope.require) {
      startEditor()
      return
    }
    const script = document.createElement('script')
    script.src = `${__MONACO_BASE_URL__}/loader.js`
    script.dataset.wharnessMonacoLoader = 'true'
    script.addEventListener('load', startEditor, { once: true })
    script.addEventListener('error', () => reject(new Error('Unable to load the local Monaco runtime')), { once: true })
    document.head.append(script)
  })

  return loadPromise
}

export function configureMonaco() {
  if (configured) return
  configured = true
  monaco.editor.defineTheme('wharness-dark', {
    base: 'vs-dark',
    inherit: true,
    rules: [],
    colors: {
      'editor.background': '#212121',
      'editor.foreground': '#ececec',
      'editorLineNumber.foreground': '#686868',
      'editorLineNumber.activeForeground': '#c8c8c8',
      'editorCursor.foreground': '#f2f2f2',
      'editor.selectionBackground': '#3f3f3f',
      'editor.inactiveSelectionBackground': '#333333',
      'editorIndentGuide.background1': '#333333',
      'editorIndentGuide.activeBackground1': '#666666',
      'editorBracketMatch.background': '#383838',
      'editorBracketMatch.border': '#8a8a8a',
      'editorGutter.background': '#212121',
      'minimap.background': '#1b1b1b',
      'scrollbarSlider.background': '#77777733',
      'scrollbarSlider.hoverBackground': '#99999955',
    },
  })
  monaco.editor.defineTheme('wharness-light', {
    base: 'vs',
    inherit: true,
    rules: [],
    colors: {
      'editor.background': '#f7f8f4',
      'editor.foreground': '#252a22',
      'editorLineNumber.foreground': '#9aa196',
      'editorLineNumber.activeForeground': '#4a5347',
      'editorCursor.foreground': '#527c20',
      'editor.selectionBackground': '#d9e8c8',
      'editor.inactiveSelectionBackground': '#e7edde',
      'editorIndentGuide.background1': '#e0e4db',
      'editorIndentGuide.activeBackground1': '#9aa88f',
      'editorBracketMatch.background': '#e2ecd7',
      'editorBracketMatch.border': '#6f963c',
      'editorGutter.background': '#f7f8f4',
      'minimap.background': '#f1f3ed',
      'scrollbarSlider.background': '#7b857833',
      'scrollbarSlider.hoverBackground': '#626d5f55',
    },
  })
}

export function activeMonacoTheme() {
  return document.documentElement.dataset.theme === 'dark' ? 'wharness-dark' : 'wharness-light'
}

export function editorModelURI(path: string) {
  return monaco.Uri.from({ scheme: 'file', path: `/${path.replace(/^\/+/, '')}` })
}

export function disposeEditorModel(path: string) {
  monaco.editor.getModel(editorModelURI(path))?.dispose()
}
