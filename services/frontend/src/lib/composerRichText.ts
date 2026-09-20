// Two-way transform between the composer's canonical text (the single source
// of truth — see composerDirectives.ts) and the rich content a Quill editor
// actually renders, so a directive shows as a real chip that replaces its
// marker text rather than a marker with a tinted background behind it.
//
// This mirrors the flowdocs-deploy template editor's own architecture
// (`template-tokens.ts`'s `normalizeTokenContent` / `renderContentWithVariableChips`):
// the rich editor's content is an ephemeral *view*, rebuilt from the canonical
// string whenever it changes from outside the editor, and reduced back to that
// same string on every edit. Nothing downstream of `message` in ChatPanel needs
// to know a rich editor is involved at all — draft persistence, submission and
// the summary strip all keep reading and writing plain canonical text exactly
// as before.

import type ReactQuill from 'react-quill-new'
import { canonicalDirective, directiveSegments, type ComposerDirective, type DirectiveKind } from './composerDirectives'

type QuillEditor = ReturnType<ReactQuill['getEditor']>

// Every mounted ComposerRichEditor registers its live Quill instance here,
// keyed by its own root DOM node. A ref threaded down from wherever ChatPanel
// was rendered covers the common case (ChatPanelHandle.getComposerEditor()),
// but a composer embedded several components deep (OrchestratorOverview, say)
// would need that ref forwarded through every layer in between just so a test
// can drive it. This registry answers "which editor lives under this
// container" directly from any rendered DOM instead.
const editorRegistry = new WeakMap<Element, QuillEditor>()

export function registerComposerEditor(shell: Element, editor: QuillEditor) {
  editorRegistry.set(shell, editor)
}

export function unregisterComposerEditor(shell: Element) {
  editorRegistry.delete(shell)
}

/** Finds the Quill editor mounted anywhere under `container` — for tests that cannot thread a ref down to `ComposerRichEditor` itself. */
export function findComposerEditor(container: Element): QuillEditor | undefined {
  const shell = container.matches('.composer-rich-editor') ? container : container.querySelector('.composer-rich-editor')
  return shell ? editorRegistry.get(shell) : undefined
}

/** What a chip embed carries — enough to reconstruct a ComposerDirective from a click. */
export type DirectiveChipValue = Pick<ComposerDirective, 'kind' | 'value' | 'project' | 'path' | 'rules'>

/** A Quill Delta op, typed loosely enough to avoid pulling in quill-delta's own types. */
export type DeltaOp = { insert: string | { 'directive-chip': DirectiveChipValue } }
export type Delta = { ops: DeltaOp[] }

/**
 * The canonical text as a Quill Delta: a directive becomes one embed op, a
 * plain run becomes one text op (including any literal newlines it carries —
 * Quill represents a line break as `\n` inside an insert string, so no
 * separate block/paragraph handling is needed here).
 *
 * A Quill document MUST end in `\n`, unconditionally — even when the text
 * being loaded already ends with one of its own, which then means an actual
 * trailing blank line, not the document's structural terminator. Appending it
 * only when missing would conflate the two and lose a trailing newline the
 * operator typed; deltaToCanonicalText's job is exactly to strip this one back
 * off, so the two must agree on there always being exactly one to strip.
 */
export function directivesToDelta(text: string): Delta {
  const segments = directiveSegments(text)
  const ops: DeltaOp[] = []
  for (const segment of segments) {
    // A typed-form directive (`@file:path`, not yet `@{[file]path}`) is left
    // as plain, editable text — see isCanonicalMarker. Only a canonical
    // marker becomes an embed here.
    if (segment.directive && isCanonicalMarker(text, segment.directive)) ops.push({ insert: { 'directive-chip': toChipValue(segment.directive) } })
    else if (segment.text) ops.push({ insert: segment.text })
  }
  ops.push({ insert: '\n' })
  return { ops }
}

function toChipValue(directive: ComposerDirective): DirectiveChipValue {
  return { kind: directive.kind, value: directive.value, project: directive.project, path: directive.path, rules: directive.rules }
}

