import { act, renderHook } from '@testing-library/react'
import { createRef } from 'react'
import { expect, it } from 'vitest'
import { useUtilityDock } from './useUtilityDock'
import type { OperationalTab } from './useOperationalTab'
it('restores independent docking and widths, releases the layout and keeps the centre elastic', () => {
  localStorage.clear()
  const parent = document.createElement('div'), node = document.createElement('section')
  parent.append(node); document.body.append(parent)
  Object.defineProperty(parent, 'clientWidth', { value: 1000 })
  const root = createRef<HTMLElement>(); root.current = node
  const view = renderHook(({ tool, visible }: { tool: OperationalTab; visible: boolean }) => useUtilityDock(root, '/work', tool, visible), { initialProps: { tool: 'terminal', visible: true } })
  act(() => view.result.current.move('right'))
  act(() => view.result.current.resize(480))
  expect(parent.style.display).toBe('grid')
  expect(parent.style.gridTemplateColumns).toContain('480px')
  expect(parent.style.gridTemplateColumns).toContain('48%')
  view.rerender({ tool: 'problems', visible: true })
  expect(view.result.current.dock).toBe('bottom')
  expect(view.result.current.width).toBe(360)
  expect(parent.style.display).toBe('')
  view.rerender({ tool: 'terminal', visible: true })
  expect(view.result.current.dock).toBe('right')
  expect(view.result.current.width).toBe(480)
  view.rerender({ tool: 'terminal', visible: false })
  expect(parent.style.display).toBe('')
  view.unmount(); parent.remove()
})
it('uses bottom docking in a narrow centre without overwriting the saved side preference', () => {
  localStorage.setItem('wharnex.utility.geometry.v1:/narrow:terminal', JSON.stringify({ dock: 'right', width: 420 }))
  const parent = document.createElement('div'), node = document.createElement('section'); parent.append(node)
  Object.defineProperty(parent, 'clientWidth', { value: 500 })
  const root = createRef<HTMLElement>(); root.current = node
  const view = renderHook(() => useUtilityDock(root, '/narrow', 'terminal', true))
  expect(view.result.current.dock).toBe('bottom')
  expect(JSON.parse(localStorage.getItem('wharnex.utility.geometry.v1:/narrow:terminal')!).dock).toBe('right')
  view.unmount()
})
