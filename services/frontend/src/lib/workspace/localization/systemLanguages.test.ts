import { afterEach, expect, it, vi } from 'vitest'
import { applySystemLanguages, interfaceLocale, setLocalePreference } from './locale'
import { initializeSystemLanguages } from './systemLanguages'
const bridge = vi.hoisted(() => ({ windows: { info: vi.fn() } }))
afterEach(() => { applySystemLanguages(undefined); delete window.wharnessDesktop; vi.clearAllMocks() })
it('uses the native operating system preference without overriding a manual choice', async () => {
  setLocalePreference('system')
  window.wharnessDesktop = bridge as never
  bridge.windows.info.mockResolvedValue({ systemLanguages: ['fr-CA', 'en-US'] })
  await initializeSystemLanguages()
  expect(bridge.windows.info).toHaveBeenCalledOnce()
  expect(interfaceLocale()).toBe('fr')
  expect(document.documentElement.lang).toBe('fr')
  setLocalePreference('en')
  bridge.windows.info.mockResolvedValue({ systemLanguages: ['pt-AO'] })
  await initializeSystemLanguages()
  expect(interfaceLocale()).toBe('en')
})
it('keeps browser detection working with older Desktop hosts and failed IPC', async () => {
  setLocalePreference('system')
  window.wharnessDesktop = bridge as never
  bridge.windows.info.mockResolvedValue({ windowId: 'old', windowCount: 1 })
  await initializeSystemLanguages()
  expect(interfaceLocale()).toBe('pt')
  bridge.windows.info.mockRejectedValue(new Error('unavailable'))
  await expect(initializeSystemLanguages()).resolves.toBeUndefined()
  expect(interfaceLocale()).toBe('pt')
})
it('bounds native metadata and rejects non-locale values', async () => {
  setLocalePreference('system')
  window.wharnessDesktop = bridge as never
  bridge.windows.info.mockResolvedValue({ systemLanguages: ['/private/path', 1, 'not a locale'] })
  await initializeSystemLanguages()
  expect(interfaceLocale()).toBe('pt')
})
