import { describe, expect, it } from 'vitest'
import {
  applyDirectiveKindSuggestion,
  applyDirectiveSuggestion,
  canonicalizeDirectives,
  directiveChipLabel,
  directiveKindQuery,
  directiveKindSuggestions,
  directiveQuery,
  directiveSegments,
  directiveSuggestions,
  KEYWORDS,
  parseDirectives,
  removeDirective,
} from './composerDirectives'

const projects = [
  { name: 'flowcore', projectPath: '/home/op/flowcore', files: ['services/be/auth.go', 'README.md'], attached: true },
  { name: 'siage', projectPath: '/home/op/siage', files: ['src/lib/auth.ts'], attached: true },
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
    const projectRows = directiveSuggestions(projectQuery!, [], projects, [])
    expect(projectRows[0]).toMatchObject({ value: 'flowcore/', label: 'flowcore', continues: true })

    const fileQuery = directiveQuery('change @ref:flowcore/auth', 25)
    const fileRows = directiveSuggestions(fileQuery!, [], projects, [])
    expect(fileRows[0]).toMatchObject({ value: 'flowcore/services/be/auth.go', label: 'services/be/auth.go' })
  })

  it('lets a selected project complete as an inline chip when it has no browsable files', () => {
    const project = { name: 'sgdp-formatter', projectPath: '/work/sgdp-formatter', files: [], attached: false }
    const query = directiveQuery('@ref:sgdp-formatter/', '@ref:sgdp-formatter/'.length)
    expect(directiveSuggestions(query!, [], [project], [])).toEqual([{
      value: 'sgdp-formatter', label: 'Todo o projeto', detail: 'sgdp-formatter', attached: false,
    }])
  })

  it('offers this project’s files for @file', () => {
    const query = directiveQuery('read @file:auth', 15)
    expect(query).toMatchObject({ kind: 'file', query: 'auth' })
    expect(directiveSuggestions(query!, ['src/lib/auth.ts', 'README.md'], projects, [])[0]).toMatchObject({
      value: 'src/lib/auth.ts',
    })
  })

  // An empty prefix is someone who has just decided to reference something and
  // wants the list, not someone who typed nothing.
  it('opens the menu on a bare prefix', () => {
    expect(directiveQuery('now @ref:', 9)).toMatchObject({ kind: 'ref', query: '' })
    expect(directiveSuggestions(directiveQuery('now @ref:', 9)!, [], projects, [])).toHaveLength(2)
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
    expect(directive.rules).toEqual({ autoExclude: true, include: ['openapi/**'], includeOverrides: [], exclude: ['**/*.bak'] })
  })

  it('defaults to automatic pruning and supports opting out', () => {
    expect(parseDirectives('@attach:/srv/x')[0].rules).toEqual({ autoExclude: true, include: [], includeOverrides: [], exclude: [] })
    expect(parseDirectives('@{[attach]/srv/x|!auto}')[0].rules?.autoExclude).toBe(false)
  })

  it('round-trips explicit per-file restores separately from an include allowlist', () => {
    const [directive] = parseDirectives('@{[attach]/srv/x|^node_modules/pkg/index.d.ts}')
    expect(directive.rules?.includeOverrides).toEqual(['node_modules/pkg/index.d.ts'])
    expect(canonicalizeDirectives('@{[attach]/srv/x|^node_modules/pkg/index.d.ts}')).toBe('@{[attach]/srv/x|^node_modules/pkg/index.d.ts}')
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
    expect(directiveSuggestions(directiveQuery('junta @attach:/srv', 17)!, ['a.ts'], projects, [])).toHaveLength(0)
  })

  it('labels an attach chip by its basename and rule count', () => {
    const [plain] = parseDirectives('@{[attach]/srv/contracts}')
    expect(directiveChipLabel(plain)).toBe('contracts')
    const [scoped] = parseDirectives('@{[attach]/srv/contracts|+a/**|-b/**}')
    expect(directiveChipLabel(scoped)).toBe('contracts · 2 regra(s)')
  })
})

