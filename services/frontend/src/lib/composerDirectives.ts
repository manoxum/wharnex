// The composer directive language, mirroring backend/internal/directives.
//
// Three kinds, one grammar. `@file` points at a file in this project; `@ref`
// points at a project Wharnex has worked on before and, optionally, one file
// inside it; `@attach` points at a file or directory outside every project.
// All three are written inline and stay where they were written: a prompt
// reading "make the handler in @file:a.ts match @ref:core/b.ts" says which
// file plays which role, and the trailing list this replaced did not.
//
// What the operator types is `@file:path` / `@ref:project/path` /
// `@attach:/abs/path`, bracketed as `<<…>>` when the value contains spaces.
// `@ref` and `@attach` also accept the alternate keywords in KEYWORDS, because
// an operator reaching for "the other project" should not have to remember one
// exact word for it. What is sent is always the canonical `@{[file]path}` /
// `@{[ref]project/path}` / `@{[attach]path}` — unambiguous to scan and
// impossible to run into the following word. Every typed spelling parses,
// because a prompt can come back from a round trip and must mean the same
// thing twice.
//
// Keep this in step with the Go parser: it is the same language, and the half
// that renders chips must agree with the half that resolves them.

export type DirectiveKind = 'file' | 'ref' | 'attach'

/**
 * The typed vocabulary: one canonical keyword per kind, plus the alternate
 * spellings accepted on input. Mirrors backend/internal/directives.Keywords —
 * keep the two lists in step, or a phrase the engine accepts silently stops
 * autocompleting, or the reverse.
 */
export const KEYWORDS: { kind: DirectiveKind; keyword: string; label: string; aliases: string[] }[] = [
  { kind: 'file', keyword: 'file', label: 'Ficheiro do projeto', aliases: [] },
  { kind: 'ref', keyword: 'ref', label: 'Outro projeto', aliases: ['reference', 'references', 'project'] },
  { kind: 'attach', keyword: 'attach', label: 'Caminho externo', aliases: ['att', 'attch', 'attche', 'attaches', 'attahes', 'dir'] },
]

const KIND_ALIASES: Record<string, DirectiveKind> = Object.fromEntries(
  KEYWORDS.flatMap((entry) => [entry.keyword, ...entry.aliases].map((word) => [word, entry.kind])),
)

function typedKeywordAlternation() {
  // Longest first for readability. Correctness does not depend on order: a
  // short alias whose following letters do not complete a `:` simply fails to
  // match the surrounding pattern, whichever alternative is tried.
  return Object.keys(KIND_ALIASES).sort((a, b) => b.length - a.length).join('|')
}

/**
 * What an `@attach` directive says should travel when it points at a directory.
 *
 * Deliberately the same vocabulary the project's own context configuration
 * uses — automatic pruning plus include/exclude globs — because attaching a
 * folder is the same question the settings panel already answers, and an
 * operator should not have to learn a second model for it.
 */
export type AttachRules = { autoExclude: boolean; include: string[]; exclude: string[] }

export const defaultAttachRules = (): AttachRules => ({ autoExclude: true, include: [], exclude: [] })

export function attachRulesAreDefault(rules: AttachRules) {
  return rules.autoExclude && !rules.include.length && !rules.exclude.length
}

export type ComposerDirective = {
  kind: DirectiveKind
  /** Whole payload: a path for `file`/`attach`, `project[/path]` for `ref`. */
  value: string
  project: string
  path: string
  /** The include/exclude selection, for `attach` only. */
  rules?: AttachRules
  start: number
  end: number
}

export const MAX_DIRECTIVES = 128
const MAX_VALUE_LENGTH = 512
const PROJECT_NAME = /^[A-Za-z0-9._-]+$/

