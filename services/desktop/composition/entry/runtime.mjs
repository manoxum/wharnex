import { createDesktopBrowserRuntime } from '../browser/index.mjs'
import { createDesktopWindowCreationRuntime } from '../window/index.mjs'
import { createDesktopIPCRegistrar } from '../ipc/index.mjs'
import { createDesktopStartupRuntime } from '../startup/index.mjs'
import { startDesktopRuntime } from '../../lifecycle/index.mjs'
import { createBrowserMonitorPresentation } from '../../agent/index.mjs'
import { normalizeBounds } from '../../security/security.mjs'
import { createProjectSurfaceMirror } from '../../chatgpt/session/mirror/frames.mjs'

export function createDesktopEntrypointRuntime(deps) {
  const browser = createDesktopBrowserRuntime(deps)
  const monitor = createBrowserMonitorPresentation({ ...deps, normalizeBounds })
  const mirror = createProjectSurfaceMirror(deps)
  const window = createDesktopWindowCreationRuntime({ ...deps, ...monitor,
    suspendNativeSurfacesForWindow: (state) => { if (state.id === 'browser-monitor') monitor.releaseBrowserMonitor(state); deps.suspendNativeSurfacesForWindow(state) },
  })
  const registerIPC = createDesktopIPCRegistrar({ ...deps, ...browser, ...monitor, ...window })
  // Keep inherited dependency getters live until the ready callback builds its context.
  const startup = createDesktopStartupRuntime(Object.assign(Object.create(deps), browser, window, { registerIPC }))

  return {
    start: () => { mirror.start(); return startDesktopRuntime(startup.startupContext()) },
    registerLifecycle: startup.registerLifecycle,
    createWindow: window.createWindow,
  }
}
