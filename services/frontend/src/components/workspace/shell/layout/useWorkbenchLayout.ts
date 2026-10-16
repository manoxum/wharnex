import { useEffect, useRef, useState } from 'react'
import { loadWorkbenchState, saveWorkbenchState, defaultSidePanelWidth, DEFAULT_WORKBENCH_STATE } from '../../../../lib/workspace/preferences/workbenchPreferences'
import { loadWorkspaceRailLayout, saveWorkspaceRailLayout, WORKBENCH_NAVIGATION_LAYOUT } from '../../../../lib/workspace/layout/workspaceRailLayout'
import type { Drawer } from '../../../../lib/workspace/layout/workspaceDrawer'
import { resetPanelPriority } from './panelPriority'

export function useWorkbenchLayout(projectPath: string, initialProject: string, detachedTerminal = false, detached = false) {
  const initialWorkbench = useRef(loadWorkbenchState(initialProject)).current
  const [sideDrawer, setSideDrawer] = useState<Drawer>(initialWorkbench.left.open ? initialWorkbench.left.tool as Drawer : '')
  const [rightDrawer, setRightDrawer] = useState<Drawer>(initialWorkbench.right.open ? initialWorkbench.right.tool as Drawer : '')
  const [leftDrawerWidth, setLeftDrawerWidth] = useState(initialWorkbench.left.size)
  const [rightDrawerWidth, setRightDrawerWidth] = useState(initialWorkbench.right.size)
  const [terminalOpen, setTerminalOpen] = useState(detachedTerminal || initialWorkbench.bottom.open)
  const [terminalHeight, setTerminalHeight] = useState(initialWorkbench.bottom.size)
  const [railLayout, setRailLayout] = useState(() => loadWorkspaceRailLayout(initialProject))
  const [zenMode, setZenMode] = useState(false)
  const [focusMode, setFocusMode] = useState(false)
  const [terminalActivation, setTerminalActivation] = useState(0)
  const loadedProject = useRef(initialProject)
  const remembered = useRef<{ left: Drawer; right: Drawer }>({ left: 'project', right: 'tasks' })
  if (sideDrawer) remembered.current.left = sideDrawer
  if (rightDrawer) remembered.current.right = rightDrawer

  useEffect(() => {
    if (!focusMode && !zenMode) return
    const exit = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented || event.target instanceof Element && event.target.closest('[role="dialog"]')) return
      setFocusMode(false); setZenMode(false)
    }
    window.addEventListener('keydown', exit)
    return () => window.removeEventListener('keydown', exit)
  }, [focusMode, zenMode])

  useEffect(() => {
    if (!projectPath || detached) return
    loadedProject.current = ''
    const state = loadWorkbenchState(projectPath)
    remembered.current = { left: state.left.tool || 'project', right: state.right.tool || 'tasks' }
    setSideDrawer(state.left.open ? state.left.tool as Drawer : '')
    setRightDrawer(state.right.open ? state.right.tool as Drawer : '')
    setLeftDrawerWidth(state.left.size); setRightDrawerWidth(state.right.size)
    setTerminalOpen(state.bottom.open); setTerminalHeight(state.bottom.size)
    setRailLayout(loadWorkspaceRailLayout(projectPath)); setFocusMode(false); setZenMode(false)
    let cancelled = false
    window.queueMicrotask(() => { if (!cancelled) loadedProject.current = projectPath })
    return () => { cancelled = true }
  }, [projectPath, detached])

  useEffect(() => {
    if (!projectPath || detached || loadedProject.current !== projectPath) return
    saveWorkbenchState(projectPath, {
      version: 1,
      left: { open: Boolean(sideDrawer), collapsed: !sideDrawer, size: leftDrawerWidth, tool: sideDrawer || remembered.current.left },
      right: { open: Boolean(rightDrawer), collapsed: !rightDrawer, size: rightDrawerWidth, tool: rightDrawer || remembered.current.right },
      bottom: { open: terminalOpen, collapsed: !terminalOpen, size: terminalHeight },
    })
  }, [projectPath, detached, sideDrawer, rightDrawer, leftDrawerWidth, rightDrawerWidth, terminalOpen, terminalHeight])

  function restoreLayout() {
    resetPanelPriority(projectPath); setZenMode(false)
    setFocusMode(false)
    setTerminalActivation((value) => value + 1)
    setSideDrawer('project'); setRightDrawer(''); setTerminalOpen(false)
    setLeftDrawerWidth(Math.max(240, defaultSidePanelWidth()))
    setRightDrawerWidth(Math.max(320, defaultSidePanelWidth()))
    setTerminalHeight(DEFAULT_WORKBENCH_STATE.bottom.size)
    setRailLayout(saveWorkspaceRailLayout(WORKBENCH_NAVIGATION_LAYOUT))
  }
  return { initialWorkbench, sideDrawer, setSideDrawer, rightDrawer, setRightDrawer, leftDrawerWidth, setLeftDrawerWidth, rightDrawerWidth, setRightDrawerWidth, terminalOpen, setTerminalOpen, terminalHeight, setTerminalHeight, railLayout, setRailLayout, zenMode, setZenMode, focusMode, setFocusMode, restoreLayout, terminalActivation,
    toggleTerminal: () => { const reveal = !terminalOpen || focusMode || zenMode; setZenMode(false); setFocusMode(false); setTerminalOpen(reveal); if (reveal) setTerminalActivation((value) => value + 1) },
    toggleLeft: () => { setZenMode(false); setFocusMode(false); if (!sideDrawer && rightDrawer === remembered.current.left) setRightDrawer(''); setSideDrawer((current) => current ? '' : remembered.current.left) },
    toggleRight: () => { setZenMode(false); setFocusMode(false); if (!rightDrawer && sideDrawer === remembered.current.right) setSideDrawer(''); setRightDrawer((current) => current ? '' : remembered.current.right) },
  }
}