// The unbracketed alternative stops at the punctuation that ends a clause as
// well as at whitespace: a directive normally sits inside a sentence, and
// "change @ref:core, then stop" refers to `core`, not to `core,`. Its keyword
// group accepts every alias; the bracketed canonical form accepts only the
// three real kind names, since nothing ever writes an alias into it.
const VALUE_CHARS = '[^\\s<>{}(),;:!?"\'`]*'
const DIRECTIVE = new RegExp(`@\\{\\[(file|ref|attach)\\]([^{}\\n]*)\\}|@(${typedKeywordAlternation()}):(?:<<([^<>\\n]*)>>|(${VALUE_CHARS}))`, 'g')

export function validProjectName(name: string) {
  const trimmed = name.trim()
  if (!trimmed || trimmed === '.' || trimmed === '..' || trimmed.length > 128) return false
  return PROJECT_NAME.test(trimmed)
}

// Only a trailing separator is cosmetic (`@ref:core/` is the project). A leading
// one is an absolute path, and trimming it would quietly repair
// `@file:/etc/passwd` into a relative reference.
function safeRelativePath(value: string) {
  if (/[{}\0]/.test(value)) return ''
  const segments: string[] = []
  for (const segment of value.split('/')) {
    if (!segment || segment === '.') continue
    if (segment === '..') return ''
    segments.push(segment)
  }
  const clean = segments.join('/')
  return clean && !value.startsWith('/') ? clean : ''
}

/**
 * Splits an `@attach` payload into its absolute path and its rules.
 *
 * The rules ride inside the marker rather than beside it so the prompt text
 * stays the whole state: a selection kept somewhere else is a selection that can
 * disagree with the text it belongs to.
 */
function buildAttach(raw: string): Omit<ComposerDirective, 'start' | 'end'> | undefined {
  const segments = raw.split('|')
  const target = segments[0].trim()
  // Absolute only: a relative path would resolve against a working directory
  // the operator cannot see from the composer. A traversal is never repaired.
  if (!target.startsWith('/') || /[{}\0]/.test(target) || target.split('/').includes('..')) return undefined
  const clean = target.replace(/\/+$/, '') || '/'
  if (clean === '/') return undefined
  const rules = defaultAttachRules()
  for (const segment of segments.slice(1)) {
    const token = segment.trim()
    if (!token) continue
    if (token === '!auto') { rules.autoExclude = false; continue }
    const pattern = token.slice(1).trim()
    if (!pattern || pattern.startsWith('/') || pattern.split('/').includes('..') || /[{}|\0]/.test(pattern)) return undefined
    if (token[0] === '+') rules.include.push(pattern)
    else if (token[0] === '-') rules.exclude.push(pattern)
    else return undefined
  }
  return { kind: 'attach', value: renderAttachValue(clean, rules), project: '', path: clean, rules }
}

export function renderAttachValue(target: string, rules: AttachRules) {
  let value = target
  if (!rules.autoExclude) value += '|!auto'
  for (const pattern of rules.include) value += `|+${pattern}`
  for (const pattern of rules.exclude) value += `|-${pattern}`
  return value
}

function build(kind: DirectiveKind, raw: string): Omit<ComposerDirective, 'start' | 'end'> | undefined {
  // An attachment carries its own rule tokens and an absolute path, so it is
  // read by its own parser before the project-relative trimming below could
  // mangle it.
  if (kind === 'attach') return buildAttach(raw.trim())
  // A trailing separator or full stop is sentence punctuation, not part of the
  // name. A leading separator is an absolute path and is never trimmed.
  const value = raw.trim().replace(/[/.]+$/, '')
  if (!value || value.length > MAX_VALUE_LENGTH) return undefined
  if (kind === 'file') {
    const path = safeRelativePath(value)
    return path ? { kind, value: path, project: '', path } : undefined
  }
  const separator = value.indexOf('/')
  const project = separator >= 0 ? value.slice(0, separator) : value
  let path = separator >= 0 ? value.slice(separator + 1).trim() : ''
  if (!validProjectName(project)) return undefined
  if (path) {
    path = safeRelativePath(path)
    if (!path) return undefined
  }
  return { kind, value: path ? `${project}/${path}` : project, project, path }
}

