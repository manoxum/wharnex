import ReactQuill from 'react-quill-new'
import QuillDelta from 'quill-delta'
import 'react-quill-new/dist/quill.bubble.css'
import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react'
import {
  canonicalDirective,
  directiveChipLabel,
  type ComposerDirective,
} from '../lib/composerDirectives'
import { deltaToCanonicalText, directiveChipBadge, directivesToDelta, quillIndexToTextOffset, registerComposerEditor, textOffsetToQuillIndex, unregisterComposerEditor, type DirectiveChipValue } from '../lib/composerRichText'

/**
 * The composer's editing surface: a Quill `contenteditable` instance carrying
 * one custom atomic embed per directive, so `@{[kind]value}` shows as an
 * actual chip — badge, label, remove button — rather than as its own marker
 * text with a tinted background behind it.
 *
 * This is the same strategy flowdocs-deploy's template editor uses for its
 * variable chips (`RichTextEditor.tsx`'s `VariableChipBlot`, a Quill Embed
 * Blot): the chip is a real DOM node with `contenteditable="false"` embedded
 * inside the editable surface, built and read back through plain `data-*`
 * attributes rather than a parallel React tree. It supersedes the mirror-layer
 * approach ADR-0053 originally chose specifically to avoid contenteditable —
 * that trade-off bought native caret/undo/IME behavior for free, but could
 * only ever tint a marker's background, never replace it, which turned out to
 * be the actual requirement.
 *
 * The canonical text stays the single source of truth exactly as before: this
 * component is a quasi-controlled view over it. `value` is rendered as rich
 * content only when it changes from *outside* this editor (draft restore, a
 * chat switch, a directive picked from a menu, a chip removed); the editor's
 * own keystrokes update `value` through `onChange` without ever forcing a
 * content reload, which is what would otherwise fight the operator's own
 * cursor on every character typed.
 */
export type ComposerRichEditorHandle = {
  focus: () => void
  /** The underlying Quill instance — an imperative escape hatch, same as flowdocs' own `getEditor()` pattern, and how tests drive the editor without simulating raw keystrokes jsdom cannot faithfully reproduce. */
  getEditor: () => ReturnType<ReactQuill['getEditor']> | undefined
}


/** A caret placement request. `token` MUST change on every request, even to the
 * same `index` twice in a row (e.g. reopening the same directive for editing) — it
 * is what lets the editor apply a caret move even when `value` itself did not
 * change, which a plain numeric prop could not distinguish from "unchanged". */
export type CaretRequest = { index: number; token: number }

