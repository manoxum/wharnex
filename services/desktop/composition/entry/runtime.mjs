import { createDesktopBrowserRuntime } from '../browser/index.mjs'
import { createDesktopWindowCreationRuntime } from '../window/index.mjs'
import { createDesktopIPCRegistrar } from '../ipc/index.mjs'
import { createDesktopStartupRuntime } from '../startup/index.mjs'
import { startDesktopRuntime } from '../../lifecycle/index.mjs'

export function createDesktopEntrypointRuntime(deps) {
  const browser = createDesktopBrowserRuntime(deps)
  const window = createDesktopWindowCreationRuntime(deps)
  const registerIPC = createDesktopIPCRegistrar({ ...deps, ...browser, ...window })
  // Keep inherited dependency getters live until the ready callback builds its context.
  const startup = createDesktopStartupRuntime(Object.assign(Object.create(deps), browser, window, { registerIPC }))

  return {
    start: () => startDesktopRuntime(startup.startupContext()),
    registerLifecycle: startup.registerLifecycle,
  }
}