describe('see directives', () => {
  const attachmentNames = ['diagram.png', 'notes.txt']

  // Bare values remain the legacy direct-upload spelling.
  it('parses @see and its @look alias to the same kind', () => {
    const [seen] = parseDirectives('@see:diagram.png')
    expect(seen).toMatchObject({ kind: 'see', value: 'diagram.png', path: 'diagram.png' })
    const [looked] = parseDirectives('@look:diagram.png')
    expect(looked).toMatchObject({ kind: 'see', value: 'diagram.png', path: 'diagram.png' })
  })

  it('canonicalizes @see/@look to the same @{[see]…} form', () => {
    expect(canonicalizeDirectives('compara @look:before.png com @see:after.png'))
      .toBe('compara @{[see]before.png} com @{[see]after.png}')
  })

  it('refuses unqualified paths and accepts source-qualified context paths', () => {
    for (const text of ['@see:../secrets.txt', '@see:dir/file.png', '@{[see]a/b}']) {
      expect(parseDirectives(text)).toHaveLength(0)
    }
    expect(parseDirectives('@{[see]project|src/App.tsx}')[0]).toMatchObject({ project: 'project', path: 'src/App.tsx' })
    expect(parseDirectives('@{[see]ref|flowcore|services/api/auth.go}')[0]).toMatchObject({ project: 'flowcore', path: 'services/api/auth.go' })
    expect(parseDirectives('@{[see]attach|/srv/contracts|openapi/api.yml}')[0]).toMatchObject({ project: '/srv/contracts', path: 'openapi/api.yml' })
  })

  it('requires a direct-upload source before offering its file names', () => {
    const query = directiveQuery('junta @see:', 11)!
    expect(directiveSuggestions(query, [], projects, attachmentNames)).toEqual(expect.arrayContaining([
      { value: 'upload|', label: 'Anexos diretos', detail: '2 ficheiro(s) anexado(s)', continues: true, sourceIcon: 'file' },
    ]))
    const files = directiveSuggestions(directiveQuery('junta @see:upload|dia', 21)!, [], projects, attachmentNames)
    expect(files).toEqual([{ value: 'upload|diagram.png', label: 'diagram.png', detail: 'Anexo direto' }])
  })

  it('offers context sources first, then files only within the selected source', () => {
    const visibleProjects = [{
      name: 'flowcore', projectPath: '/work/flowcore', attached: true,
      files: ['services/api/auth.go'],
    }]
    const query = directiveQuery('destaca @see:', 'destaca @see:'.length)!
    expect(directiveSuggestions(query, ['src/App.tsx'], visibleProjects, ['diagram.png'])).toEqual(expect.arrayContaining([
      expect.objectContaining({ value: 'project|', label: 'Projeto atual', continues: true }),
      expect.objectContaining({ value: 'ref|flowcore|', label: '@ref flowcore', continues: true }),
      expect.objectContaining({ value: 'upload|', label: 'Anexos diretos', continues: true }),
    ]))
    expect(directiveSuggestions(directiveQuery('destaca @see:ref|flowcore|', 'destaca @see:ref|flowcore|'.length)!, ['src/App.tsx'], visibleProjects, ['diagram.png']))
      .toEqual([{ value: 'ref|flowcore|services/api/auth.go', label: 'services/api/auth.go', detail: '@ref flowcore' }])
  })

  it('labels a see chip by the attachment name', () => {
    const [directive] = parseDirectives('@{[see]diagram.png}')
    expect(directiveChipLabel(directive)).toBe('diagram.png')
  })
})

