import { afterEach, beforeEach, vi } from 'vitest'
import { setLocalePreference } from '../../../../lib/workspace/localization'
beforeEach(() => {
    localStorage.clear()
    setLocalePreference('pt')
    window.history.replaceState({}, '', '/?wharnessWindow=primary')
  })
afterEach(() => {
    vi.restoreAllMocks()
    window.history.replaceState({}, '', '/')
  })
