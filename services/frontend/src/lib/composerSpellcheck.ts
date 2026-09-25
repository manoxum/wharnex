const wordCharacter = /[\p{L}\p{M}'’-]/u

export type SpellcheckWordBounds = { start: number; length: number }

export function spellcheckWordBounds(text: string, caret: number): SpellcheckWordBounds | undefined {
  let start = Math.max(0, Math.min(caret, text.length))
  let end = start
  while (start > 0 && wordCharacter.test(text[start - 1] || '')) start -= 1
  while (end < text.length && wordCharacter.test(text[end] || '')) end += 1
  if (start === end) return undefined
  return { start, length: end - start }
}
