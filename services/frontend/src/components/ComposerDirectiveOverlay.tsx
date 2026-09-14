import { useEffect, useRef, type RefObject } from 'react'
import { directiveChipLabel, directiveKindLabel, directiveSegments, type ComposerDirective } from '../lib/composerDirectives'
import { Icon } from './Icon'

/**
 * Paints a chip behind every `@file` / `@ref` / `@attach` directive in the
 * composer, with a small Edit / Remove / Info toolbar on the one the caret is
 * currently inside.
 *
 * A textarea cannot render an element inside its own value, and rewriting the
 * composer as a contenteditable would mean reimplementing the caret, selection,
 * undo history, IME composition and spellcheck that the browser already gets
 * right. So the directive is drawn by a mirror layer sitting exactly behind the
 * textarea, laid out with identical text metrics: the operator sees where each
 * directive begins and ends, and everything about typing stays native.
 *
 * The mirror layer is decorative — every plain run and every chip's own text is
 * `aria-hidden`, because the textarea already exposes the real text to
 * assistive technology and duplicating it would be noise. The one exception is
 * the toolbar: `pointer-events: auto` on it punches back through the mirror's
 * `pointer-events: none`, a standard, well-supported override, so its buttons
 * stay genuinely clickable and reachable even though everything around them is
 * inert.
 *
 * Two things have to hold for the chip illusion to survive: the mirror must use
 * the same font, padding, border and wrapping as the textarea (enforced in CSS
 * by sharing one rule), and it must scroll with it — otherwise the chips drift
 * off the visible text the moment the prompt is longer than the box.
 */
export function ComposerDirectiveOverlay({ text, scrollRef, activeDirective, referenceAttached, onEditDirective, onRemoveDirective }: {
  text: string
  scrollRef: RefObject<HTMLTextAreaElement | null>
  /** The directive the caret currently sits inside, if any — the one that gets the toolbar. */
  activeDirective?: Pick<ComposerDirective, 'start' | 'end'>
  /** For a `ref` chip's Info popover: whether that project's context is already attached. */
  referenceAttached?: (projectName: string) => boolean
  onEditDirective?: (directive: ComposerDirective) => void
  onRemoveDirective?: (directive: ComposerDirective) => void
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
  return <div ref={mirrorRef} className="composer-directive-mirror">
    {segments.map((segment, index) => {
      if (!segment.directive) return <span key={index} aria-hidden="true">{segment.text}</span>
      const directive = segment.directive
      const active = Boolean(activeDirective && directive.start === activeDirective.start && directive.end === activeDirective.end)
      return <span key={index} className="composer-directive-anchor">
        <span className={`composer-directive-chip ${directive.kind}`} aria-hidden="true" data-label={directiveChipLabel(directive)} title={directive.value}>{segment.text}</span>
        {active && <DirectiveToolbar directive={directive} attached={directive.kind === 'ref' ? referenceAttached?.(directive.project) : undefined} onEdit={onEditDirective} onRemove={onRemoveDirective}/>}
      </span>
    })}
    {/* A trailing newline is not laid out by the browser, so without this the
        mirror is one line shorter than the textarea and every chip below the
        fold sits slightly too high. */}
    <span aria-hidden="true">{'\n'}</span>
  </div>
}

function DirectiveToolbar({ directive, attached, onEdit, onRemove }: {
  directive: ComposerDirective
  attached?: boolean
  onEdit?: (directive: ComposerDirective) => void
  onRemove?: (directive: ComposerDirective) => void
}) {
  const rules = directive.rules
  const ruleCount = (rules?.include.length || 0) + (rules?.exclude.length || 0)
  return <span className="composer-directive-toolbar" role="toolbar" aria-label={`Ações de ${directiveKindLabel(directive.kind)}`}>
    <button type="button" title="Editar" aria-label="Editar referência" onClick={() => onEdit?.(directive)}><Icon name="edit" size={11}/></button>
    <button type="button" title="Remover" aria-label="Remover referência" onClick={() => onRemove?.(directive)}><Icon name="close" size={11}/></button>
    <span className="composer-directive-info" tabIndex={0} role="note" aria-label="Informação sobre a referência">
      <Icon name="info" size={11}/>
      <span className="composer-directive-info-bubble" role="tooltip">
        <strong>{directiveKindLabel(directive.kind)}</strong>
        {directive.kind === 'ref'
          ? <>
            <span>{directive.project}{directive.path ? `/${directive.path}` : ''}</span>
            <span>{attached === false ? 'Ainda não anexado — será trazido ao contexto ao enviar' : attached === true ? 'Contexto já anexado' : ''}</span>
          </>
          : <span>{directive.path}</span>}
        {directive.kind === 'attach' && <span>{rules?.autoExclude === false ? 'Reconhecimento automático desligado' : 'Reconhecimento automático ligado'}{ruleCount ? ` · ${ruleCount} regra(s)` : ''}</span>}
      </span>
    </span>
  </span>
}