export const ComposerRichEditor = forwardRef<ComposerRichEditorHandle, {
  value: string
  /** Where to place the caret — applied whenever `token` changes, independent of whether `value` also did. */
  caret?: CaretRequest
  onChange: (text: string, caret: number) => void
  /** A click anywhere on a chip except its own remove button. */
  onClickDirective: (directive: ComposerDirective, anchor: DOMRect) => void
  /** The dedicated settings control on a configurable chip. */
  onConfigureDirective: (directive: ComposerDirective, anchor: DOMRect) => void
  /** A click on a chip's own remove button. */
  onRemoveDirective: (directive: ComposerDirective) => void
  onPasteFiles?: (files: File[]) => void
  onPasteText?: (text: string) => boolean
  onKeyDownCapture?: (event: React.KeyboardEvent) => void
  placeholder?: string
  disabled?: boolean
  lang?: string
}>(function ComposerRichEditor(
  { value, caret, onChange, onClickDirective, onConfigureDirective, onRemoveDirective, onPasteFiles, onPasteText, onKeyDownCapture, placeholder, disabled, lang },
  forwardedRef,
) {
  const quillRef = useRef<ReactQuill | null>(null)
  const lastEmittedRef = useRef<string | undefined>(undefined)
  const shellRef = useRef<HTMLDivElement>(null)
  const currentValueRef = useRef(value)
  const caretRequestRef = useRef(caret)
  currentValueRef.current = value
  caretRequestRef.current = caret

  useImperativeHandle(forwardedRef, () => ({
    focus: () => quillRef.current?.focus(),
    getEditor: () => quillRef.current?.getEditor(),
  }), [])

  useEffect(() => {
    const shell = shellRef.current
    const editor = quillRef.current?.getEditor()
    if (!shell || !editor) return
    registerComposerEditor(shell, editor)
    return () => { unregisterComposerEditor(shell) }
  }, [])

  // Reload the document only when `value` changed from outside this editor —
  // never on the editor's own keystrokes, which already are `value`.
  useEffect(() => {
    const editor = quillRef.current?.getEditor()
    if (!editor) return
    if (value !== lastEmittedRef.current) {
      editor.setContents(new QuillDelta(directivesToDelta(value).ops) as never, 'silent')
      lastEmittedRef.current = value
    }
  }, [value])

  // A caret request is an event, not persistent state: apply it exactly once
  // when its token changes. Tying this to `value` would replay the old index on
  // every keystroke after inserting/editing a chip and make the caret jump
  // backwards as the operator types.
  useEffect(() => {
    const editor = quillRef.current?.getEditor()
    const request = caretRequestRef.current
    if (!editor || !request) return
    editor.setSelection(textOffsetToQuillIndex(currentValueRef.current, request.index), 0, 'silent')
  }, [caret?.token])

  useEffect(() => {
    const editor = quillRef.current?.getEditor()
    if (editor) editor.enable(!disabled)
  }, [disabled])

  // Quill owns the contenteditable node, so spellcheck must be enabled on the
  // actual editing root rather than only on this React wrapper. Use explicit
  // DOM attributes: Chromium consumes them directly and jsdom does not
  // reliably reflect assignment to the HTMLElement.spellcheck property.
  useEffect(() => {
    const editor = quillRef.current?.getEditor()
    if (!editor) return
    editor.root.setAttribute('spellcheck', 'true')
    const spellcheckLanguage = lang || document.documentElement.lang
    if (spellcheckLanguage) editor.root.setAttribute('lang', spellcheckLanguage)
  }, [lang])

  // `source` is 'user' for a real keystroke/click/API call the operator made,
  // and 'silent' for the resync effect above writing its own reload back into
  // the same document (deliberately silent so it does not re-trigger itself).
  // Reacting to a silent write here anyway is exactly the bug that broke
  // autocomplete: the resync effect's own leftover selection would bounce
  // back through onChange and clobber the query state a real keystroke had
  // just set correctly a moment before. `onChange` and `onChangeSelection`
  // carry `source` at different argument positions, so each gets its own
  // thin wrapper rather than one function guessing which shape it received.
  function report() {
    const editor = quillRef.current?.getEditor()
    if (!editor) return
    const text = deltaToCanonicalText(editor.getContents() as never)
    const selection = editor.getSelection()
    lastEmittedRef.current = text
    onChange(text, selection ? quillIndexToTextOffset(text, selection.index) : text.length)
  }
  function handleTextChange(_value: string, _delta: unknown, source: string) {
    if (source === 'user') report()
  }
  function handleSelectionChange(_selection: unknown, source: string) {
    if (source === 'user') report()
  }

  function spellcheckSuggestionPoint() {
    const editor = quillRef.current?.getEditor()
    const selection = editor?.getSelection()
    if (!editor || !selection || selection.length) return undefined

    const text = editor.getText(0, editor.getLength())
    let start = Math.max(0, Math.min(selection.index, text.length))
    let end = start
    const isWordCharacter = (character: string) => /[\p{L}\p{M}'’\-]/u.test(character)
    while (start > 0 && isWordCharacter(text[start - 1] || '')) start -= 1
    while (end < text.length && isWordCharacter(text[end] || '')) end += 1
    if (start === end) return undefined

    const bounds = editor.getBounds(start, end - start)
    if (!bounds) return undefined
    const container = (editor as unknown as { container: HTMLElement }).container
    const containerBounds = container.getBoundingClientRect()
    return {
      x: Math.round(containerBounds.left + bounds.left + Math.max(1, bounds.width / 2)),
      y: Math.round(containerBounds.top + bounds.top + Math.max(1, bounds.height / 2)),
    }
  }

  function handleKeyDownCapture(event: React.KeyboardEvent) {
    const shortcut = event.ctrlKey && !event.altKey && !event.metaKey && !event.shiftKey && !event.repeat && (event.code === 'Space' || event.key === ' ')
    const spellcheck = window.wharnessDesktop?.spellcheck
    if (shortcut && spellcheck) {
      const point = spellcheckSuggestionPoint()
      if (point) {
        event.preventDefault()
        event.stopPropagation()
        void spellcheck.showSuggestions(point)
        return
      }
    }
    onKeyDownCapture?.(event)
  }

  function handlePaste(event: React.ClipboardEvent) {
    const clipboard = event.clipboardData
    const directFiles = Array.from(clipboard?.files || [])
    // Some sources (a screenshot tool's clipboard image, notably) expose the
    // file through `items` rather than `files` directly.
    const itemFiles = Array.from(clipboard?.items || [])
      .flatMap((item) => (item.kind === 'file' ? [item.getAsFile()] : []))
      .filter((file): file is File => file !== null)
    const files = directFiles.length ? directFiles : itemFiles
    if (files.length && onPasteFiles) {
      event.preventDefault()
      onPasteFiles(files)
      return
    }
    const text = clipboard?.getData('text/plain') || ''
    if (text && onPasteText?.(text)) event.preventDefault()
  }

  // Delegated once at the container: a click on a chip's own remove button
  // deletes that embed directly (fast, precise — no reason to reload the
  // whole document for the single most common chip interaction); a click
  // anywhere else on the chip opens its configuration popover. Reading the
  // clicked node's own data-* attributes plus its Quill index is enough to
  // reconstruct the exact ComposerDirective the chip stands for.
  function handleClickCapture(event: React.MouseEvent) {
    const target = event.target
    if (!(target instanceof Element)) return
    const chipNode = target.closest<HTMLElement>('[data-directive-chip]')
    if (!chipNode) return
    const editor = quillRef.current?.getEditor()
    if (!editor) return
    const directive = directiveFromChipNode(chipNode, editor, value)
    if (!directive) return
    if (target.closest('[data-directive-chip-action="remove"]')) {
      event.preventDefault()
      onRemoveDirective(directive)
      return
    }
    if (target.closest('[data-directive-chip-action="configure"]')) {
      event.preventDefault()
      onConfigureDirective(directive, chipNode.getBoundingClientRect())
      return
    }
    onClickDirective(directive, chipNode.getBoundingClientRect())
  }

  return <div
    ref={shellRef} className="composer-rich-editor" lang={lang}
    onClickCapture={handleClickCapture} onKeyDownCapture={handleKeyDownCapture} onPasteCapture={handlePaste}
  >
    <ReactQuill
      ref={quillRef} theme="bubble" modules={quillModules} formats={['directive-chip']}
      placeholder={placeholder} readOnly={disabled} onChange={handleTextChange} onChangeSelection={handleSelectionChange}
    />
  </div>
})

const quillModules = { toolbar: false, keyboard: { bindings: {} } }

function directiveFromChipNode(node: HTMLElement, editor: ReturnType<ReactQuill['getEditor']>, text: string): ComposerDirective | undefined {
  const chipValue = DirectiveChipBlot.value(node)
  if (!chipValue.kind) return undefined
  const Runtime = ReactQuill.Quill as unknown as { find: (node: Node) => unknown }
  const blot = Runtime.find(node)
  if (!blot) return undefined
  const index = (editor as unknown as { getIndex: (blot: unknown) => number }).getIndex(blot)
  const start = quillIndexToTextOffset(text, index)
  const marker = canonicalDirective(chipValue)
  return { ...chipValue, start, end: start + marker.length }
}

// --- The directive chip embed: a real, atomic DOM node, not a React tree. ---
//
// Registered once at module scope, exactly like flowdocs' own VariableChipBlot:
// Quill.register happens outside the component so remounting the editor never
// re-registers (and never risks two competing definitions of) the same format.

type EmbedBlotConstructor = { new (...args: never[]): object; create(value?: unknown): HTMLElement }
const QuillRuntime = ReactQuill.Quill as unknown as { import: (path: string) => unknown; register: (path: string, def: unknown, overwrite?: boolean) => void }
const Embed = QuillRuntime.import('blots/embed') as EmbedBlotConstructor

class DirectiveChipBlot extends Embed {
  static blotName = 'directive-chip'
  static tagName = 'span'
  static className = 'composer-directive-chip'

  static create(value: DirectiveChipValue) {
    const node = super.create() as HTMLElement
    node.setAttribute('contenteditable', 'false')
    node.setAttribute('spellcheck', 'false')
    node.classList.add(value.kind)
    node.dataset.directiveChip = 'true'
    node.dataset.directiveKind = value.kind
    node.dataset.directiveValue = value.value
    node.dataset.directiveProject = value.project
    node.dataset.directivePath = value.path
    node.dataset.directiveRules = value.rules ? JSON.stringify(value.rules) : ''
    node.setAttribute('title', canonicalDirective(value))

    const badge = document.createElement('span')
    badge.className = 'composer-directive-chip-badge'
    badge.textContent = directiveChipBadge(value.kind)
    node.append(badge)

    const label = document.createElement('span')
    label.className = 'composer-directive-chip-label'
    label.textContent = directiveChipLabel(value)
    node.append(label)

    const configure = document.createElement('button')
    configure.type = 'button'
    configure.className = 'composer-directive-chip-configure'
    configure.tabIndex = -1
    configure.dataset.directiveChipAction = 'configure'
    configure.setAttribute('aria-label', 'Configurar referência')
    configure.setAttribute('title', 'Configurar referência')
    configure.append(createSettingsIcon())
    node.append(configure)

    const remove = document.createElement('button')
    remove.type = 'button'
    remove.className = 'composer-directive-chip-remove'
    remove.tabIndex = -1
    remove.dataset.directiveChipAction = 'remove'
    remove.setAttribute('aria-label', 'Remover')
    remove.textContent = '×'
    node.append(remove)

    return node
  }

  static value(node: HTMLElement): DirectiveChipValue {
    const rules = node.dataset.directiveRules
    return {
      kind: (node.dataset.directiveKind || '') as DirectiveChipValue['kind'],
      value: node.dataset.directiveValue || '',
      project: node.dataset.directiveProject || '',
      path: node.dataset.directivePath || '',
      rules: rules ? JSON.parse(rules) : undefined,
    }
  }
}

QuillRuntime.register('formats/directive-chip', DirectiveChipBlot, true)

function createSettingsIcon() {
  const namespace = 'http://www.w3.org/2000/svg'
  const svg = document.createElementNS(namespace, 'svg')
  svg.setAttribute('aria-hidden', 'true')
  svg.setAttribute('viewBox', '0 0 24 24')
  svg.setAttribute('width', '12')
  svg.setAttribute('height', '12')
  svg.setAttribute('fill', 'none')
  svg.setAttribute('stroke', 'currentColor')
  svg.setAttribute('stroke-width', '1.9')
  svg.setAttribute('stroke-linecap', 'round')
  const paths = ['M4 7h10M18 7h2', 'M4 17h2M10 17h10', 'M14 4v6', 'M6 14v6']
  for (const data of paths) {
    const path = document.createElementNS(namespace, 'path')
    path.setAttribute('d', data)
    svg.append(path)
  }
  return svg
}
