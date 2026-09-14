import { describe, expect, it } from 'vitest'
import {
  applyDirectiveSuggestion,
  canonicalizeDirectives,
  directiveChipLabel,
  directiveQuery,
  directiveSegments,
  directiveSuggestions,
  parseDirectives,
} from './composerDirectives'

const projects = [
  { name: 'flowcore', projectPath: '/home/op/flowcore', files: ['services/be/auth.go', 'README.md'] },
  { name: 'siage', projectPath: '/home/op/siage', files: ['src/lib/auth.ts'] },
]

describe('composer directives', () => {
  // The same grammar as the Go parser: a prompt mixing what the operator typed
  // with what a round trip canonicalized is the ordinary case.
  it('parses both spellings and keeps the range each one occupied', () => {
    const text = 'compare @file:src/a.ts with @{[ref]flowcore/services/be/auth.go} and @ref:siage'
    const parsed = parseDirectives(text)
    expect(parsed.map((item) => [item.kind, item.value])).toEqual([
      ['file', 'src/a.ts'],
      ['ref', 'flowcore/services/be/auth.go'],
      ['ref', 'siage'],
    ])
    expect(text.slice(parsed[0].start, parsed[0].end)).toBe('@file:src/a.ts')
  })

  // A near-miss is prose. Repairing it is how a traversal becomes a resolved
  // path, so it stays untouched and is never offered as a chip.
  it('leaves malformed directives as plain text', () => {
    for (const text of ['@file:../../etc/passwd', '@file:/etc/passwd', '@ref:../etc', '@ref:.', '@file:', '@ref:']) {
      expect(parseDirectives(text)).toHaveLength(0)
    }
  })

  it('canonicalizes only the directives and is idempotent', () => {
    const once = canonicalizeDirectives('fix @file:<<src/a b.ts>> using @ref:flowcore, keep @notadirective')
    expect(once).toBe('fix @{[file]src/a b.ts} using @{[ref]flowcore}, keep @notadirective')
    expect(canonicalizeDirectives(once)).toBe(once)
  })

  it('offers projects for @ref and that project’s files after the slash', () => {
    const projectQuery = directiveQuery('change @ref:flow', 16)
    expect(projectQuery).toMatchObject({ kind: 'ref', query: 'flow' })
    const projectRows = directiveSuggestions(projectQuery!, [], projects)
    expect(projectRows[0]).toMatchObject({ value: 'flowcore/', label: 'flowcore', continues: true })

    const fileQuery = directiveQuery('change @ref:flowcore/auth', 25)
    const fileRows = directiveSuggestions(fileQuery!, [], projects)
    expect(fileRows[0]).toMatchObject({ value: 'flowcore/services/be/auth.go', label: 'services/be/auth.go' })
  })

  it('offers this project’s files for @file', () => {
    const query = directiveQuery('read @file:auth', 15)
    expect(query).toMatchObject({ kind: 'file', query: 'auth' })
    expect(directiveSuggestions(query!, ['src/lib/auth.ts', 'README.md'], projects)[0]).toMatchObject({
      value: 'src/lib/auth.ts',
    })
  })

  // An empty prefix is someone who has just decided to reference something and
  // wants the list, not someone who typed nothing.
  it('opens the menu on a bare prefix', () => {
    expect(directiveQuery('now @ref:', 9)).toMatchObject({ kind: 'ref', query: '' })
    expect(directiveSuggestions(directiveQuery('now @ref:', 9)!, [], projects)).toHaveLength(2)
  })

  // The directive is inserted where it was being typed, canonical from the
  // start, so the chip the operator sees and the marker the model receives are
  // the same string.
  it('inserts the chosen directive in place, in canonical form', () => {
    const text = 'compare @file:auth with the contract'
    const query = directiveQuery(text.slice(0, 18), 18)!
    const applied = applyDirectiveSuggestion(text, query, { value: 'src/lib/auth.ts', label: 'auth.ts' })
    expect(applied.text).toBe('compare @{[file]src/lib/auth.ts} with the contract')
    expect(applied.caret).toBe('compare @{[file]src/lib/auth.ts}'.length)
  })

  // Picking a project narrows the query instead of ending it: referencing a
  // project and referencing a file inside it are one intent at two levels.
  it('keeps a project row open so a file can follow', () => {
    const text = 'change @ref:flow'
    const applied = applyDirectiveSuggestion(text, directiveQuery(text, 16)!, { value: 'flowcore/', label: 'flowcore', continues: true })
    expect(applied.text).toBe('change @ref:flowcore/')
    expect(applied.caret).toBe(applied.text.length)
  })

  it('segments the prompt so each directive can be painted in place', () => {
    const segments = directiveSegments('a @{[file]x.ts} b')
    expect(segments.map((segment) => segment.text)).toEqual(['a ', '@{[file]x.ts}', ' b'])
    expect(segments[1].directive?.kind).toBe('file')
    expect(segments[0].directive).toBeUndefined()
  })

  it('labels a chip by what identifies it at a glance', () => {
    const [file] = parseDirectives('@{[file]services/app/src/lib/auth.ts}')
    expect(directiveChipLabel(file)).toBe('auth.ts')
    const [project] = parseDirectives('@{[ref]flowcore}')
    expect(directiveChipLabel(project)).toBe('flowcore')
    const [scoped] = parseDirectives('@{[ref]flowcore/services/be/auth.go}')
    expect(directiveChipLabel(scoped)).toBe('flowcore/auth.go')
  })
})

