import { readActivityRecoverySource } from '../../../composition/supervision/activity-recovery-source.mjs'
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

test('expected downloads guard in-flight clicks and deduplicate delivery by request id', async () => {
  const source = await readActivityRecoverySource()
  const router = await readFile(new URL('./router.mjs', import.meta.url), 'utf8')
  const bundle = await readFile(new URL('../bundle.mjs', import.meta.url), 'utf8')
  const pollStart = source.indexOf('async function pollExpectedChatGPTDownloadKey(key)')
  const pollEnd = source.indexOf('\nasync function pollExpectedChatGPTDownloads', pollStart)
  assert.notEqual(pollStart, -1)
  const poll = source.slice(pollStart, pollEnd)
  assert.match(poll, /if \(!expected\.downloadInFlight && \(!keepFlowing \|\| Number\(expected\.invalidBundleCount \|\| 0\) === 0\) && \(!expected\.lastDOMClick \|\| now - expected\.lastDOMClick >= DOM_DOWNLOAD_RETRY_MS\)\)/)
  assert.match(poll, /expected\.downloadInFlight = true/)
  assert.match(source, /createChatGPTDownloadRouter\(\{/)
  assert.match(router, /handleBundleDownload\(item, sourceFilename, sourceWebContents, expectedBundle, sourceCacheKey, bundleCandidate\)/)
  assert.match(source, /recentlyDelivered: recentlyDeliveredChatGPTBundleRequestId/)
  assert.match(source, /pendingDeliveries: pendingChatGPTBundleDeliveries/)
  assert.match(bundle, /live\.downloadInFlight = false/)
  assert.match(bundle, /recentlyDelivered\(validated\.requestId\)/)
  assert.match(bundle, /pendingDeliveries\.set\(validated\.requestId/)
  assert.match(poll, /pendingChatGPTBundleDeliveries\.has\(expected\.requestId\)\) return/)
  const ackStart = source.indexOf('async function acknowledgeChatGPTBundle(')
  const ackEnd = source.indexOf('\nfunction chatGPTPartitionPath', ackStart)
  assert.match(source.slice(ackStart, ackEnd), /markChatGPTBundleRequestDelivered\(id\)/)
})
