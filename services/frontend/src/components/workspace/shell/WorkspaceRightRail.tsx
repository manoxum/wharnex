import { useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react'
import { desktopWindowScope } from '../../../lib/project/context/projectBindings'
import { drawerResizeCeiling } from '../../../lib/workspace/layout/workbenchResize'
import { DatabaseExplorerPanel } from '../../database/browser/DatabaseExplorerPanel'
import { Icon } from '../../presentation/chrome/Icon'

export type RightDrawer = 'database' | ''
const WIDTH_KEY = 'whx.workspace.right-drawer-width'
const MIN_WIDTH = 360

export function WorkspaceRightRail({ drawer, onDrawer, onError }: { drawer: RightDrawer; onDrawer: (drawer: RightDrawer) => void; onError: (message: string) => void }) {
  const [width, setWidth] = useState(loadWidth)
  const toggle = (next: Exclude<RightDrawer, ''>) => onDrawer(drawer === next ? '' : next)

  function beginResize(event: ReactPointerEvent<HTMLButtonElement>) {
    const body = event.currentTarget.closest('.workspace-body') as HTMLElement | null
    const panel = body?.querySelector('.workspace-right-drawer') as HTMLElement | null
    if (!body || !panel) return
    event.currentTarget.setPointerCapture(event.pointerId)
    const startX = event.clientX; const startWidth = panel.getBoundingClientRect().width
    // Recomputed per move against the whole live row. Deriving the ceiling
    // once from the centre's own width reserved 560px for it and counted no
    // other panel at all, so this splitter happily overran the left drawer -
    // and since the centre takes no share of flex shrinking, the left drawer
    // is what visibly gave way. See lib/workbenchResize.
    const move = (moveEvent: PointerEvent) => {
      const maxWidth = drawerResizeCeiling(body, panel, MIN_WIDTH)
      const next = Math.round(Math.max(MIN_WIDTH, Math.min(maxWidth, startWidth + startX - moveEvent.clientX)))
      setWidth(next); saveWidth(next)
    }
    const finish = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', finish) }
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', finish)
  }

  return <>
    {drawer && <button type="button" className="workspace-right-splitter" onPointerDown={beginResize} aria-label="Redimensionar painel lateral direito" title="Arraste para redimensionar"/>}
    {drawer && <aside className="workspace-right-drawer" style={{ ['--workspace-right-drawer-width' as string]: `${width}px` } as CSSProperties}>
      <div className="workspace-right-drawer-body"><DatabaseExplorerPanel onError={onError}/></div>
      <button type="button" className="workspace-right-close" onClick={() => onDrawer('')} aria-label="Fechar painel lateral direito"><Icon name="close" size={12}/></button>
    </aside>}
    <aside className="workspace-right-rail" aria-label="Ferramentas laterais direitas">
      <button type="button" className={drawer === 'database' ? 'active' : ''} onClick={() => toggle('database')} aria-label="Database connection" title="Database connection"><Icon name="database" size={18}/></button>
    </aside>
  </>
}

function key() { return `${WIDTH_KEY}:${desktopWindowScope()}` }
function loadWidth() { try { return Math.max(MIN_WIDTH, Number(localStorage.getItem(key())) || 460) } catch { return 460 } }
function saveWidth(width: number) { try { localStorage.setItem(key(), String(width)) } catch { /* best effort */ } }
