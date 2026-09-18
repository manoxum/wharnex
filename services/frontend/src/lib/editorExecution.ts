import type { FileEntry, TerminalRunInput } from '../types'

const RECENT_RUNS_PREFIX = 'kernl.editor.recent-runs.v1:'
const MAX_RECENT_RUNS = 8

export type EditorRunOption = Omit<TerminalRunInput, 'label'> & {
  id: string
  label: string
  line?: number
}

export type EditorRunHistoryEntry = TerminalRunInput

export function editorExecutableOptions(path: string, draft: string, files: FileEntry[]): EditorRunOption[] {
  const cwd = parentDirectory(path)
  const base = path.split('/').pop() || path
  if (base === 'package.json') {
    try {
      const packageJSON = JSON.parse(draft) as { scripts?: Record<string, unknown>; packageManager?: string }
      const scripts = packageJSON.scripts && typeof packageJSON.scripts === 'object' ? Object.keys(packageJSON.scripts) : []
      const manager = packageManagerFor(cwd, packageJSON.packageManager, files)
      const lineByScript = packageScriptLines(draft, scripts)
      return scripts.map((script) => ({
        id: runKey({ command: packageScriptCommand(manager, script), cwd }),
        label: `Script · ${script}`,
        command: packageScriptCommand(manager, script),
        cwd,
        ...(lineByScript.get(script) ? { line: lineByScript.get(script) } : {}),
      }))
    } catch { return [] }
  }
  if (isMakefileName(base)) return makeTargetOptions(draft, cwd)
  const command = executableFileCommand(base)
  return command ? [{ id: runKey({ command, cwd }), label: `Executar ${base}`, command, cwd }] : []
}

export function recentEditorRunOptions(options: EditorRunOption[], history: EditorRunHistoryEntry[]) {
  const available = new Map(options.map((option) => [runKey(option), option]))
  return history.map((entry) => available.get(runKey(entry))).filter((option): option is EditorRunOption => Boolean(option))
}

export function loadEditorRunHistory(projectPath: string): EditorRunHistoryEntry[] {
  try {
    const raw = localStorage.getItem(RECENT_RUNS_PREFIX + projectPath)
    const parsed = raw ? JSON.parse(raw) as unknown : []
    if (!Array.isArray(parsed)) return []
    return parsed.flatMap((entry) => {
      if (!entry || typeof entry !== 'object') return []
      const candidate = entry as Partial<EditorRunHistoryEntry>
      if (typeof candidate.command !== 'string' || typeof candidate.cwd !== 'string') return []
      return [{ command: candidate.command, cwd: candidate.cwd, ...(typeof candidate.label === 'string' ? { label: candidate.label } : {}) }]
    }).slice(0, MAX_RECENT_RUNS)
  } catch { return [] }
}

export function rememberEditorRun(projectPath: string, input: TerminalRunInput): EditorRunHistoryEntry[] {
  const normalized: EditorRunHistoryEntry = { command: input.command, cwd: input.cwd, ...(input.label ? { label: input.label } : {}) }
  const next = [normalized, ...loadEditorRunHistory(projectPath).filter((entry) => runKey(entry) !== runKey(normalized))].slice(0, MAX_RECENT_RUNS)
  try { localStorage.setItem(RECENT_RUNS_PREFIX + projectPath, JSON.stringify(next)) } catch { /* best effort */ }
  return next
}

export function selectionCommand(path: string, text: string) {
  const code = shellQuote(text)
  if (/\.(mjs|cjs|js|jsx)$/i.test(path)) return `node -e ${code}`
  if (/\.(mts|cts|ts|tsx)$/i.test(path)) return `npx --no-install tsx -e ${code}`
  if (/\.py$/i.test(path)) return `python3 -c ${code}`
  if (/\.php$/i.test(path)) return `php -r ${code}`
  if (/\.rb$/i.test(path)) return `ruby -e ${code}`
  return text
}

export function parentDirectory(path: string) {
  const index = path.lastIndexOf('/')
  return index < 0 ? '.' : path.slice(0, index) || '.'
}

function packageManagerFor(cwd: string, declared: string | undefined, files: FileEntry[]) {
  const prefix = declared?.split('@')[0]
  if (prefix && ['npm', 'pnpm', 'yarn', 'bun'].includes(prefix)) return prefix
  const sibling = (name: string) => files.some((entry) => entry.kind === 'file' && entry.path === (cwd === '.' ? name : `${cwd}/${name}`))
  if (sibling('pnpm-lock.yaml')) return 'pnpm'
  if (sibling('yarn.lock')) return 'yarn'
  if (sibling('bun.lock') || sibling('bun.lockb')) return 'bun'
  return 'npm'
}

