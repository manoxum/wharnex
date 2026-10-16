import { act, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { useOperationalTab } from './useOperationalTab'

afterEach(() => { localStorage.removeItem('wharnex.workbench.bottom-tool.v1:/first'); localStorage.removeItem('wharnex.workbench.bottom-tool.v1:/second') })
describe('operational selection persistence', () => {
  it('restores each project selection and reveals the terminal for an explicit human run request', () => {
    const initialProps: { path: string; request?: number } = { path: '/first' }
    const view = renderHook(({ path, request }) => useOperationalTab(path, request), { initialProps })
    act(() => view.result.current.select('problems'))
    view.rerender({ path: '/second' })
    expect(view.result.current.tab).toBe('terminal')
    expect(localStorage.getItem('wharnex.workbench.bottom-tool.v1:/first')).toBe('problems')
    act(() => view.result.current.select('output'))
    view.rerender({ path: '/first' })
    expect(view.result.current.tab).toBe('problems')
    view.rerender({ path: '/first', request: 7 })
    expect(view.result.current.tab).toBe('terminal')
    expect(localStorage.getItem('wharnex.workbench.bottom-tool.v1:/second')).toBe('output')
  })
})
