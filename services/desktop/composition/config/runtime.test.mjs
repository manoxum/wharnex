import assert from 'node:assert/strict'
import test from 'node:test'
import { createDesktopCompositionSettings } from './runtime.mjs'

test('composition settings bound legacy bundle retention without changing startup spacing', () => {
  const low = createDesktopCompositionSettings({ environment: { WHARNESS_CHATGPT_BUNDLE_RETENTION_HOURS: '0.01' }, platform: 'linux' })
  const high = createDesktopCompositionSettings({ environment: { WHARNESS_CHATGPT_BUNDLE_RETENTION_HOURS: '99999' }, platform: 'linux' })
  assert.equal(low.bundleRetentionMs, 60 * 60 * 1000)
  assert.equal(high.bundleRetentionMs, 720 * 60 * 60 * 1000)
  assert.equal(low.startupDelayMs, 2_500)
  assert.equal(low.workerSpawnGapMs, 1_500)
})