describe('attach directives', () => {
  // The rules ride inside the marker so the prompt text stays the whole state.
  it('parses an attached folder with its include/exclude selection', () => {
    const [directive] = parseDirectives('junta @{[attach]/srv/contracts|+openapi/**|-**/*.bak}')
    expect(directive.kind).toBe('attach')
    expect(directive.path).toBe('/srv/contracts')
    expect(directive.rules).toEqual({ autoExclude: true, include: ['openapi/**'], exclude: ['**/*.bak'] })
  })

  it('defaults to automatic pruning and supports opting out', () => {
    expect(parseDirectives('@attach:/srv/x')[0].rules).toEqual({ autoExclude: true, include: [], exclude: [] })
    expect(parseDirectives('@{[attach]/srv/x|!auto}')[0].rules?.autoExclude).toBe(false)
  })

  // An attachment names something outside the project, so a relative path or a
  // traversal is prose rather than a directive with a bad value.
  it('refuses what it cannot resolve honestly', () => {
    for (const text of ['@attach:relative/path', '@attach:/srv/../etc', '@attach:/', '@{[attach]/srv/x|+../escape}']) {
      expect(parseDirectives(text)).toHaveLength(0)
    }
  })

  it('canonicalizes attachments idempotently, rules included', () => {
    const once = canonicalizeDirectives('usa @attach:/srv/contracts e @{[attach]/srv/sdk|+src/**}')
    expect(once).toBe('usa @{[attach]/srv/contracts} e @{[attach]/srv/sdk|+src/**}')
    expect(canonicalizeDirectives(once)).toBe(once)
  })

  // There is nothing to autocomplete for a path outside every project; the
  // picker is the affordance, not a list of guesses.
  it('offers no completions for @attach', () => {
    expect(directiveSuggestions(directiveQuery('junta @attach:/srv', 17)!, ['a.ts'], projects)).toHaveLength(0)
  })

  it('labels an attach chip by its basename and rule count', () => {
    const [plain] = parseDirectives('@{[attach]/srv/contracts}')
    expect(directiveChipLabel(plain)).toBe('contracts')
    const [scoped] = parseDirectives('@{[attach]/srv/contracts|+a/**|-b/**}')
    expect(directiveChipLabel(scoped)).toBe('contracts · 2 regra(s)')
  })
})
