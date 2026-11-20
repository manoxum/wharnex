import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import type { IconName } from '../chrome/Icon'
import { IconButton } from './controls'
import { positionPopover, samePopoverPosition, type PopoverAlignment, type PopoverPositionState } from './popoverPosition'

export function ControlPopover({ label, icon = 'settings', children, triggerLabel = label, triggerAdornment, alignment = 'start', density = 'comfortable', open: controlledOpen, onOpenChange, triggerTitle, layout = 'standard' }: {
  label: string; icon?: IconName; triggerLabel?: string; triggerAdornment?: ReactNode; alignment?: PopoverAlignment
  open?: boolean; onOpenChange?: (open: boolean) => void; triggerTitle?: string
  density?: 'comfortable' | 'compact'; layout?: 'standard' | 'document-list'
  children: ReactNode | ((close: () => void) => ReactNode)
}) {
  const [localOpen, setLocalOpen] = useState(false)
  const open = controlledOpen ?? localOpen
  const setOpen = (next: boolean | ((current: boolean) => boolean)) => { const value = typeof next === 'function' ? next(open) : next; setLocalOpen(value); onOpenChange?.(value) }
  const [position, setPosition] = useState<PopoverPositionState>({ top: 0, left: 0, maxHeight: 400, side: 'bottom', fontScale: '1' })
  const trigger = useRef<HTMLButtonElement>(null)
  const panel = useRef<HTMLDivElement>(null)
  const id = useId()
  useLayoutEffect(() => {
    if (!open) return
    const place = () => {
      if (!trigger.current || !panel.current) return
      const rect = trigger.current.getBoundingClientRect()
      const placement = positionPopover(rect, { width: panel.current.getBoundingClientRect().width, height: panel.current.scrollHeight }, { width: window.innerWidth, height: window.innerHeight }, alignment)
      const next = { ...placement, fontScale: getComputedStyle(trigger.current).getPropertyValue('--ui-font-scale') || '1' }
      setPosition((current) => samePopoverPosition(current, next) ? current : next)
    }
    place()
    const observer = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(place)
    if (panel.current) observer?.observe(panel.current)
    window.addEventListener('resize', place)
    window.addEventListener('scroll', place, true)
    return () => { observer?.disconnect(); window.removeEventListener('resize', place); window.removeEventListener('scroll', place, true) }
  }, [open, alignment])
  useEffect(() => {
    if (!open) return
    const contains = (target: EventTarget | null) => target instanceof Node && (trigger.current?.contains(target) || panel.current?.contains(target))
    panel.current?.querySelector<HTMLElement>('[data-popover-selected]')?.scrollIntoView?.({ block: 'nearest' })
    const outside = (event: Event) => { if (!contains(event.target)) setOpen(false) }
    const keyboard = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); setOpen(false); trigger.current?.focus() }
    }
    const focusTarget = panel.current?.querySelector<HTMLElement>('[data-popover-autofocus]')
    if (focusTarget) focusTarget.focus(); else panel.current?.focus()
    const blur = () => setOpen(false)
    window.addEventListener('blur', blur)
    document.addEventListener('pointerdown', outside, true)
    document.addEventListener('focusin', outside, true)
    document.addEventListener('keydown', keyboard, true)
    return () => { window.removeEventListener('blur', blur); document.removeEventListener('pointerdown', outside, true); document.removeEventListener('focusin', outside, true); document.removeEventListener('keydown', keyboard, true) }
  }, [open])
  return <>
    <IconButton ref={trigger} label={triggerLabel} title={triggerTitle} icon={icon} adornment={triggerAdornment} aria-haspopup="dialog" aria-expanded={open} aria-controls={open ? id : undefined} onClick={() => setOpen((value) => !value)}/>
    {open && createPortal(<div ref={panel} id={id} role="dialog" aria-label={label} tabIndex={-1}
      className={`fixed z-[10000] box-border ${layout === 'document-list' ? 'flex flex-col w-[min(360px,calc(100vw-16px))] gap-2 rounded-lg p-2 !overflow-hidden' : 'grid'} ${layout === 'document-list' ? '' : density === 'compact' ? 'w-[min(300px,calc(100vw-16px))] gap-2 rounded-lg p-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden' : 'w-[min(360px,calc(100vw-16px))] gap-4 rounded-xl p-4'} overflow-y-auto border border-whx-border-soft bg-whx-popover text-whx-label text-whx-text shadow-[0_12px_40px_var(--theme-shadow)] outline-none`}
      style={{ top: position.top, left: position.left, maxHeight: layout === 'document-list' ? `min(${position.maxHeight}px, 520px, 70vh)` : position.maxHeight, scrollbarWidth: density === 'compact' ? 'none' : undefined, '--ui-font-scale': position.fontScale } as React.CSSProperties}>
      <strong className="text-whx-label font-semibold">{label}</strong>
      {typeof children === 'function' ? children(() => { setOpen(false); trigger.current?.focus() }) : children}
    </div>, document.body)}
  </>
}