describe('aliases', () => {
  // An operator reaching for "the other project" or "something outside the
  // project" should not have to remember one exact word for it.
  it('parses every ref and attach alias to the canonical kind', () => {
    for (const alias of ['ref', 'reference', 'references', 'project']) {
      const [directive] = parseDirectives(`@${alias}:flowcore`)
      expect(directive.kind).toBe('ref')
      expect(directive.project).toBe('flowcore')
    }
    for (const alias of ['attach', 'att', 'attch', 'attche', 'attaches', 'attahes', 'dir']) {
      const [directive] = parseDirectives(`@${alias}:/srv/x`)
      expect(directive.kind).toBe('attach')
      expect(directive.path).toBe('/srv/x')
    }
  })

  // Whichever alias was typed, what is sent is always the one canonical
  // keyword — there is exactly one spelling a continuation ever re-parses.
  it('canonicalizes every alias to the primary keyword', () => {
    expect(canonicalizeDirectives('olha @project:flowcore e @dir:/srv/sdk')).toBe('olha @{[ref]flowcore} e @{[attach]/srv/sdk}')
  })

  // A menu built from anything other than KEYWORDS would silently drift from
  // what the parser actually accepts.
  it('walks the whole KEYWORDS table end to end', () => {
    for (const entry of KEYWORDS) {
      for (const word of [entry.keyword, ...entry.aliases]) {
        const value = entry.kind === 'attach' ? '/srv/x' : entry.kind === 'lib' ? 'session|ses_123|artifact_456' : entry.kind === 'chat' ? 'diagram.png' : 'flowcore'
        const [directive] = parseDirectives(`@${word}:${value}`)
        expect(directive?.kind).toBe(entry.kind)
      }
    }
  })

  it('indexes chat and library files with stable canonical markers', () => {
    expect(canonicalizeDirectives('usa @chat:diagram.png e @library:session|ses_123|artifact_456'))
      .toBe('usa @{[chat]diagram.png} e @{[lib]session|ses_123|artifact_456}')
    expect(parseDirectives('@chat:entry|artifact_bundle|artifacts/report.pdf')[0]).toMatchObject({ kind: 'chat', project: 'artifact_bundle', path: 'artifacts/report.pdf' })
  })
})

describe('bare @ kind picker', () => {
  // Typing "@" alone, with no keyword yet, must not be mistaken for a value
  // query — the two are distinguished by whether a ":" was typed.
  it('opens only before a keyword is typed', () => {
    expect(directiveKindQuery('olha @', 6)).toMatchObject({ query: '' })
    expect(directiveKindQuery('olha @re', 8)).toMatchObject({ query: 're' })
    expect(directiveKindQuery('olha @ref:flow', 14)).toBeUndefined()
  })

  it('filters by keyword or any alias', () => {
    expect(directiveKindSuggestions('').map((s) => s.kind)).toEqual(['file', 'ref', 'attach', 'see', 'chat', 'lib'])
    expect(directiveKindSuggestions('proj').map((s) => s.kind)).toEqual(['ref'])
    expect(directiveKindSuggestions('dir').map((s) => s.kind)).toEqual(['attach'])
  })

  // Picking a kind inserts its canonical keyword and colon, leaving the caret
  // exactly where the value query picks up — so the two menus chain into one
  // continuous flow instead of requiring the operator to retype anything.
  it('inserts the canonical keyword and hands off to the value query', () => {
    const text = 'olha @re'
    const query = directiveKindQuery(text, 8)!
    const applied = applyDirectiveKindSuggestion(text, query, { keyword: 'ref', kind: 'ref', label: 'Outro projeto', aliases: [] })
    expect(applied.text).toBe('olha @ref:')
    expect(applied.caret).toBe(applied.text.length)
    expect(directiveQuery(applied.text, applied.caret)).toMatchObject({ kind: 'ref', query: '' })
  })
})

describe('unattached known projects', () => {
  const known = [
    { name: 'flowcore', projectPath: '/home/op/flowcore', files: ['services/be/auth.go'], attached: true },
    { name: 'legacy', projectPath: '/home/op/legacy', files: [], attached: false },
  ]

  // A project Wharnex has worked on before is nameable whether or not its
  // context is currently attached to this request.
  it('offers a project that is known but not attached', () => {
    const rows = directiveSuggestions(directiveQuery('junta @ref:leg', 14)!, [], known, [])
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ value: 'legacy/', attached: false })
  })
})

describe('removeDirective', () => {
  it('deletes a directive and collapses the whitespace it leaves behind', () => {
    expect(removeDirective('veja @{[file]a.ts} agora', parseDirectives('veja @{[file]a.ts} agora')[0])).toBe('veja agora')
  })

  it('never leaves a double space at the start or end of the text', () => {
    expect(removeDirective('@{[file]a.ts} agora', parseDirectives('@{[file]a.ts} agora')[0])).toBe('agora')
    expect(removeDirective('veja @{[file]a.ts}', parseDirectives('veja @{[file]a.ts}')[0])).toBe('veja')
  })
})
