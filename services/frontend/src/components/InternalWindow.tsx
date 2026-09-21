import { cloneElement, isValidElement, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { bindInternalWindowDrag, ensureInternalWindowDockRoot } from '../lib/internalWindow'
import { InternalWindowPersistenceContext } from '../lib/internalWindowPersistence'
import { Icon } from './Icon'

type InternalWindowProps = {
  title: string
  onClose: () => void
  children: ReactNode
  layerClassName?: string
  closeDisabled?: boolean
}

export function InternalWindow({ title, onClose, children, layerClassName = '', closeDisabled = false }: InternalWindowProps) {
  const [minimized, setMinimized] = useState(false)
  const dockRoot = useMemo(() => ensureInternalWindowDockRoot(), [])
  const portalRoot = typeof document === 'undefined' ? null : document.body
  const persistence = useContext(InternalWindowPersistenceContext)
  const persistenceOwner = persistence?.owner
  const registerPersistence = persistence?.register
  const restoreRef = useRef<HTMLButtonElement>(null)
  const shellRef = useRef<HTMLDivElement>(null)
  const dragGripRef = useRef<HTMLSpanElement>(null)

  useEffect(() => {
    if (minimized) restoreRef.current?.focus()
  }, [minimized])

  useEffect(() => {
    if (!persistenceOwner || !registerPersistence) return
    return registerPersistence(persistenceOwner)
  }, [persistenceOwner, registerPersistence])

  useLayoutEffect(() => {
    const surface = shellRef.current?.firstElementChild
    if (!(surface instanceof HTMLElement)) return
    const previousPosition = surface.style.position
    if (window.getComputedStyle(surface).position === 'static') surface.style.position = 'relative'
    return () => { surface.style.position = previousPosition }
  }, [])

  useEffect(() => {
    const shell = shellRef.current
    if (!shell) return
    return bindInternalWindowDrag(shell, [dragGripRef.current])
  }, [])

  const controls = <div className="internal-window-controls" role="group" aria-label={`Controlos da janela ${title}`}>
    <span ref={dragGripRef} className="internal-window-drag-grip" data-internal-window-drag-handle="true" aria-hidden="true"/>
    <button type="button" onClick={() => setMinimized(true)} aria-label={`Minimizar ${title}`} title="Minimizar"><Icon name="minus" size={12}/></button>
    <button type="button" disabled={closeDisabled} onClick={onClose} aria-label={`Fechar ${title}`} title="Fechar"><Icon name="close" size={12}/></button>
  </div>
  const surface = isValidElement<{ children?: ReactNode }>(children) && typeof children.type === 'string'
    ? cloneElement(children, undefined, <>{children.props.children}{controls}</>)
    : <div className="internal-window-surface">{children}{controls}</div>

  const layer = <div
    className={`internal-window-layer ${layerClassName} ${minimized ? 'is-minimized' : ''}`.trim()}
    data-internal-window-state={minimized ? 'minimized' : 'open'}
    aria-hidden={minimized || undefined}
  >
    <div ref={shellRef} className="internal-window-shell" onKeyDown={(event) => {
      if (event.key !== 'Escape' || closeDisabled) return
      event.stopPropagation()
      onClose()
    }}>
      {surface}
    </div>
  </div>

  return <>
    {portalRoot ? createPortal(layer, portalRoot) : layer}
    {minimized && dockRoot ? createPortal(<div className="internal-window-dock-item" data-internal-window-state="minimized">
      <button ref={restoreRef} type="button" className="internal-window-dock-restore" onClick={() => setMinimized(false)} title={`Restaurar ${title}`}><span aria-hidden="true">▣</span><strong>{title}</strong></button>
      <button type="button" className="internal-window-dock-close" disabled={closeDisabled} onClick={onClose} aria-label={`Fechar ${title}`} title="Fechar"><Icon name="close" size={11}/></button>
    </div>, dockRoot) : null}
  </>
}
