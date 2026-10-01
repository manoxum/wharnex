import { cloneElement, isValidElement, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { bindInternalWindowDrag, bindInternalWindowResize, ensureInternalWindowDockRoot } from '../../../lib/workspace/layout/internalWindow'
import { InternalWindowPersistenceContext } from '../../../lib/workspace/layout/internalWindowPersistence'
import { Icon } from '../../presentation/chrome/Icon'

type InternalWindowProps = {
  title: string
  onClose: () => void
  children: ReactNode
  layerClassName?: string
  closeDisabled?: boolean
  maximizable?: boolean
}

export function InternalWindow({ title, onClose, children, layerClassName = '', closeDisabled = false, maximizable = false }: InternalWindowProps) {
  const persistence = useContext(InternalWindowPersistenceContext)
  const persistenceOwner = persistence?.owner
  const registerPersistence = persistence?.register
  const persistenceKey = persistenceOwner ? `whx.internal-window.state.v1:${persistenceOwner}:${title}` : ''
  const [minimized, setMinimized] = useState(() => loadMinimizedState(persistenceKey))
  const [maximized, setMaximized] = useState(false)
  const dockRoot = useMemo(() => ensureInternalWindowDockRoot(), [])
  const portalRoot = typeof document === 'undefined' ? null : document.body
  const restoreRef = useRef<HTMLButtonElement>(null)
  const shellRef = useRef<HTMLDivElement>(null)
  const dragGripRef = useRef<HTMLSpanElement>(null)
  const resizeGripRef = useRef<HTMLSpanElement>(null)

  useEffect(() => { setMinimized(loadMinimizedState(persistenceKey)) }, [persistenceKey])

  useEffect(() => {
    if (minimized) restoreRef.current?.focus()
  }, [minimized])

  useEffect(() => {
    if (!persistenceKey) return
    try { localStorage.setItem(persistenceKey, minimized ? 'minimized' : 'open') } catch { /* storage quota is best-effort */ }
  }, [minimized, persistenceKey])

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
    const detachDrag = bindInternalWindowDrag(shell, [dragGripRef.current])
    const detachResize = bindInternalWindowResize(shell, resizeGripRef.current)
    return () => { detachResize(); detachDrag() }
  }, [])

  const closeWindow = () => {
    if (persistenceKey) { try { localStorage.removeItem(persistenceKey) } catch { /* best effort */ } }
    onClose()
  }

  const controls = <div className="internal-window-controls" role="group" aria-label={`Controlos da janela ${title}`}>
    <span ref={dragGripRef} className="internal-window-drag-grip" data-internal-window-drag-handle="true" aria-hidden="true"/>
    <button type="button" onClick={() => setMinimized(true)} aria-label={`Minimizar ${title}`} title="Minimizar"><Icon name="minus" size={12}/></button>
    {maximizable && <button type="button" onClick={() => setMaximized((value) => !value)} aria-label={`${maximized ? 'Restaurar' : 'Maximizar'} ${title}`} title={maximized ? 'Restaurar tamanho' : 'Ecrã inteiro'}><Icon name={maximized ? 'collapse' : 'monitor'} size={12}/></button>}
    <button type="button" disabled={closeDisabled} onClick={closeWindow} aria-label={`Fechar ${title}`} title="Fechar"><Icon name="close" size={12}/></button>
  </div>
  const surface = isValidElement<{ children?: ReactNode }>(children) && typeof children.type === 'string'
    ? cloneElement(children, undefined, <>{children.props.children}{controls}</>)
    : <div className="internal-window-surface">{children}{controls}</div>

  const layer = <div
    className={`internal-window-layer ${layerClassName} ${minimized ? 'is-minimized' : ''}`.trim()}
    data-internal-window-state={minimized ? 'minimized' : 'open'}
    aria-hidden={minimized || undefined}
  >
    <div ref={shellRef} className="internal-window-shell" data-internal-window-maximizable={maximizable || undefined} data-internal-window-maximized={maximized || undefined} onKeyDown={(event) => {
      if (event.key !== 'Escape' || closeDisabled) return
      event.stopPropagation()
      closeWindow()
    }}>
      {surface}
      <span ref={resizeGripRef} className="internal-window-resize-grip" data-internal-window-no-drag aria-label={`Redimensionar ${title}`} role="separator"/>
    </div>
  </div>

  return <>
    {portalRoot ? createPortal(layer, portalRoot) : layer}
    {minimized && dockRoot ? createPortal(<div className="internal-window-dock-item" data-internal-window-state="minimized">
      <button ref={restoreRef} type="button" className="internal-window-dock-restore" onClick={() => setMinimized(false)} title={`Restaurar ${title}`}><span aria-hidden="true">▣</span><strong>{title}</strong></button>
      <button type="button" className="internal-window-dock-close" disabled={closeDisabled} onClick={closeWindow} aria-label={`Fechar ${title}`} title="Fechar"><Icon name="close" size={11}/></button>
    </div>, dockRoot) : null}
  </>
}

function loadMinimizedState(key: string) {
  if (!key) return false
  try { return localStorage.getItem(key) === 'minimized' } catch { return false }
}
