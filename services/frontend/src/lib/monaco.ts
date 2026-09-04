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