/** Every well-formed directive, in order, with the range it occupied. */
export function parseDirectives(text: string): ComposerDirective[] {
  const parsed: ComposerDirective[] = []
  DIRECTIVE.lastIndex = 0
  let match: RegExpExecArray | null
  while ((match = DIRECTIVE.exec(text)) !== null) {
    if (parsed.length >= MAX_DIRECTIVES) break
    // The bracketed form's keyword (group 1) is always a real kind. The typed
    // form's keyword (group 3) may be an alias and is normalized here, so
    // downstream code only ever sees the canonical kind.
    const kind = match[1] !== undefined ? (match[1] as DirectiveKind) : KIND_ALIASES[match[3]]
    if (!kind) continue
    const raw = match[1] !== undefined ? match[2] : (match[4] !== undefined ? match[4] : match[5])
    const directive = build(kind, raw ?? '')
    if (!directive) continue
    parsed.push({ ...directive, start: match.index, end: match.index + match[0].length })
  }
  return parsed
}

export function canonicalDirective(directive: Pick<ComposerDirective, 'kind' | 'value'>) {
  return `@{[${directive.kind}]${directive.value}}`
}

/**
 * Rewrites every directive to its canonical form and leaves everything else —
 * including malformed near-misses — exactly as written.
 *
 * This is what makes the marker stable: what the operator typed, what the model
 * reads, and what the engine re-parses on a continuation are one string.
 */
export function canonicalizeDirectives(text: string) {
  const parsed = parseDirectives(text)
  if (!parsed.length) return text
  let out = ''
  let cursor = 0
  for (const directive of parsed) {
    out += text.slice(cursor, directive.start) + canonicalDirective(directive)
    cursor = directive.end
  }
  return out + text.slice(cursor)
}

export type DirectiveQuery = { kind: DirectiveKind; keyword: string; start: number; end: number; query: string }

const VALUE_QUERY = new RegExp(`@(${typedKeywordAlternation()}):(?:<<)?([^<>\\n{}(),;:!?"'\`]*)$`)

/**
 * The directive being typed at the caret, if any.
 *
 * It deliberately matches the *incomplete* prefix too — `@ref:` with nothing
 * after it is someone who has just decided to reference a project and wants to
 * be shown the list. Any accepted alias works here exactly as the canonical
 * keyword does; `keyword` keeps the exact word typed so a re-render can leave
 * it alone until the operator picks something or finishes the value.
 */
export function directiveQuery(value: string, caret: number): DirectiveQuery | undefined {
  const before = value.slice(0, Math.max(0, caret))
  const match = VALUE_QUERY.exec(before)
  if (!match) return undefined
  const kind = KIND_ALIASES[match[1]]
  if (!kind) return undefined
  return { kind, keyword: match[1], start: match.index, end: caret, query: match[2].trim() }
}

/**
 * The directive *kind* being chosen, before any keyword is complete — a bare
 * `@`, or a partial word with no `:` yet. This is what lets typing `@` alone
 * open a menu of the available directives instead of requiring the operator to
 * already know and spell one out.
 *
 * It only fires when directiveQuery does not: the two are distinguished by
 * whether a `:` has been typed, so a caret can never be in both states.
 */
export function directiveKindQuery(value: string, caret: number): { start: number; end: number; query: string } | undefined {
  const before = value.slice(0, Math.max(0, caret))
  const match = /@([A-Za-z]*)$/.exec(before)
  if (!match) return undefined
  return { start: match.index, end: caret, query: match[1].toLowerCase() }
}

export type DirectiveKindSuggestion = { keyword: string; kind: DirectiveKind; label: string; aliases: string[] }

/** The directive kinds whose keyword or any alias starts with what was typed. */
export function directiveKindSuggestions(query: string): DirectiveKindSuggestion[] {
  const needle = query.toLowerCase()
  return KEYWORDS.filter((entry) => !needle || [entry.keyword, ...entry.aliases].some((word) => word.startsWith(needle)))
    .map((entry) => ({ keyword: entry.keyword, kind: entry.kind, label: entry.label, aliases: entry.aliases }))
}