/**
 * Whether a parsed directive is already written in its canonical `@{[kind]…}`
 * form, as opposed to a typed form like `@file:path`.
 *
 * This distinction is what the index-mapping functions below actually need,
 * not "is this text a directive" in general. `directiveSegments` recognizes
 * both spellings — that is correct for parsing and for the summary strip —
 * but only a canonical marker is guaranteed to correspond to a real Quill
 * embed: a canonical marker only ever reaches the text either by being typed
 * out by hand (rare, and still a deliberate one-shot canonical string) or by
 * being written by this editor's own `deltaToCanonicalText`, which writes
 * canonical form for every embed it walks and nothing else. A typed form like
 * `@file:App` is recognized as a directive the instant a value follows the
 * colon, which is normal mid-composition — the operator is still typing
 * towards a menu selection — and at that point it is genuinely N ordinary
 * characters in the live Quill document, not yet a 1-index embed.
 */
function isCanonicalMarker(text: string, directive: Pick<ComposerDirective, 'start' | 'end'>) {
  return text.startsWith('@{[', directive.start)
}

/**
 * The Delta a Quill editor holds, reduced back to canonical text: each embed
 * op becomes its directive's canonical `@{[kind]value}` marker, each text op
 * is carried through as-is. The one mandatory trailing `\n` Quill's document
 * model always carries is stripped, since the canonical string does not.
 */
export function deltaToCanonicalText(contents: Delta): string {
  let text = ''
  for (const op of contents.ops) {
    if (typeof op.insert === 'string') text += op.insert
    else if (op.insert && 'directive-chip' in op.insert) text += canonicalDirective(op.insert['directive-chip'])
  }
  return text.endsWith('\n') ? text.slice(0, -1) : text
}

/**
 * Converts a character offset in the canonical text to the matching index in
 * the Quill document — a directive marker of any length collapses to exactly
 * one embed index once rendered as a chip, so the two spaces diverge exactly
 * at each directive.
 */
export function textOffsetToQuillIndex(text: string, offset: number): number {
  const segments = directiveSegments(text)
  let textCursor = 0
  let quillCursor = 0
  for (const segment of segments) {
    const embedded = Boolean(segment.directive) && isCanonicalMarker(text, segment.directive!)
    const length = segment.text.length
    if (offset <= textCursor + length) {
      // A click that lands inside an embedded directive's own marker resolves
      // to the chip's index — there is no finer position inside an atomic
      // embed. The exact end boundary is different: it is the caret position
      // immediately *after* the embed, not another point inside it. A
      // typed-form directive is still ordinary text here, so it keeps a
      // one-to-one offset like any other run.
      return embedded ? quillCursor + (offset === textCursor + length ? 1 : 0) : quillCursor + (offset - textCursor)
    }
    textCursor += length
    quillCursor += embedded ? 1 : length
  }
  return quillCursor
}

/** The inverse of textOffsetToQuillIndex, for translating a click on a chip back to its range in the canonical text. */
export function quillIndexToTextOffset(text: string, index: number): number {
  const segments = directiveSegments(text)
  let textCursor = 0
  let quillCursor = 0
  for (const segment of segments) {
    const embedded = Boolean(segment.directive) && isCanonicalMarker(text, segment.directive!)
    const length = segment.text.length
    const span = embedded ? 1 : length
    if (index <= quillCursor + span) {
      // As above, the far edge of an embed maps to the end of its complete
      // canonical marker. Mapping it to the start makes text entered after a
      // chip jump in front of it.
      return embedded ? textCursor + (index === quillCursor + span ? length : 0) : textCursor + (index - quillCursor)
    }
    textCursor += length
    quillCursor += span
  }
  return textCursor
}

/** A short badge for a chip, standing in for a full icon — the same idea as flowdocs' `TXT`/`SEL`/`NUM` badges. */
export function directiveChipBadge(kind: DirectiveKind): string {
  if (kind === 'file') return 'FILE'
  if (kind === 'ref') return 'REF'
  if (kind === 'attach') return 'EXT'
  if (kind === 'chat') return 'CHAT'
  if (kind === 'lib') return 'LIB'
  if (kind === 'todo') return 'TODO'
  return 'SEE'
}
