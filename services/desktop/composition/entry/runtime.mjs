import { createDesktopBrowserRuntime } from '../browser/index.mjs'
import { createDesktopWindowCreationRuntime } from '../window/index.mjs'
import { createDesktopIPCRegistrar } from '../ipc/index.mjs'
import { createDesktopStartupRuntime } from '../startup/index.mjs'
import { startDesktopRuntime } from '../../lifecycle/index.mjs'
import { createBrowserMonitorPresentation } from '../../agent/index.mjs'
import { normalizeBounds } from '../../security/security.mjs'
import { createAgentMirrorStreams, registerAgentMirrorStreamIPC } from '../../chatgpt/session/mirror/frames.mjs'

export function createDesktopEntrypointRuntime(deps) {
  const browser = createDesktopBrowserRuntime(deps)
  const monitor = createBrowserMonitorPresentation({ ...deps, normalizeBounds })
  const mirrorStreams = createAgentMirrorStreams(deps)
  const window = createDesktopWindowCreationRuntime({ ...deps, ...monitor,
    suspendNativeSurfacesForWindow: (state) => { if (state.id === 'browser-monitor') monitor.releaseBrowserMonitor(state); deps.suspendNativeSurfacesForWindow(state) },
  })
  const registerIPC = createDesktopIPCRegistrar({ ...deps, ...browser, ...monitor, ...window })
  const registerAllIPC = () => { registerIPC(); registerAgentMirrorStreamIPC({ ...deps, mirrorStreams }) }
  // Keep inherited dependency getters live until the ready callback builds its context.
  const startup = createDesktopStartupRuntime(Object.assign(Object.create(deps), browser, window, { registerIPC: registerAllIPC }))

  return {
    start: () => { mirrorStreams.start(); return startDesktopRuntime(startup.startupContext()) },
    registerLifecycle: startup.registerLifecycle,
    createWindow: window.createWindow,
  }
}