/** Inserts `@<keyword>:` at the kind query's range and leaves the caret ready
 * for the value query that opens immediately after. */
export function applyDirectiveKindSuggestion(text: string, query: { start: number; end: number }, suggestion: DirectiveKindSuggestion) {
  const typed = `@${suggestion.keyword}:`
  return { text: text.slice(0, query.start) + typed + text.slice(query.end), caret: query.start + typed.length }
}

/**
 * Splits a `@ref` query into the project part and the in-project path part, so
 * the menu can offer projects first and that project's files after the slash.
 */
export function splitRefQuery(query: string) {
  const separator = query.indexOf('/')
  if (separator < 0) return { project: query, path: undefined as string | undefined }
  return { project: query.slice(0, separator), path: query.slice(separator + 1) }
}

function rank(candidates: string[], needle: string, limit = 8) {
  const query = needle.toLowerCase()
  return candidates
    .filter((candidate) => !query || candidate.toLowerCase().includes(query))
    .sort((left, right) => {
      const leftBase = left.split('/').pop()?.toLowerCase() || left.toLowerCase()
      const rightBase = right.split('/').pop()?.toLowerCase() || right.toLowerCase()
      const leftStarts = leftBase.startsWith(query) ? 0 : 1
      const rightStarts = rightBase.startsWith(query) ? 0 : 1
      return leftStarts - rightStarts || left.length - right.length || left.localeCompare(right)
    })
    .slice(0, limit)
}

export function matchingProjectFiles(paths: string[], query: string) {
  return rank(paths, query)
}

export type ReferenceableProject = {
  name: string
  projectPath: string
  files: string[]
  /**
   * Whether this project's context is already part of the current request.
   * An unattached project is still nameable — Wharnex has worked on it before
   * — but its file list is empty until it is brought in, which happens
   * automatically once the reference resolves at submit time.
   */
  attached: boolean
}

export type DirectiveSuggestion = {
  /** The value to insert, i.e. what goes after `@file:` or `@ref:`. */
  value: string
  /** What the row shows. */
  label: string
  detail?: string
  /** A project row that only narrows the query rather than completing it. */
  continues?: boolean
  /** For a `ref` project row: whether its context is already attached. */
  attached?: boolean
}

/**
 * The rows to offer for the directive being typed.
 *
 * A `@ref` with no slash yet offers projects, and selecting one keeps the menu
 * open on `project/` so the operator can go straight on to a file — referencing
 * a whole project and referencing a file inside it are the same intent at two
 * levels of detail, and the menu should not make them feel like two decisions.
 */
export function directiveSuggestions(
  query: DirectiveQuery,
  projectFiles: string[],
  projects: ReferenceableProject[],
): DirectiveSuggestion[] {
  // An attachment names a path outside every project, so there is nothing for
  // Wharnex to complete from: the operator picks it, and the picker is offered
  // as the row instead of a list of guesses.
  if (query.kind === 'attach') return []
  if (query.kind === 'file') {
    return matchingProjectFiles(projectFiles, query.query).map((path) => ({ value: path, label: path }))
  }
  const { project, path } = splitRefQuery(query.query)
  if (path === undefined) {
    return rank(projects.map((item) => item.name), project).map((name) => {
      const match = projects.find((item) => item.name === name)
      return { value: `${name}/`, label: name, detail: match?.projectPath, continues: true, attached: match?.attached }
    })
  }
  const target = projects.find((item) => item.name.toLowerCase() === project.toLowerCase())
  if (!target) return []
  return matchingProjectFiles(target.files, path).map((file) => ({
    value: `${target.name}/${file}`, label: file, detail: target.name,
  }))
}

/**
 * Replaces the directive being typed with the chosen one, in place.
 *
 * The inserted text is canonical, so the chip the operator sees and the marker
 * the model receives are the same string; there is no later rewrite that could
 * move it. The caret lands after the directive — or inside it, for a project row
 * that is still being narrowed.
 */
