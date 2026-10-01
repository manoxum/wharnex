import { registerBundlePickerIPC } from './picker.mjs'
import { registerBundleDeliveryIPC } from './delivery.mjs'

export function registerChatGPTBundleIPC(options) {
  registerBundlePickerIPC(options)
  registerBundleDeliveryIPC(options)
}
