import { act, fireEvent, renderHook } from '@testing-library/react'
import { expect, it } from 'vitest'
import { useWorkbenchLayout } from './useWorkbenchLayout'
import { loadWorkbenchState } from '../../../../lib/workspace/preferences/workbenchPreferences'
import { workbenchPresentation } from './workbenchPresentation'
it('hides only presentation in Zen and restores exact saved geometry on Escape', async () => {
  localStorage.clear()
  const { result } = renderHook(() => useWorkbenchLayout('/atlas', '/atlas'))
  await act(async () => {})
  act(() => { result.current.setSideDrawer('docker'); result.current.setLeftDrawerWidth(410); result.current.setTerminalOpen(true); result.current.setTerminalHeight(315) })
  const before = loadWorkbenchState('/atlas')
  act(() => result.current.setZenMode(true))
  expect(workbenchPresentation(false, result.current.zenMode)).toContain('[&_.workspace-topbar]:!hidden')
  expect(loadWorkbenchState('/atlas')).toEqual(before)
  fireEvent.keyDown(window, { key: 'Escape' })
  expect(result.current.zenMode).toBe(false)
  expect(result.current.sideDrawer).toBe('docker')
  expect(loadWorkbenchState('/atlas')).toEqual(before)
})
