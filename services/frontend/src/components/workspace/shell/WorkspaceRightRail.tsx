import { useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react'
import { desktopWindowScope } from '../../../lib/project/context/projectBindings'
import { drawerResizeCeiling } from '../../../lib/workspace/layout/workbenchResize'
import { DatabaseExplorerPanel } from '../../database/browser/DatabaseExplorerPanel'
import { Icon } from '../../presentation/chrome/Icon'

export type RightDrawer = 'database' | ''
const WIDTH_KEY = 'whx.workspace.right-drawer-width'
const MIN_WIDTH = 360
const railButton = "relative grid h-9 w-8 shrink-0 cursor-pointer place-items-center rounded-md border-0 bg-transparent p-0 text-whx-faint after:absolute after:right-[-5px] after:top-[5px] after:bottom-[5px] after:w-0.5 after:rounded-sm after:bg-transparent after:content-[''] transition-colors hover:bg-whx-hover hover:text-whx-text max-[760px]:after:left-[5px] max-[760px]:after:right-[5px] max-[760px]:after:top-auto max-[760px]:after:bottom-[-5px] max-[760px]:after:h-0.5 max-[760px]:after:w-auto"

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
    {drawer && <button type="button" className="workspace-right-splitter relative z-20 w-1.5 shrink-0 basis-1.5 touch-none cursor-col-resize border-0 border-r border-solid border-whx-border-soft bg-[color-mix(in_srgb,var(--theme-bg)_88%,var(--theme-border))] p-0 focus-visible:outline-1 focus-visible:outline-whx-border-soft max-[760px]:hidden" onPointerDown={beginResize} aria-label="Redimensionar painel lateral direito" title="Arraste para redimensionar"/>}
    {drawer && <aside className="workspace-right-drawer" style={{ ['--workspace-right-drawer-width' as string]: `${width}px` } as CSSProperties}>
      <div className="workspace-right-drawer-body"><DatabaseExplorerPanel onError={onError}/></div>
      <button type="button" className="workspace-right-close" onClick={() => onDrawer('')} aria-label="Fechar painel lateral direito"><Icon name="close" size={12}/></button>
    </aside>}
    <aside className="workspace-right-rail flex min-h-0 w-[42px] basis-[42px] shrink-0 flex-col items-center gap-[5px] border-l border-whx-border-soft bg-whx-rail px-[5px] py-[7px] max-[760px]:w-auto max-[760px]:basis-auto max-[760px]:min-h-[42px] max-[760px]:flex-row max-[760px]:border-l-0 max-[760px]:border-t" aria-label="Ferramentas laterais direitas">
      <button type="button" className={`${railButton} ${drawer === 'database' ? 'bg-whx-hover text-whx-text after:bg-whx-accent' : ''}`} onClick={() => toggle('database')} aria-label="Database connection" title="Database connection"><Icon name="database" size={18}/></button>
    </aside>
  </>
}

function key() { return `${WIDTH_KEY}:${desktopWindowScope()}` }
function loadWidth() { try { return Math.max(MIN_WIDTH, Number(localStorage.getItem(key())) || 460) } catch { return 460 } }
function saveWidth(width: number) { try { localStorage.setItem(key(), String(width)) } catch { /* best effort */ } }
