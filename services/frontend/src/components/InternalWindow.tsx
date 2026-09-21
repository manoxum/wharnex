import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { ensureInternalWindowDockRoot } from '../lib/internalWindow'
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
  const restoreRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (minimized) restoreRef.current?.focus()
  }, [minimized])

  return <>
    <div
      className={`internal-window-layer ${layerClassName} ${minimized ? 'is-minimized' : ''}`.trim()}
      data-internal-window-state={minimized ? 'minimized' : 'open'}
      aria-hidden={minimized || undefined}
    >
      <div className="internal-window-shell" onKeyDown={(event) => {
        if (event.key !== 'Escape' || closeDisabled) return
        event.stopPropagation()
        onClose()
      }}>
        {children}
        <div className="internal-window-controls" role="group" aria-label={`Controlos da janela ${title}`}>
          <button type="button" onClick={() => setMinimized(true)} aria-label={`Minimizar ${title}`} title="Minimizar"><Icon name="minus" size={12}/></button>
          <button type="button" disabled={closeDisabled} onClick={onClose} aria-label={`Fechar ${title}`} title="Fechar"><Icon name="close" size={12}/></button>
        </div>
      </div>
    </div>
    {minimized && dockRoot ? createPortal(<div className="internal-window-dock-item" data-internal-window-state="minimized">
      <button ref={restoreRef} type="button" className="internal-window-dock-restore" onClick={() => setMinimized(false)} title={`Restaurar ${title}`}><span aria-hidden="true">▣</span><strong>{title}</strong></button>
      <button type="button" className="internal-window-dock-close" disabled={closeDisabled} onClick={onClose} aria-label={`Fechar ${title}`} title="Fechar"><Icon name="close" size={11}/></button>
    </div>, dockRoot) : null}
  </>
}
