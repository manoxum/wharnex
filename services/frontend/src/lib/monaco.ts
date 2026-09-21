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
  monaco.typescript.typescriptDefaults.setEagerModelSync(true)
  monaco.typescript.javascriptDefaults.setEagerModelSync(true)
  monaco.languages.register({ id: 'dotenv' })
  monaco.languages.setMonarchTokensProvider('dotenv', {
    tokenizer: {
      root: [
        [/^\s*#.*$/, 'comment'],
        [/^\s*(?:export\s+)?[A-Za-z_][A-Za-z0-9_]*(?=\s*=)/, 'variable'],
        [/=/, 'delimiter'],
        [/#.*$/, 'comment'],
        [/"(?:[^"\\]|\\.)*"/, 'string'],
        [/'(?:[^'\\]|\\.)*'/, 'string'],
        [/\b(?:true|false|null)\b/i, 'keyword'],
        [/\b\d+(?:\.\d+)?\b/, 'number'],
      ],
    },
  })
  monaco.languages.register({ id: 'makefile' })
  monaco.languages.setLanguageConfiguration('makefile', {
    comments: { lineComment: '#' },
    brackets: [['(', ')'], ['{', '}']],
    autoClosingPairs: [
      { open: '(', close: ')' },
      { open: '{', close: '}' },
      { open: '"', close: '"' },
      { open: "'", close: "'" },
    ],
  })
  monaco.languages.setMonarchTokensProvider('makefile', {
    tokenizer: {
      root: [
        [/^\s*#.*$/, 'comment'],
        [/^\t[@+-]?/, 'keyword'],
        [/\$\([^)]+\)|\$\{[^}]+\}/, 'variable'],
        [/\$\$[@%<?^+*|]/, 'variable.predefined'],
        [/\b(?:include|-include|sinclude|define|endef|ifdef|ifndef|ifeq|ifneq|else|endif|override|export|unexport|private|vpath)\b/, 'keyword'],
        [/^[A-Za-z0-9_][A-Za-z0-9_.%/@+-]*(?=\s*::?(?!=))/, 'type.identifier'],
        [/^[A-Za-z_][A-Za-z0-9_]*(?=\s*(?:[:+?]?=))/, 'variable'],
        [/"(?:[^"\\]|\\.)*"/, 'string'],
        [/'(?:[^'\\]|\\.)*'/, 'string'],
        [/#.*$/, 'comment'],
        [/\b\d+(?:\.\d+)?\b/, 'number'],
        [/::?|[:+?]?=/, 'delimiter'],
      ],
    },
  })
  for (const language of ['javascript', 'typescript']) {
    monaco.languages.registerCompletionItemProvider(language, {
      triggerCharacters: ['<', ' ', '.', '('],
      provideCompletionItems(model, position) {
        const prefix = model.getValueInRange(new monaco.Range(1, 1, position.lineNumber, position.column)).slice(-12_000)
        const match = prefix.match(/\b(html|sql|css|graphql)\s*`[^`]*$/i)
        if (!match) return { suggestions: [] }
        const word = model.getWordUntilPosition(position)
        const range = new monaco.Range(position.lineNumber, word.startColumn, position.lineNumber, word.endColumn)
        return { suggestions: embeddedSuggestions(match[1].toLowerCase(), range) }
      },
    })
  }
  monaco.editor.defineTheme('wharness-dark', {
    base: 'vs-dark',
    inherit: true,
    rules: [],
    colors: {
      'editor.background': '#151715',
      'editor.foreground': '#D8DDD7',
      'editorLineNumber.foreground': '#5F655F',
      'editorLineNumber.activeForeground': '#B9C0B8',
      'editorCursor.foreground': '#C8D6BB',
      'editor.lineHighlightBackground': '#191C19',
      'editor.selectionBackground': '#34402F',
      'editor.inactiveSelectionBackground': '#282E27',
      'editorIndentGuide.background1': '#252925',
      'editorIndentGuide.activeBackground1': '#4A5049',
      'editorBracketMatch.background': '#242A22',
      'editorBracketMatch.border': '#66705F',
      'editorGutter.background': '#151715',
      'minimap.background': '#121412',
      'minimapSlider.background': '#737B7330',
      'minimapSlider.hoverBackground': '#8A938A45',
      'scrollbarSlider.background': '#737B7330',
      'scrollbarSlider.hoverBackground': '#8A938A45',
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
  defineWorkbenchTheme('wharness-jetbrains-darcula', 'vs-dark', '#1e1f22', '#bcbec4', '#2b2d30', '#3574f0', '#2b2d30')
  defineWorkbenchTheme('wharness-jetbrains-light', 'vs', '#ffffff', '#1f2329', '#f2f3f5', '#3574f0', '#f7f8fa')
  defineWorkbenchTheme('wharness-vscode-dark', 'vs-dark', '#1e1e1e', '#d4d4d4', '#252526', '#007acc', '#1e1e1e')
  defineWorkbenchTheme('wharness-vscode-light', 'vs', '#ffffff', '#333333', '#f3f3f3', '#007acc', '#ffffff')
}

export function activeMonacoTheme() {
  const root = document.documentElement
  const scheme = root.dataset.contentScheme
  if (scheme === 'high-contrast') return 'hc-black'
  if (root.dataset.contentSchemePreference === 'follow-ui') {
    if (root.dataset.uiTheme === 'jetbrains-darcula') return 'wharness-jetbrains-darcula'
    if (root.dataset.uiTheme === 'jetbrains-light') return 'wharness-jetbrains-light'
    if (root.dataset.uiTheme === 'vscode-dark') return 'wharness-vscode-dark'
    if (root.dataset.uiTheme === 'vscode-light') return 'wharness-vscode-light'
  }
  return scheme === 'dark' || (!scheme && root.dataset.theme === 'dark') ? 'wharness-dark' : 'wharness-light'
}

function defineWorkbenchTheme(name: string, base: 'vs' | 'vs-dark', background: string, foreground: string, chrome: string, accent: string, gutter: string) {
  monaco.editor.defineTheme(name, {
    base,
    inherit: true,
    rules: [
      { token: 'variable', foreground: base === 'vs-dark' ? 'C77DBB' : '7A3E9D' },
      { token: 'delimiter', foreground: base === 'vs-dark' ? 'A7A7A7' : '666666' },
    ],
    colors: {
      'editor.background': background,
      'editor.foreground': foreground,
      'editorGutter.background': gutter,
      'editor.lineHighlightBackground': chrome,
      'editor.selectionBackground': `${accent}55`,
      'editor.inactiveSelectionBackground': `${accent}28`,
      'editorCursor.foreground': accent,
      'editorLineNumber.activeForeground': foreground,
      'focusBorder': accent,
      'minimap.background': gutter,
    },
  })
}


export function editorModelURI(path: string) {
  return monaco.Uri.from({ scheme: 'file', path: `/${path.replace(/^\/+/, '')}` })
}

export function disposeEditorModel(path: string) {
  monaco.editor.getModel(editorModelURI(path))?.dispose()
}


function embeddedSuggestions(tag: string, range: Monaco.IRange): Monaco.languages.CompletionItem[] {
  const snippet = (label: string, insertText: string, detail: string): Monaco.languages.CompletionItem => ({
    label,
    kind: monaco.languages.CompletionItemKind.Snippet,
    insertText,
    insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
    range,
    detail,
  })
  if (tag === 'html') return [
    snippet('div', '<div class="${1:class}">\n\t${0}\n</div>', 'HTML incorporado'),
    snippet('section', '<section>\n\t${0}\n</section>', 'HTML incorporado'),
    snippet('button', '<button type="${1:button}">${0}</button>', 'HTML incorporado'),
    snippet('input', '<input type="${1:text}" name="${2:name}" />', 'HTML incorporado'),
    snippet('a', '<a href="${1:#}">${0}</a>', 'HTML incorporado'),
  ]
  if (tag === 'sql') return [
    snippet('SELECT', 'SELECT ${1:*}\nFROM ${2:table}\nWHERE ${0:condition};', 'SQL incorporado'),
    snippet('JOIN', 'JOIN ${1:table} ON ${2:left_id} = ${3:right_id}', 'SQL incorporado'),
    snippet('INSERT', 'INSERT INTO ${1:table} (${2:columns})\nVALUES (${0:values});', 'SQL incorporado'),
    snippet('UPDATE', 'UPDATE ${1:table}\nSET ${2:column} = ${3:value}\nWHERE ${0:condition};', 'SQL incorporado'),
  ]
  if (tag === 'css') return [
    snippet('display flex', 'display: flex;\n${0}', 'CSS incorporado'),
    snippet('display grid', 'display: grid;\ngrid-template-columns: ${1:repeat(2, 1fr)};\n${0}', 'CSS incorporado'),
    snippet('media', '@media (${1:max-width: 768px}) {\n\t${0}\n}', 'CSS incorporado'),
  ]
  if (tag === 'graphql') return [
    snippet('query', 'query ${1:Name}(${2:$id: ID!}) {\n\t${3:node}(id: $id) {\n\t\t${0:id}\n\t}\n}', 'GraphQL incorporado'),
    snippet('mutation', 'mutation ${1:Name} {\n\t${0}\n}', 'GraphQL incorporado'),
    snippet('fragment', 'fragment ${1:Name} on ${2:Type} {\n\t${0}\n}', 'GraphQL incorporado'),
  ]
  return []
}
