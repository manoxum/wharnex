import { registerAgentRuntimeIPC } from './runtime.mjs'
import { registerAgentSurfaceIPC } from './surfaces.mjs'

export function registerAgentIPC(options) {
  registerAgentRuntimeIPC(options)
  registerAgentSurfaceIPC(options)
}
