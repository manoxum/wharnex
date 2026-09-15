import { forwardRef, useEffect, useRef, useState, type RefObject } from 'react'
import { directiveChipLabel, directiveKindLabel, directiveSegments, type ComposerDirective } from '../lib/composerDirectives'
import { Icon } from './Icon'

/**
 * Paints a chip behind every `@file` / `@ref` / `@attach` / `@see` directive in
 * the composer.
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
 * assistive technology and duplicating it would be noise. Nothing in it is
 * interactive: adding a clickable element inside the text flow would give that
 * line extra width the real textarea does not have, desynchronizing the two the
 * moment a chip's line wraps. Opening a chip's configuration is instead driven
 * from the textarea's own click (see `ChatPanel`'s directive click handling),
 * which already knows exactly which directive the caret landed on.
 *
 * Two things have to hold for the chip illusion to survive: the mirror must use
 * the same font, padding, border and wrapping as the textarea (enforced in CSS
 * by sharing one rule), and it must scroll with it — otherwise the chips drift
 * off the visible text the moment the prompt is longer than the box.
 */
export const ComposerDirectiveOverlay = forwardRef<HTMLDivElement, {
  text: string
  scrollRef: RefObject<HTMLTextAreaElement | null>
  /** The directive the caret currently sits inside, if any — a purely visual highlight. */
  activeDirective?: Pick<ComposerDirective, 'start' | 'end'>
}>(function ComposerDirectiveOverlay({ text, scrollRef, activeDirective }, mirrorRef) {
  const localRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const textarea = scrollRef.current
    const mirror = localRef.current
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
    const mirror = localRef.current
    if (!textarea || !mirror) return
    mirror.scrollTop = textarea.scrollTop
    mirror.scrollLeft = textarea.scrollLeft
  }, [text, scrollRef])

  const segments = directiveSegments(text)
  return <div ref={(node) => { localRef.current = node; if (typeof mirrorRef === 'function') mirrorRef(node); else if (mirrorRef) mirrorRef.current = node }} className="composer-directive-mirror">
    {segments.map((segment, index) => {
      if (!segment.directive) return <span key={index} aria-hidden="true">{segment.text}</span>
      const directive = segment.directive
      const active = Boolean(activeDirective && directive.start === activeDirective.start && directive.end === activeDirective.end)
      return <span key={index} className="composer-directive-anchor">
        <span
          className={`composer-directive-chip ${directive.kind}${active ? ' active' : ''}`}
          aria-hidden="true" data-label={directiveChipLabel(directive)} title={directive.value}
          data-directive-start={directive.start} data-directive-end={directive.end}
        >{segment.text}</span>
      </span>
    })}
    {/* A trailing newline is not laid out by the browser, so without this the
        mirror is one line shorter than the textarea and every chip below the
        fold sits slightly too high. */}
    <span aria-hidden="true">{'\n'}</span>
  </div>
})

export type DirectivePopoverAnchor = { left: number; top: number; bottom: number; width: number }

/**
 * The configuration surface for one directive, opened by clicking its chip —
 * in the text or in the summary strip above the composer — or its toolbar.
 *
 * A small anchored popover rather than a global modal: it is positioned from
 * the exact element that was clicked (`toggle`'s own `getBoundingClientRect()`,
 * the same technique `WorkspaceShell`'s project-window popover already uses),
 * flipping above its anchor when there is not enough room below, so it never
 * opens off-screen for a chip near the bottom of a tall composer.
 *
 * `file`/`ref`/`see` have nothing to configure beyond picking a different value
 * or removing the marker, so this popover — Edit/Remove plus a short status
 * line — already is their configuration surface. `attach` is the one kind with
 * real per-instance configuration (what an attached folder actually sends);
 * for it, `onEdit` opens the existing heavy `ComposerAttachmentPanel` modal
 * instead (see `ChatPanel.editDirective`), so this popover only relabels the
 * same action rather than duplicating that panel here.
 */
export function ComposerDirectiveConfigPopover({ directive, anchor, referenceAttached, attachmentAvailable, onEdit, onRemove, onClose }: {
  directive: ComposerDirective
  anchor: DirectivePopoverAnchor
  referenceAttached?: (projectName: string) => boolean
  attachmentAvailable?: (name: string) => boolean
  onEdit: (directive: ComposerDirective) => void
  onRemove: (directive: ComposerDirective) => void
  onClose: () => void
}) {
  const popoverRef = useRef<HTMLDivElement>(null)
  const [placement, setPlacement] = useState<'below' | 'above'>('below')

  useEffect(() => {
    const popover = popoverRef.current
    if (!popover) return
    const rect = popover.getBoundingClientRect()
    setPlacement(anchor.bottom + rect.height > window.innerHeight && anchor.top > rect.height ? 'above' : 'below')
  }, [anchor])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose() }
    const onPointerDown = (event: PointerEvent) => {
      if (event.target instanceof Node && popoverRef.current?.contains(event.target)) return
      onClose()
    }
    document.addEventListener('keydown', onKeyDown)
    document.addEventListener('pointerdown', onPointerDown)
    return () => { document.removeEventListener('keydown', onKeyDown); document.removeEventListener('pointerdown', onPointerDown) }
  }, [onClose])

  const rules = directive.rules
  const ruleCount = (rules?.include.length || 0) + (rules?.exclude.length || 0)
  const seeFound = directive.kind === 'see' ? attachmentAvailable?.(directive.path) : undefined
  const style = placement === 'below'
    ? { left: anchor.left, top: anchor.bottom + 6 }
    : { left: anchor.left, bottom: window.innerHeight - anchor.top + 6 }

  return <div
    ref={popoverRef} className="composer-directive-popover" data-chatgpt-overlay-blocker="true"
    style={style} role="dialog" aria-label={`Configurar ${directiveKindLabel(directive.kind)}`}
  >
    <header>
      <strong>{directiveKindLabel(directive.kind)}</strong>
      <button type="button" className="agent-drawer-icon" onClick={onClose} aria-label="Fechar"><Icon name="close" size={12}/></button>
    </header>
    <div className="composer-directive-popover-body">
      {directive.kind === 'ref'
        ? <>
          <span>{directive.project}{directive.path ? `/${directive.path}` : ''}</span>
          <span>{referenceAttached?.(directive.project) === false ? 'Ainda não anexado — será trazido ao contexto ao enviar' : 'Contexto já anexado'}</span>
        </>
        : <span>{directive.path || directive.value}</span>}
      {directive.kind === 'attach' && <span>{rules?.autoExclude === false ? 'Reconhecimento automático desligado' : 'Reconhecimento automático ligado'}{ruleCount ? ` · ${ruleCount} regra(s)` : ''}</span>}
      {directive.kind === 'see' && <span>{seeFound === false ? 'Não encontrado entre os anexos atuais — foi removido?' : 'Encontrado entre os anexos atuais'}</span>}
    </div>
    <div className="composer-directive-popover-actions">
      <button type="button" onClick={() => { onEdit(directive); onClose() }}>
        <Icon name={directive.kind === 'attach' ? 'folder' : 'edit'} size={12}/> {directive.kind === 'attach' ? 'Configurar conteúdo…' : 'Editar'}
      </button>
      <button type="button" className="danger" onClick={() => { onRemove(directive); onClose() }}><Icon name="trash" size={12}/> Remover</button>
    </div>
  </div>
}
