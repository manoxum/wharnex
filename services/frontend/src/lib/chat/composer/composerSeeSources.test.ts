import { describe, expect, it } from 'vitest'
import { parseDirectives } from './composerDirectives'
import { composerDirectiveState } from './composerDirectiveIndex'
import { seeDirectiveAvailable, seeSuggestions } from './composerSeeSources'

const projects = [{ name: 'core', projectPath: '/work/core', attached: true, files: ['api/auth.go', 'docs/spec.md'] }]
const chatFiles = [{ value: 'artifact|chat_1', label: 'chat.md' }, { value: 'artifact|chat_2', label: 'other.md' }]
const libraryFiles = [{ value: 'session|ses_1|lib_1', label: 'lib.pdf' }, { value: 'session|ses_1|lib_2', label: 'other.pdf' }]
const todos = [{ value: 'todo_1', label: 'Fix composer' }, { value: 'todo_2', label: 'Other TODO' }]

function indexed(text: string) { return composerDirectiveState(text).indexed }

describe('@see indexed sources', () => {
  it('ignores typed fragments until another directive is a completed canonical marker', () => {
    expect(indexed('@lib:session|ses_1|lib_1 @see:')).toEqual([])
    expect(indexed('@{[lib]session|ses_1|lib_1} @see:').map((item) => item.kind)).toEqual(['lib'])
  })

  it('offers only already-indexed sources in the required priority order', () => {
    const rows = seeSuggestions('', ['src/App.tsx', 'hidden.ts'], projects, ['direct.txt'], [], chatFiles, libraryFiles, todos, indexed(
      '@{[chat]artifact|chat_1} @{[file]src} @{[todo]todo_1} @{[lib]session|ses_1|lib_1} @{[ref]core/api}',
    ))
    expect(rows.map((row) => row.value)).toEqual([
      'upload|', 'file|', 'ref|core|', 'lib|', 'chat|', 'todo|',
    ])
  })

  it('limits project and ref targets to the scopes already indexed in the composer', () => {
    const sources = indexed('@{[file]src} @{[ref]core/api}')
    expect(seeSuggestions('file|', ['src/App.tsx', 'hidden.ts'], projects, [], [], [], [], [], sources).map((row) => row.value))
      .toEqual(['file|src', 'file|src/App.tsx'])
    expect(seeSuggestions('ref|core|', [], projects, [], [], [], [], [], sources).map((row) => row.value))
      .toEqual(['ref|core|api', 'ref|core|api/auth.go'])
  })

  it('limits chat, library and todo targets to their indexed canonical markers', () => {
    const sources = indexed('@{[chat]artifact|chat_1} @{[lib]session|ses_1|lib_1} @{[todo]todo_1}')
    expect(seeSuggestions('chat|', [], [], [], [], chatFiles, libraryFiles, todos, sources).map((row) => row.value)).toEqual(['chat|artifact|chat_1'])
    expect(seeSuggestions('lib|', [], [], [], [], chatFiles, libraryFiles, todos, sources).map((row) => row.value)).toEqual(['lib|session|ses_1|lib_1'])
    expect(seeSuggestions('todo|', [], [], [], [], chatFiles, libraryFiles, todos, sources).map((row) => row.value)).toEqual(['todo|todo_1'])
  })

  it('requires the non-upload spotlight target to have a backing indexed directive', () => {
    const [spotlight] = parseDirectives('@{[see]todo|todo_1}')
    expect(seeDirectiveAvailable(spotlight, [], [], [], [], [], [], todos, [])).toBe(false)
    expect(seeDirectiveAvailable(spotlight, [], [], [], [], [], [], todos, indexed('@{[todo]todo_1}'))).toBe(true)
  })
})
