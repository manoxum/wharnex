import { createExpectedBundlePoll } from './poll-key.mjs'
import { createExpectedBundleSweep } from './poll-all.mjs'

export function createExpectedBundleSupervision(context) {
  const operations = { ...context, ...createExpectedBundlePoll(context) }
  Object.assign(operations, createExpectedBundleSweep(operations))
  return operations
}
