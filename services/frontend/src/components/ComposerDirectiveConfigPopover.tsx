import { useEffect, useRef, useState } from 'react'
import { directiveKindLabel, type ComposerDirective } from '../lib/composerDirectives'
import { Icon } from './Icon'

export type DirectivePopoverAnchor = { left: number; top: number; bottom: number; width: number }

/**
 * The configuration surface for one directive, opened by clicking its chip —
 * in the composer's rich text (see `ComposerRichEditor`) or its miniature in
 * the summary strip above the composer.
 *
 * A small anchored popover rather than a global modal: it is positioned from
 * the exact element that was clicked (`anchor`'s own `getBoundingClientRect()`,
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
