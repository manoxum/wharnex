import { useEffect, useRef, type RefObject } from 'react'
import { directiveSegments, directiveChipLabel } from '../lib/composerDirectives'

/**
 * Paints a chip behind every `@file` / `@ref` directive in the composer.
 *
 * A textarea cannot render an element inside its own value, and rewriting the
 * composer as a contenteditable would mean reimplementing the caret, selection,
 * undo history, IME composition and spellcheck that the browser already gets
 * right. So the directive is drawn by a mirror layer sitting exactly behind the
 * textarea, laid out with identical text metrics: the operator sees where each
 * directive begins and ends, and everything about typing stays native.
 *
 * The mirror is decorative by construction — `aria-hidden`, not focusable, no
 * pointer events. The textarea remains the only thing the user interacts with
 * and the only accessible representation of the text.
 *
 * Two things have to hold for the illusion to survive: the mirror must use the
 * same font, padding, border and wrapping as the textarea (enforced in CSS by
 * sharing one rule), and it must scroll with it — otherwise the chips drift off
 * the visible text the moment the prompt is longer than the box.
 */
export function ComposerDirectiveOverlay({ text, scrollRef }: {
  text: string
  scrollRef: RefObject<HTMLTextAreaElement | null>
}) {
  const mirrorRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const textarea = scrollRef.current
    const mirror = mirrorRef.current
    if (!textarea || !mirror) return
    const sync = () => {
      mirror.scrollTop = textarea.scrollTop
      mirror.scrollLeft = textarea.scrollLeft
    }
    sync()
    textarea.addEventListener('scroll', sync)
    return () => textarea.removeEventListener('scroll', sync)
  }, [scrollRef])

  // Re-sync after the text changes too: growing the value can move the scroll
  // position without emitting a scroll event.
  useEffect(() => {
    const textarea = scrollRef.current
    const mirror = mirrorRef.current
    if (!textarea || !mirror) return
    mirror.scrollTop = textarea.scrollTop
    mirror.scrollLeft = textarea.scrollLeft
  }, [text, scrollRef])

  const segments = directiveSegments(text)
  return <div ref={mirrorRef} className="composer-directive-mirror" aria-hidden="true">
    {segments.map((segment, index) => segment.directive
      ? <span key={index} className={`composer-directive-chip ${segment.directive.kind}`} data-label={directiveChipLabel(segment.directive)} title={segment.directive.value}>{segment.text}</span>
      : <span key={index}>{segment.text}</span>)}
    {/* A trailing newline is not laid out by the browser, so without this the
        mirror is one line shorter than the textarea and every chip below the
        fold sits slightly too high. */}
    {'\n'}
  </div>
}
