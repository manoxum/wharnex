import { Suspense, useEffect, useMemo, useState } from 'react'
import { desktopWindowScope } from '../../../lib/project/context/projectBindings'
import { api } from '../../../lib/transport/http/api'
import { PanelSkeleton } from '../../presentation/chrome/Skeleton'
import { DEFAULT_WORKSPACE_RAIL_LAYOUT, type WorkspaceRailSide, type WorkspaceTool } from '../../../lib/workspace/layout/workspaceRailLayout'
import { defaultSidePanelWidth } from '../../../lib/workspace/preferences/workbenchPreferences'
import { WORKSPACE_DRAWERS, workspaceDrawerLabel, type Drawer } from '../../../lib/workspace/layout/workspaceDrawer'
import { InternalWindowPersistenceContext, usePersistentInternalWindowOwners } from '../../../lib/workspace/layout/internalWindowPersistence'
import { useUITestingContextSync } from '../../project/ui-testing/useUITestingContextSync'
import { isWorkspaceTool } from './workspaceToolPresentation'
import { workspaceDrawerClass } from './workspaceDrawerSizing'
import { useSupportingPanel, useSupportingResize, useToolWindowMaximize } from './layout'
import { WorkspaceNavigation } from './navigation'
import { PanelOptions, WorkspaceDrawerContent, loadPanelFontScales, savePanelFontScales, rootUIFontScale } from './panels'
import type { WorkspaceSideRailProps } from './panels/panelTypes'
export type { Drawer } from '../../../lib/workspace/layout/workspaceDrawer'
export type { WorkspaceSideRailProps } from './panels/panelTypes'

function DrawerFallback() {
  return <PanelSkeleton/>
}

const WORKSPACE_DRAWER_WIDTH_KEY = 'whx.workspace.drawer-width'
// Compatibility fallback; live allocation applies per-tool content bounds.
const WORKSPACE_RIGHT_DRAWER_DEFAULT_PX = 460
const PANEL_FONT_SCALE_MIN = 0.8
const PANEL_FONT_SCALE_MAX = 1.4
const EMPTY_WORKSPACE_RAIL_TOOLS: WorkspaceTool[] = []
const DEFAULT_STANDALONE_RAIL_TOOLS: WorkspaceTool[] = (() => {
  const base = [...DEFAULT_WORKSPACE_RAIL_LAYOUT.left, ...DEFAULT_WORKSPACE_RAIL_LAYOUT.pinned.left]
  return base.includes('project') ? base : [...base.slice(0, 2), 'project', ...base.slice(2)]
})()

function scopedKey(prefix: string, side: WorkspaceRailSide) { return `${prefix}:${side}:${desktopWindowScope()}` }

function loadWorkspaceDrawerWidth(side: WorkspaceRailSide) { const fallback = defaultSidePanelWidth() || (side === 'right' ? WORKSPACE_RIGHT_DRAWER_DEFAULT_PX : 0); try { return Number(localStorage.getItem(scopedKey(WORKSPACE_DRAWER_WIDTH_KEY, side))) || fallback } catch { return fallback } }
function saveWorkspaceDrawerWidth(side: WorkspaceRailSide, width: number) { try { localStorage.setItem(scopedKey(WORKSPACE_DRAWER_WIDTH_KEY, side), String(width)) } catch { /* best effort */ } }


