import { afterEach, beforeEach, vi } from 'vitest'
beforeEach(() => {
    localStorage.clear()
    window.history.replaceState({}, '', '/?wharnessWindow=primary')
  })
afterEach(() => {
    vi.restoreAllMocks()
    window.history.replaceState({}, '', '/')
  })
