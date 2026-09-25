import { describe, expect, it } from 'vitest'
import { spellcheckWordBounds } from './composerSpellcheck'

describe('spellcheckWordBounds', () => {
  it('keeps Unicode letters, marks, apostrophes, and hyphens in one word', () => {
    const text = "antes d’água-marinha depois"
    expect(spellcheckWordBounds(text, text.indexOf('marinha'))).toEqual({
      start: text.indexOf('d’'),
      length: "d’água-marinha".length,
    })
  })

  it('clamps the caret, keeps the word immediately before a separator, and refuses empty text', () => {
    expect(spellcheckWordBounds('palavra', 99)).toEqual({ start: 0, length: 7 })
    expect(spellcheckWordBounds('duas palavras', 4)).toEqual({ start: 0, length: 4 })
    expect(spellcheckWordBounds('', 0)).toBeUndefined()
  })
})
