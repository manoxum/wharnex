import { createExpectedBundlePoll } from './poll-key.mjs'
import { createExpectedBundleSweep } from './poll-all.mjs'
import { createExpectedDownloadNativeActivation } from './native-activation.mjs'

export function createExpectedBundleSupervision(context) {
  const owned = { ...context, activateExpectedDownloadNative: createExpectedDownloadNativeActivation(context) }
  const operations = { ...owned, ...createExpectedBundlePoll(owned) }
  Object.assign(operations, createExpectedBundleSweep(operations))
  return operations
}
