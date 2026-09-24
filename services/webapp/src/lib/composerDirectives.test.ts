import { describe, expect, it } from 'vitest'
import { makeDirective, parseDirectives, removeDirective } from './composerDirectives'

describe('remote composer directives', () => {
  it('uses the canonical Desktop marker for every inserted directive', () => {
    expect(makeDirective('file', 'src/App.tsx')).toBe('@{[file]src/App.tsx}')
    expect(makeDirective('see', 'upload|shot.png')).toBe('@{[see]upload|shot.png}')
  })

  it('parses canonical markers and familiar typed aliases as removable chips', () => {
    const value = 'Compare @{[file]src/App.tsx} com @project:core/src/main.ts.'
    expect(parseDirectives(value).map(({ kind, value }) => ({ kind, value }))).toEqual([
      { kind: 'file', value: 'src/App.tsx' },
      { kind: 'ref', value: 'core/src/main.ts.' },
    ])
  })

  it('removes a directive without leaving doubled whitespace', () => {
    const value = 'Abra @{[chat]entry|abc|report.md} agora'
    const directive = parseDirectives(value)[0]
    expect(removeDirective(value, directive)).toBe('Abra agora')
  })
})
