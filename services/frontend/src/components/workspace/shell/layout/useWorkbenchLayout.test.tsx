import { act, fireEvent, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import { useWorkbenchLayout } from './useWorkbenchLayout'
import { loadWorkbenchState, saveWorkbenchState } from '../../../../lib/workspace/preferences/workbenchPreferences'
import { loadWorkspaceRailLayout, WORKBENCH_NAVIGATION_LAYOUT } from '../../../../lib/workspace/layout/workspaceRailLayout'

describe('persistent workbench layout', () => {
  beforeEach(() => localStorage.clear())

  it('concentrates without changing resource visibility preferences and restores the working layout', async () => {
    const { result } = renderHook(() => useWorkbenchLayout('/project', '/project'))
    await act(async () => {})
    act(() => { result.current.setSideDrawer('git'); result.current.setTerminalOpen(true); result.current.setTerminalHeight(340) })
    act(() => result.current.setFocusMode(true))
    expect(result.current.sideDrawer).toBe('git')
    expect(result.current.terminalOpen).toBe(true)
    expect(loadWorkbenchState('/project').bottom).toMatchObject({ open: true, size: 340 })
    act(() => result.current.setFocusMode(false))
    expect(result.current.sideDrawer).toBe('git')
    expect(result.current.terminalHeight).toBe(340)
  })

  it('restores only layout customization and preserves document/chat storage', async () => {
    localStorage.setItem('whx.test.document', 'unsaved draft')
    localStorage.setItem('wharnex.workbench.panel-priority.v1:/project', 'right')
    const { result } = renderHook(() => useWorkbenchLayout('/project', '/project'))
    await act(async () => {})
    act(() => { result.current.setTerminalOpen(true); result.current.setRightDrawer('database'); result.current.setFocusMode(true) })
    act(() => result.current.restoreLayout())
    expect(result.current.focusMode).toBe(false)
    expect(result.current.sideDrawer).toBe('project')
    expect(result.current.rightDrawer).toBe('')
    expect(result.current.terminalOpen).toBe(false)
    expect(loadWorkspaceRailLayout()).toEqual(WORKBENCH_NAVIGATION_LAYOUT)
    expect(localStorage.getItem('whx.test.document')).toBe('unsaved draft')
    expect(localStorage.getItem('wharnex.workbench.panel-priority.v1:/project')).toBeNull()
  })

  it('hydrates another project without overwriting its saved geometry with the previous project', async () => {
    const saved = loadWorkbenchState('/second')
    saveWorkbenchState('/second', { ...saved, left: { ...saved.left, open: true, size: 390, tool: 'knowledge' } })
    const { result, rerender } = renderHook(({ project }) => useWorkbenchLayout(project, '/first'), { initialProps: { project: '/first' } })
    await act(async () => {})
    act(() => result.current.setSideDrawer('git'))
    rerender({ project: '/second' })
    await waitFor(() => expect(result.current.sideDrawer).toBe('knowledge'))
    expect(result.current.leftDrawerWidth).toBe(390)
    expect(loadWorkbenchState('/second').left.tool).toBe('knowledge')
    expect(loadWorkbenchState('/first').left.tool).toBe('git')
  })
  it('reveals a preserved terminal from concentration instead of closing it', async () => {
    const { result } = renderHook(() => useWorkbenchLayout('/project', '/project'))
    await act(async () => {})
    act(() => { result.current.setTerminalOpen(true); result.current.setFocusMode(true) })
    act(() => result.current.toggleTerminal())
    expect(result.current.focusMode).toBe(false)
    expect(result.current.terminalOpen).toBe(true)
    expect(result.current.terminalActivation).toBe(1)
  })
  it('lets a dialog consume Escape before restoring concentration without changing saved geometry', async () => {
    const { result } = renderHook(() => useWorkbenchLayout('/project', '/project'))
    await act(async () => {})
    act(() => { result.current.setSideDrawer('git'); result.current.setLeftDrawerWidth(380); result.current.setFocusMode(true) })
    const dialog = document.createElement('div')
    dialog.setAttribute('role', 'dialog'); document.body.append(dialog)
    fireEvent.keyDown(dialog, { key: 'Escape' })
    expect(result.current.focusMode).toBe(true)
    dialog.remove()
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(result.current.focusMode).toBe(false)
    expect(loadWorkbenchState('/project').left).toMatchObject({ tool: 'git', size: 380, open: true })
  })
})