export function applyDirectiveSuggestion(
  text: string,
  query: DirectiveQuery,
  suggestion: DirectiveSuggestion,
): { text: string; caret: number } {
  if (suggestion.continues) {
    const typed = `@${query.kind}:${suggestion.value}`
    return { text: text.slice(0, query.start) + typed + text.slice(query.end), caret: query.start + typed.length }
  }
  const canonical = canonicalDirective({ kind: query.kind, value: suggestion.value })
  const rest = text.slice(query.end)
  const spacer = rest.startsWith(' ') || rest.startsWith('\n') || rest === '' ? '' : ' '
  return {
    text: text.slice(0, query.start) + canonical + spacer + rest,
    caret: query.start + canonical.length + spacer.length,
  }
}

export type DirectiveSegment = { text: string; directive?: ComposerDirective }

/**
 * The prompt split into plain runs and directive runs, for the overlay that
 * paints a chip behind each directive.
 *
 * A textarea cannot render an element inside its own value, so the chip is
 * drawn by a mirror layer behind it with identical text metrics. That keeps the
 * caret, selection, undo history, IME and spellcheck the browser's — everything
 * a contenteditable rewrite would have had to reimplement — while the operator
 * still sees where each directive begins and ends.
 */
export function directiveSegments(text: string): DirectiveSegment[] {
  const parsed = parseDirectives(text)
  if (!parsed.length) return [{ text }]
  const segments: DirectiveSegment[] = []
  let cursor = 0
  for (const directive of parsed) {
    if (directive.start > cursor) segments.push({ text: text.slice(cursor, directive.start) })
    segments.push({ text: text.slice(directive.start, directive.end), directive })
    cursor = directive.end
  }
  if (cursor < text.length) segments.push({ text: text.slice(cursor) })
  return segments
}

/** The human label for a directive kind, for an Info popover or a picker row. */
export function directiveKindLabel(kind: DirectiveKind) {
  return KEYWORDS.find((entry) => entry.kind === kind)?.label || kind
}

/**
 * Removes one directive from the text, collapsing the whitespace it leaves
 * behind so deleting a chip never leaves a double space or a trailing blank.
 */
export function removeDirective(text: string, directive: Pick<ComposerDirective, 'start' | 'end'>) {
  const before = text.slice(0, directive.start)
  const after = text.slice(directive.end)
  const trimmedBefore = before.replace(/[ \t]+$/, '')
  const trimmedAfter = after.replace(/^[ \t]+/, '')
  const needsSpace = Boolean(trimmedBefore) && Boolean(trimmedAfter) && !trimmedBefore.endsWith('\n') && !trimmedAfter.startsWith('\n')
  return trimmedBefore + (needsSpace ? ' ' : '') + trimmedAfter
}

/** A short label for a chip: the basename is what identifies it at a glance. */
export function directiveChipLabel(directive: ComposerDirective) {
  if (directive.kind === 'attach') {
    const base = directive.path.split('/').filter(Boolean).pop() || directive.path
    const rules = (directive.rules?.include.length || 0) + (directive.rules?.exclude.length || 0)
    return rules ? `${base} · ${rules} regra(s)` : base
  }
  if (directive.kind === 'file') return directive.path.split('/').pop() || directive.path
  if (!directive.path) return directive.project
  return `${directive.project}/${directive.path.split('/').pop()}`
}

/**
 * Legacy trailing block for references chosen under the old list model.
 *
 * Inline markers replaced it: a reference now stays in the sentence that needed
 * it. This survives only for a queued request that was composed before the
 * change and still carries its own list, and it produces nothing for the empty
 * list every new request now sends.
 */
export function projectFileReferenceSuffix(paths: string[]) {
  const unique = [...new Set(paths.map((path) => path.trim()).filter(Boolean))].slice(0, 32)
  if (!unique.length) return ''
  const tokens = unique.map((path) => canonicalDirective({ kind: 'file', value: path })).join(' ')
  return `\n\nFicheiros do projeto explicitamente referenciados pelo utilizador: ${tokens}`
}
