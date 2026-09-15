import { describe, expect, it } from 'vitest'
import {
  deltaToCanonicalText,
  directiveChipBadge,
  directivesToDelta,
  quillIndexToTextOffset,
  textOffsetToQuillIndex,
} from './composerRichText'

describe('directivesToDelta / deltaToCanonicalText', () => {
  // The Delta is a view; reducing it back must reproduce the exact string it
  // was built from, the same round-trip guarantee canonicalizeDirectives keeps.
  it('round-trips a prompt with a directive in the middle', () => {
    const text = 'Revê @{[file]src/App.tsx} agora'
    const delta = directivesToDelta(text)
    expect(deltaToCanonicalText(delta)).toBe(text)
  })

  it('renders a directive as a single embed op carrying its value', () => {
    const delta = directivesToDelta('junta @{[attach]/srv/contracts|+a/**}')
    const embed = delta.ops.find((op) => typeof op.insert !== 'string')
    expect(embed?.insert).toMatchObject({ 'directive-chip': { kind: 'attach', path: '/srv/contracts' } })
  })

  // The mandatory structural newline is appended unconditionally, even when the
  // text already ends in one of its own — otherwise the two cases collide and
  // a real trailing blank line the operator typed would be stripped away.
  it('always ends the delta in one mandatory trailing newline, on top of any the text already carries', () => {
    expect(directivesToDelta('sem quebra').ops.at(-1)).toEqual({ insert: '\n' })
    expect(directivesToDelta('com quebra\n').ops.at(-1)).toEqual({ insert: '\n' })
    expect(deltaToCanonicalText(directivesToDelta('sem quebra'))).toBe('sem quebra')
    expect(deltaToCanonicalText(directivesToDelta('com quebra\n'))).toBe('com quebra\n')
  })

  it('round-trips multiple directives and a multi-line prompt', () => {
    const text = 'linha 1 @{[ref]core}\nlinha 2 @{[see]diagram.png} fim'
    expect(deltaToCanonicalText(directivesToDelta(text))).toBe(text)
  })

  it('round-trips a prompt with no directives at all', () => {
    expect(deltaToCanonicalText(directivesToDelta('apenas texto simples'))).toBe('apenas texto simples')
  })

  // `@file:App` is recognized as a directive by the text grammar the instant a
  // value follows the colon — normal while the operator is still typing
  // towards a menu selection — but nothing has embedded it yet. Treating it as
  // a collapsed chip here would be inventing an embed the live Quill document
  // does not have, which is exactly what broke autocomplete mid-composition.
  it('leaves a typed-form directive as plain text, not a collapsed embed', () => {
    const delta = directivesToDelta('Revê @file:App e depois pára')
    expect(delta.ops.every((op) => typeof op.insert === 'string')).toBe(true)
    expect(delta.ops.map((op) => op.insert).join('')).toBe('Revê @file:App e depois pára\n')
  })

  it('still embeds a canonical marker even mixed with a typed-form one', () => {
    const delta = directivesToDelta('usa @{[file]a.ts} e depois @ref:core')
    const embeds = delta.ops.filter((op) => typeof op.insert !== 'string')
    expect(embeds).toHaveLength(1)
    expect(embeds[0].insert).toMatchObject({ 'directive-chip': { kind: 'file', value: 'a.ts' } })
  })
})

describe('textOffsetToQuillIndex / quillIndexToTextOffset', () => {
  const text = 'Revê @{[file]src/App.tsx} agora'
  const markerLength = '@{[file]src/App.tsx}'.length

  it('maps a caret before the directive one-to-one', () => {
    expect(textOffsetToQuillIndex(text, 0)).toBe(0)
    expect(textOffsetToQuillIndex(text, 5)).toBe(5)
  })

  // Every offset inside the marker collapses to the chip's own single index —
  // there is no finer position inside an atomic embed.
  it('collapses any offset inside the marker to the chip embed index', () => {
    expect(textOffsetToQuillIndex(text, 6)).toBe(5)
    expect(textOffsetToQuillIndex(text, 5 + markerLength - 1)).toBe(5)
  })

  it('maps a caret after the directive back onto one-to-one text offsets', () => {
    const afterMarker = 5 + markerLength // the space right after "}"
    expect(textOffsetToQuillIndex(text, afterMarker)).toBe(6) // directly after the embed
    expect(textOffsetToQuillIndex(text, afterMarker + 1)).toBe(7) // one char into " agora"
  })

  // A typed-form directive mid-composition (no embed yet) keeps a one-to-one
  // mapping like any other text — this is the case that broke autocomplete:
  // a caret placed right after "@file:App" must resolve to the real index at
  // the end of those 9 plain characters, not to a collapsed embed index.
  it('keeps a one-to-one mapping through a typed-form directive that has no embed yet', () => {
    const typed = 'Revê @file:App e depois pára'
    expect(textOffsetToQuillIndex(typed, 14)).toBe(14)
    expect(quillIndexToTextOffset(typed, 14)).toBe(14)
  })

  it('resolves a click on the chip embed index back to the marker’s start', () => {
    expect(quillIndexToTextOffset(text, 5)).toBe(5)
  })

  it('maps the caret immediately after the chip to the end of its canonical marker', () => {
    expect(quillIndexToTextOffset(text, 6)).toBe(5 + markerLength)
  })

  it('resolves a quill index in plain text back to the same text offset', () => {
    expect(quillIndexToTextOffset(text, 3)).toBe(3)
    expect(quillIndexToTextOffset(text, 7)).toBe(5 + markerLength + 1)
  })
})

describe('directiveChipBadge', () => {
  it('gives each kind a short, distinct badge', () => {
    expect(directiveChipBadge('file')).toBe('FILE')
    expect(directiveChipBadge('ref')).toBe('REF')
    expect(directiveChipBadge('attach')).toBe('EXT')
    expect(directiveChipBadge('see')).toBe('SEE')
  })
})
