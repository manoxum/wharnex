import { cleanup, render, screen, act } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { WorkbenchTabs } from './index'

afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals() })

it('observes its own width and intrinsic labels/badges, recovers on widening and remeasures changed content', () => {
  let width = 400; let badgeWidth = 17
  const notify: Array<() => void> = []
  const disconnect = vi.fn(); const observe = vi.fn()
  vi.stubGlobal('ResizeObserver', class {
    constructor(callback: () => void) { notify.push(callback) }
    observe = observe
    disconnect = disconnect
  })
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(() => width)
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    return { width: this.hasAttribute('data-tab-measure') ? 100 : this.hasAttribute('data-tab-badge') ? badgeWidth : 13 } as DOMRect
  })
  const computedStyle = window.getComputedStyle
  vi.spyOn(window, 'getComputedStyle').mockImplementation((node) => Object.assign(computedStyle(node), {
    columnGap: node.hasAttribute('data-workbench-tabs') ? '2px' : '6px',
    paddingLeft: node.hasAttribute('data-workbench-tabs') ? '6px' : '10px',
    paddingRight: node.hasAttribute('data-workbench-tabs') ? '6px' : '10px',
  }))
  const items = [{ id: 'a', label: 'Alterações', icon: 'edit', badge: 0 }, { id: 'b', label: 'Histórico', icon: 'history', badge: 50 }] as const
  const { rerender } = render(<WorkbenchTabs label="Git" value="a" items={items} onChange={vi.fn()}/>)
  const strip = screen.getByRole('tablist', { name: 'Git' })
  expect(strip.dataset.density).toBe('full')
  expect(observe).toHaveBeenCalledWith(strip)
  expect(observe).toHaveBeenCalledWith(strip.querySelector('[data-tab-measure]'))
  expect(observe).toHaveBeenCalledWith(strip.querySelector('[data-tab-badge]'))
  width = 160; act(() => notify.at(-1)?.())
  expect(strip.dataset.density).toBe('compact')
  width = 100; act(() => notify.at(-1)?.())
  expect(strip.dataset.density).toBe('icons')
  expect(screen.getByRole('tab', { name: 'Alterações' }).getAttribute('aria-selected')).toBe('true')
  width = 400; act(() => notify.at(-1)?.())
  expect(strip.dataset.density).toBe('full')
  width = 160; badgeWidth = 60
  rerender(<WorkbenchTabs label="Git" value="a" items={items.map((item) => ({ ...item, badge: 123456 }))} onChange={vi.fn()}/>)
  expect(strip.dataset.density).toBe('icons')
  expect(disconnect).toHaveBeenCalled()
})
