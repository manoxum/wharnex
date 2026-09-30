import { registerChatGPTVisibilityIPC } from './visibility.mjs'
import { registerChatGPTNavigationIPC } from './navigation.mjs'
import { registerChatGPTStateIPC } from './state.mjs'
import { registerChatGPTLifecycleIPC } from './lifecycle.mjs'
import { registerChatGPTProbeIPC } from './probes.mjs'
import { registerChatGPTModeIPC } from './modes.mjs'
import { registerChatGPTAuthenticationIPC } from './authentication.mjs'

export function registerChatGPTSurfaceIPC(options) {
  registerChatGPTVisibilityIPC(options)
  registerChatGPTNavigationIPC(options)
  registerChatGPTStateIPC(options)
}

export function registerChatGPTAccountIPC(options) {
  registerChatGPTLifecycleIPC(options)
  registerChatGPTProbeIPC(options)
}

export function registerChatGPTSessionControlIPC(options) {
  registerChatGPTModeIPC(options)
  registerChatGPTAuthenticationIPC(options)
}
