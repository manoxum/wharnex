import { act, fireEvent, renderHook } from '@testing-library/react'
import { expect, it } from 'vitest'
import { useWorkbenchLayout } from './useWorkbenchLayout'
import { loadWorkbenchState } from '../../../../lib/workspace/preferences/workbenchPreferences'
import { workbenchPresentation } from './workbenchPresentation'
it('frames the open IDE with a neutral theme fill along its top and side edges', () => {
  const standard = workbenchPresentation(false)
  const zen = workbenchPresentation(true, true)
  const backgroundFrame = '!px-0.5 !pt-0.5 !bg-[color-mix(in_srgb,var(--theme-bg)_92%,var(--theme-text))]'

  expect(standard).toContain(backgroundFrame)
  expect(zen).toContain(backgroundFrame)
  expect(standard).not.toContain('border-l')
  expect(standard).not.toContain('border-r')
  expect(standard).not.toContain('border-t')
  expect(backgroundFrame).not.toContain('theme-accent')
})

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
