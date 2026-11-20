import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Icon, type IconName } from '../chrome/Icon'
export type ContextAction = { id: string; label: string; icon?: IconName; disabled?: boolean; danger?: boolean; separator?: boolean; run: () => void }
export function ContextMenu({ x, y, label, actions, onClose }: { x: number; y: number; label: string; actions: ContextAction[]; onClose: () => void }) {
  const root = useRef<HTMLDivElement>(null)
  const previousFocus = useRef<HTMLElement | null>(null)
  const retiring = useRef(false)
  const dismiss = () => { if (retiring.current) return; retiring.current = true; previousFocus.current?.focus(); onClose() }
  const [position, setPosition] = useState({ left: x, top: y })
  useLayoutEffect(() => {
    const place = () => { const rect = root.current?.getBoundingClientRect(); if (rect) setPosition({ left: Math.max(8, Math.min(x, window.innerWidth - rect.width - 8)), top: Math.max(8, Math.min(y, window.innerHeight - rect.height - 8)) }) }
    place(); window.addEventListener('resize', place)
    return () => window.removeEventListener('resize', place)
  }, [x, y])
  useEffect(() => {
    const element = root.current
    const previous = document.activeElement as HTMLElement | null
    previousFocus.current = previous
    root.current?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus()
    const outside = (event: Event) => { if (!retiring.current && event.target instanceof Node && !root.current?.contains(event.target)) { retiring.current = true; onClose() } }
    document.addEventListener('pointerdown', outside, true)
    document.addEventListener('focusin', outside, true)
    window.addEventListener('blur', onClose)
    return () => { document.removeEventListener('pointerdown', outside, true); document.removeEventListener('focusin', outside, true); window.removeEventListener('blur', onClose); if (previous?.isConnected && element?.contains(document.activeElement)) previous.focus() }
  }, [onClose])
  return createPortal(<div ref={root} role="menu" aria-label={label} className="fixed z-[10040] min-w-56 max-w-[calc(100vw-16px)] overflow-y-auto rounded-md border border-whx-border bg-whx-popover p-1 text-whx-label text-whx-text shadow-[0_8px_32px_var(--theme-shadow)]" style={{ ...position, maxHeight: 'calc(100vh - 16px)' }} onKeyDown={(event) => {
    const items = [...(root.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') || [])]
    const index = items.indexOf(document.activeElement as HTMLButtonElement)
    if (event.key === 'Escape' || event.key === 'Tab') { event.preventDefault(); event.stopPropagation(); dismiss() }
    else if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) { event.preventDefault(); items[event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : (index + (event.key === 'ArrowUp' ? -1 : 1) + items.length) % items.length]?.focus() }
  }}>
    {actions.map((action) => <div key={action.id}>{action.separator && <div role="separator" className="my-1 border-t border-whx-border-soft"/>}<button type="button" role="menuitem" disabled={action.disabled} className={`flex min-h-8 w-full items-center gap-2 rounded border-0 bg-transparent px-2 py-1 text-left text-whx-label hover:bg-whx-hover focus:bg-whx-hover focus:outline-none disabled:opacity-40 ${action.danger ? 'text-whx-danger' : 'text-whx-soft focus:text-whx-text'}`} onClick={() => { dismiss(); action.run() }}><span className="grid size-4 shrink-0 place-items-center">{action.icon && <Icon name={action.icon} size={14}/>}</span>{action.label}</button></div>)}
  </div>, document.body)
}
