import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useUtilityPanel } from './useUtilityPanel'
import type { OperationalTab } from './useOperationalTab'

const defaults = { projectPath: '/first', visible: true, tab: 'problems' as OperationalTab, problemCount: 0 as number | null, height: 320, onHeight: vi.fn(), onOpen: vi.fn(), onClose: vi.fn() }
beforeEach(() => { localStorage.clear(); vi.clearAllMocks() })

describe('bottom utility space', () => {
  it('releases all space for empty restored diagnostics without overwriting the manual height', () => {
    const { result } = renderHook(() => useUtilityPanel(defaults))
    expect(result.current.expanded).toBe(false)
    expect(result.current.panelHeight).toBe(0)
    expect(defaults.onHeight).not.toHaveBeenCalled()
  })
  it('respects explicit expansion across empty results, remounts and project switches', () => {
    const view = renderHook((props) => useUtilityPanel(props), { initialProps: defaults })
    act(() => view.result.current.expand())
    expect(view.result.current.expanded).toBe(true)
    view.rerender({ ...defaults, problemCount: 2 })
    view.rerender(defaults)
    expect(view.result.current.panelHeight).toBe(320)
    view.rerender({ ...defaults, projectPath: '/second' })
    expect(view.result.current.expanded).toBe(false)
    view.rerender(defaults)
    expect(view.result.current.expanded).toBe(true)
    view.unmount()
    const restored = renderHook(() => useUtilityPanel(defaults))
    expect(restored.result.current.expanded).toBe(true)
  })
  it('maximizes temporarily and restores the exact preferred height', () => {
    const { result } = renderHook(() => useUtilityPanel({ ...defaults, tab: 'terminal' }))
    act(() => result.current.toggleMaximize())
    expect(result.current.panelHeight).toBeGreaterThan(320)
    act(() => result.current.toggleMaximize())
    expect(result.current.panelHeight).toBe(320)
    expect(defaults.onHeight).not.toHaveBeenCalled()
  })
  it('does not invent zero problems on failed or loading data and keeps closed utilities compact', () => {
    const { result, rerender } = renderHook((props) => useUtilityPanel(props), { initialProps: { ...defaults, problemCount: null } })
    expect(result.current.expanded).toBe(false)
    rerender({ ...defaults, visible: false, problemCount: null })
    expect(result.current.panelHeight).toBe(0)
    expect(defaults.onClose).not.toHaveBeenCalled()
  })
})