export function WorkspaceSideRail(props: WorkspaceSideRailProps) {
  const { session, drawer, onDrawer, archivedChats } = props
  const savedChats = props.savedChats || []
  const side = props.side || 'left'
  const tools = props.tools || DEFAULT_STANDALONE_RAIL_TOOLS
  const pinnedTools = props.pinnedTools || EMPTY_WORKSPACE_RAIL_TOOLS
  const [localDrawerWidth, setLocalDrawerWidth] = useState(() => loadWorkspaceDrawerWidth(side))
  const drawerWidth = props.drawerWidth || localDrawerWidth
  const geometry = useSupportingPanel(side, drawer, drawerWidth, session.project_path)
  const toolWindow = useToolWindowMaximize(geometry.root, drawer, session.project_path)
  const resize = useSupportingResize(geometry.root, side, drawer, session.project_path, (width) => {
    setLocalDrawerWidth(width); saveWorkspaceDrawerWidth(side, width); props.onDrawerWidth?.(width)
  })
  const [pendingCommitCount, setPendingCommitCount] = useState(0)
  const [panelFontScales, setPanelFontScales] = useState<Partial<Record<Exclude<Drawer, ''>, number>>>(loadPanelFontScales)
  const [panelReloads, setPanelReloads] = useState<Partial<Record<Exclude<Drawer, ''>, number>>>({})
  const visibleTools = useMemo(() => tools.filter((tool) => tool !== 'evolution' || session.self_evolution), [session.self_evolution, tools])
  const visiblePinnedTools = useMemo(() => pinnedTools.filter((tool) => tool !== 'evolution' || session.self_evolution), [pinnedTools, session.self_evolution])

  useEffect(() => {
    if (!tools.includes('git') && !pinnedTools.includes('git') && drawer !== 'git') return
    let cancelled = false
    void (async () => {
      try { const overview = await api.gitOverview(session.id); if (!cancelled) setPendingCommitCount(overview.pending.length) }
      catch { if (!cancelled) setPendingCommitCount(0) }
    })()
    return () => { cancelled = true }
  }, [session.id, session.last_host_applied_at, drawer, pinnedTools, tools])

  useUITestingContextSync(session, drawer, tools, pinnedTools)

  const persistenceScope = `${session.project_path}\n${side}`
  const { mountedOwners: mountedDrawers, ownerFor: drawerOwner, register: registerPersistentWindow } = usePersistentInternalWindowOwners(persistenceScope, WORKSPACE_DRAWERS, drawer)
  const toggle = (next: Exclude<Drawer, ''>) => onDrawer(drawer === next ? '' : next)
  const closeDrawer = (candidate: Exclude<Drawer, ''>) => { if (drawer === candidate) onDrawer('') }
  const adjustPanelFontScale = (candidate: Exclude<Drawer, ''>, delta: number) => {
    setPanelFontScales((current) => {
      const value = current[candidate] || 1
      const nextValue = Math.min(PANEL_FONT_SCALE_MAX, Math.max(PANEL_FONT_SCALE_MIN, Math.round((value + delta) * 10) / 10))
      const next = { ...current, [candidate]: nextValue }
      savePanelFontScales(next)
      return next
    })
  }
  const reloadPanel = (candidate: Exclude<Drawer, ''>) => setPanelReloads((current) => ({ ...current, [candidate]: (current[candidate] || 0) + 1 }))


  const rail = <WorkspaceNavigation side={side} tools={visibleTools} pinnedTools={visiblePinnedTools} drawer={drawer} terminalOpen={props.terminalOpen} pendingCommitCount={pendingCommitCount} savedChatCount={savedChats.length + archivedChats.length} onToggle={toggle} onToggleTerminal={props.onToggleTerminal} onMoveTool={props.onMoveTool}/>

  const drawerPanels = mountedDrawers.map((candidate) => {
    const close = () => closeDrawer(candidate)
    const active = candidate === drawer
    const projectExplorer = candidate === 'project'
    const owner = drawerOwner(candidate)
    const panelFontScale = panelFontScales[candidate] || 1
    const drawerStyle = {
      ...(drawerWidth ? { ['--workspace-drawer-width' as string]: `${geometry.width}px` } : {}),
      ['--workspace-panel-font-scale' as string]: String(panelFontScale),
      ['--ui-font-scale' as string]: String(rootUIFontScale() * panelFontScale),
      ...(!active ? { display: 'none' } : {}),
    } as React.CSSProperties
    const panelLabel = workspaceDrawerLabel(candidate)
    return <aside key={candidate} ref={active ? geometry.root : undefined} hidden={!active} data-panel-side={side} data-panel-tool={candidate} data-panel-preferred-width={drawerWidth} data-panel-overlay={geometry.overlay} data-panel-maximized={active && toolWindow.maximized}
      className={`relative !z-10 !flex [&[hidden]]:!hidden !min-h-0 !min-w-0 !flex-col !flex-[0_1_var(--workspace-drawer-width)] !w-[var(--workspace-drawer-width)] !overflow-hidden !border-0 !bg-whx-side !text-whx-soft !shadow-none [&>*]:min-h-0 [&>*]:min-w-0 [&_.whx-panel-heading]:!pr-12 data-[panel-maximized=true]:!absolute data-[panel-maximized=true]:!inset-0 data-[panel-maximized=true]:!z-[60] data-[panel-maximized=true]:!w-auto data-[panel-maximized=true]:!max-w-none data-[panel-overlay=true]:!absolute data-[panel-overlay=true]:!inset-y-0 data-[panel-overlay=true]:!z-50 data-[panel-overlay=true]:!max-w-[calc(100cqw-88px)] ${side === 'right' ? 'data-[panel-overlay=true]:!right-11' : 'data-[panel-overlay=true]:!left-11'} agent-drawer workspace-side-drawer workspace-side-drawer-${side} ${workspaceDrawerClass(candidate)}`} style={drawerStyle}>
      <div className="workspace-panel-toolbar" role="toolbar" aria-label={`Ferramentas do painel ${panelLabel}`}>
        <PanelOptions label={panelLabel} maximized={active && toolWindow.maximized} onMaximize={toolWindow.toggle} side={side} pinned={pinnedTools.some((tool) => tool === candidate)} onMove={props.onMoveTool && isWorkspaceTool(candidate) ? (nextSide, pinned) => props.onMoveTool?.(candidate, nextSide, undefined, pinned) : undefined} scale={panelFontScale} onScale={(delta) => adjustPanelFontScale(candidate, delta)} onReload={projectExplorer ? undefined : () => reloadPanel(candidate)}/>
      </div>
      <InternalWindowPersistenceContext.Provider key={`${owner}:${panelReloads[candidate] || 0}`} value={{ owner, register: registerPersistentWindow }}>
        <Suspense fallback={<DrawerFallback/>}>
        <WorkspaceDrawerContent candidate={candidate} close={close} props={props}/>
        </Suspense>
      </InternalWindowPersistenceContext.Provider>
    </aside>
  })
  const splitter = drawer ? <button type="button" role="separator" aria-orientation="vertical" aria-valuenow={geometry.width} aria-valuemin={resize.minimum} aria-valuemax={resize.maximum} data-panel-overlay={geometry.overlay}
    className={`[[data-tool-maximized]_&]:!hidden relative z-20 col-start-3 row-start-3 !w-1.5 !shrink-0 !basis-1.5 !touch-none !cursor-col-resize !rounded-none !border-0 !bg-transparent !p-0 transition-colors hover:!bg-whx-accent/30 focus-visible:!bg-whx-accent/30 focus-visible:!outline-none motion-reduce:transition-none data-[panel-overlay=true]:!hidden agent-drawer-splitter workspace-side-splitter workspace-side-splitter-${side}`}
    aria-label={`Redimensionar painel lateral ${side === 'left' ? 'esquerdo' : 'direito'}`} title="Arraste ou use as setas para redimensionar" onPointerDown={resize.begin} onKeyDown={resize.keyboard}/> : null

  const backdrop = drawer ? <button type="button" aria-label="Recolher painel sobreposto" onClick={() => onDrawer('')} data-panel-overlay={geometry.overlay}
    className="workspace-drawer-backdrop !absolute !inset-0 !z-40 !hidden !border-0 !bg-[color-mix(in_srgb,var(--theme-bg)_65%,transparent)] !p-0 data-[panel-overlay=true]:!block"/> : null
  return <>{backdrop}{side === 'left' ? <>{rail}{drawerPanels}{splitter}</> : <>{splitter}{drawerPanels}{rail}</>}</>
}
