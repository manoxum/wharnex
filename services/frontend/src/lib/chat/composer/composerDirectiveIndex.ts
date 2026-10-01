import { canonicalDirective, isCanonicalDirective, parseDirectives, type ComposerDirective } from './composerDirectives'

export type ComposerDirectiveState = {
  parsed: ComposerDirective[]
  indexed: ComposerDirective[]
}

/**
 * Returns the directives currently committed in the composer.
 *
 * Autocomplete fragments are intentionally excluded: only completed canonical
 * markers count as already indexed sources. `@see` is a spotlight, so it never
 * becomes a source for another `@see`.
 */
export function composerDirectiveState(text: string): ComposerDirectiveState {
  const parsed = parseDirectives(text)
  const seen = new Set<string>()
  const indexed = parsed.filter((directive) => directive.kind !== 'see' && isCanonicalDirective(text, directive)).filter((directive) => {
    const key = canonicalDirective(directive)
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
  return { parsed, indexed }
}
