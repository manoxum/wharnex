import { act, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { monitorGridColumns } from './monitorLayoutModel'
import { useMonitorLayout } from './useMonitorLayout'

const key = 'wharnex.browser-monitor.layout.v1'
afterEach(() => { localStorage.removeItem(key); vi.unstubAllGlobals() })
describe('browser monitor layout', () => {
  it('preserves preferred panels through narrow widths and temporary browser focus', () => {
    vi.stubGlobal('innerWidth', 1440)
    const view = renderHook(useMonitorLayout)
    expect(view.result.current.listOpen && view.result.current.detailsOpen).toBe(true)
    act(() => { window.innerWidth = 600; window.dispatchEvent(new Event('resize')) })
    expect(view.result.current.listOpen || view.result.current.detailsOpen).toBe(false)
    expect(JSON.parse(localStorage.getItem(key)!)).toEqual({ list: true, details: true })
    act(() => view.result.current.toggleList())
    expect(view.result.current.listOpen).toBe(true)
    act(() => view.result.current.toggleDetails())
    expect(view.result.current.detailsOpen).toBe(true)
    expect(view.result.current.listOpen).toBe(false)
    act(() => { window.innerWidth = 1440; window.dispatchEvent(new Event('resize')) })
    act(() => view.result.current.toggleFocus())
    expect(view.result.current.listOpen || view.result.current.detailsOpen).toBe(false)
    expect(JSON.parse(localStorage.getItem(key)!)).toEqual({ list: true, details: true })
    act(() => view.result.current.toggleFocus())
    expect(view.result.current.listOpen && view.result.current.detailsOpen).toBe(true)
  })

  it('reclaims browser width for policies and yields side panels predictably', () => {
    vi.stubGlobal('innerWidth', 1440)
    const view = renderHook(({ policiesOpen }) => useMonitorLayout(policiesOpen), { initialProps: { policiesOpen: true } })
    expect(view.result.current.listOpen && view.result.current.detailsOpen).toBe(true)

    act(() => { window.innerWidth = 1120; window.dispatchEvent(new Event('resize')) })
    expect(view.result.current.listOpen).toBe(true)
    expect(view.result.current.detailsOpen).toBe(false)
    expect(monitorGridColumns(1120, { list: true, details: false }, true)).toBe('213px 44px minmax(0, 1fr) 314px')

    act(() => view.result.current.toggleDetails())
    expect(view.result.current.listOpen).toBe(false)
    expect(view.result.current.detailsOpen).toBe(true)

    act(() => view.rerender({ policiesOpen: false }))
    expect(view.result.current.listOpen && view.result.current.detailsOpen).toBe(true)
    act(() => { window.innerWidth = 1440; window.dispatchEvent(new Event('resize')) })
    expect(JSON.parse(localStorage.getItem(key)!)).toEqual({ list: true, details: true })
  })
})