function packageScriptCommand(manager: string, script: string) {
  const name = shellQuote(script)
  if (manager === 'yarn') return `yarn ${name}`
  if (manager === 'bun') return `bun run ${name}`
  if (manager === 'pnpm') return `pnpm run ${name}`
  return `npm run ${name}`
}

function isMakefileName(base: string) {
  const lower = base.toLowerCase()
  return lower === 'makefile' || lower === 'gnumakefile' || lower.endsWith('.mk')
}

function makeTargetOptions(source: string, cwd: string): EditorRunOption[] {
  const options: EditorRunOption[] = []
  const seen = new Set<string>()
  source.split('\n').forEach((line, index) => {
    if (!line || /^\s/.test(line) || line.startsWith('#')) return
    const rule = line.match(/^([^:=#]+?)\s*::?(?!=)(.*)$/)
    if (!rule) return
    const tail = rule[2].trim()
    if (/^(?:(?:export|private|override|unexport)\s+)?[A-Za-z_][A-Za-z0-9_]*\s*[:+?]?=/.test(tail)) return
    for (const candidate of rule[1].trim().split(/\s+/)) {
      const target = candidate.trim()
      if (!target || target.startsWith('.') || target.includes('%') || /[$(){}]/.test(target)) continue
      if (!/^[A-Za-z0-9_][A-Za-z0-9_.+/@-]*$/.test(target) || seen.has(target)) continue
      seen.add(target)
      const command = `make ${shellQuote(target)}`
      options.push({ id: runKey({ command, cwd }), label: `Make · ${target}`, command, cwd, line: index + 1 })
    }
  })
  return options
}

function executableFileCommand(base: string) {
  const file = shellQuote(base)
  if (/\.(mjs|cjs|js)$/i.test(base)) return `node ${file}`
  if (/\.(mts|cts|tsx?|jsx)$/i.test(base)) return `npx --no-install tsx ${file}`
  if (/\.py$/i.test(base)) return `python3 ${file}`
  if (/\.php$/i.test(base)) return `php ${file}`
  if (/\.rb$/i.test(base)) return `ruby ${file}`
  if (/\.(sh|bash)$/i.test(base)) return `bash ${file}`
  if (/\.zsh$/i.test(base)) return `zsh ${file}`
  if (/\.go$/i.test(base)) return `go run ${file}`
  return ''
}

function packageScriptLines(source: string, scripts: string[]) {
  const result = new Map<string, number>()
  const match = /"scripts"\s*:\s*\{/g.exec(source)
  if (!match) return result
  const open = source.indexOf('{', match.index)
  const close = matchingBrace(source, open)
  if (open < 0 || close < 0) return result
  const scriptNames = new Set(scripts)
  let cursor = open + 1
  while (cursor < close) {
    const lineEnd = source.indexOf('\n', cursor)
    const end = lineEnd < 0 || lineEnd > close ? close : lineEnd
    const line = source.slice(cursor, end)
    const property = line.match(/^\s*"((?:\\.|[^"\\])*)"\s*:/)
    if (property) {
      try {
        const name = JSON.parse(`"${property[1]}"`) as string
        if (scriptNames.has(name) && !result.has(name)) result.set(name, lineNumberAt(source, cursor))
      } catch { /* malformed JSON is handled by the outer parser */ }
    }
    cursor = end + 1
  }
  return result
}

function matchingBrace(source: string, open: number) {
  let depth = 0
  let string = false
  let escaped = false
  for (let index = open; index < source.length; index += 1) {
    const character = source[index]
    if (string) {
      if (escaped) escaped = false
      else if (character === '\\') escaped = true
      else if (character === '"') string = false
      continue
    }
    if (character === '"') { string = true; continue }
    if (character === '{') depth += 1
    else if (character === '}') {
      depth -= 1
      if (depth === 0) return index
    }
  }
  return -1
}

function lineNumberAt(source: string, offset: number) {
  let line = 1
  for (let index = 0; index < offset; index += 1) if (source[index] === '\n') line += 1
  return line
}

function runKey(input: Pick<TerminalRunInput, 'cwd' | 'command'>) {
  return `${input.cwd}\n${input.command}`
}

function shellQuote(value: string) { return `'${value.replace(/'/g, `'"'"'`)}'` }
