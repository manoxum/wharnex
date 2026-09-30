import { registerResumeExpectedBundleIPC } from './resume.mjs'
import { registerContinueExpectedBundleIPC } from './continue.mjs'

export function registerExpectedBundleRecoveryIPC(options) {
  registerResumeExpectedBundleIPC(options)
  registerContinueExpectedBundleIPC(options)
}
