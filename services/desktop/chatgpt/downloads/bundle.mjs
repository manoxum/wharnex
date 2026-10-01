import path from 'node:path'
import { mkdirSync } from 'node:fs'
import { readFile, rm } from 'node:fs/promises'

export function createChatGPTBundleDownload({ pendingDeliveries, maxBytes, pendingDirectory, expectedBundles, validateBundle, recordValidBundle, recentlyDelivered, quiesceRecovery, publishBundle, publishError, recordTaskEvent, sanitizeURL }) {
  return function handleBundleDownload(item, sourceFilename, sourceWebContents, expectedBundle, sourceCacheKey, bundleCandidate) {
    const filename = bundleCandidate.filename
    const bundleRequestId = bundleCandidate.requestId
    // A cross-request bundle belongs to its request, not the surface that
    // happened to download it.
    const deliveryCacheKey = bundleCandidate.unrouted ? '' : sourceCacheKey
    if (pendingDeliveries.has(bundleRequestId)) {
      item.cancel()
      console.warn(`[chatgpt-bundle-download] awaiting-ack duplicate-cancelled file=${filename} request=${bundleRequestId}`)
      return
    }
    const sourceURL = sourceWebContents?.getURL?.() || ''
    if (bundleCandidate.normalized) console.warn(`[chatgpt-bundle-download] normalized sourceFile=${sourceFilename} canonicalFile=${filename} request=${bundleRequestId}`)
    console.log(`[chatgpt-bundle-download] started file=${filename} source=${sanitizeURL(sourceURL)}`)
    const total = item.getTotalBytes()
    if (total > maxBytes) {
      item.cancel()
      publishError('Bundle Wharnex excede o limite de 16 MiB.', filename, sourceCacheKey)
      return
    }
    const dir = pendingDirectory()
    const savePath = path.join(dir, filename)
    try {
      mkdirSync(dir, { recursive: true, mode: 0o700 })
      item.setSavePath(savePath)
    } catch (error) {
      item.cancel()
      publishError(`Não foi possível preparar o bundle: ${error instanceof Error ? error.message : String(error)}`, filename, sourceCacheKey)
      return
    }
    item.on('updated', () => {
      if (item.getReceivedBytes() > maxBytes) {
        item.cancel()
        publishError('Bundle Wharnex excede o limite de 16 MiB.', filename, sourceCacheKey)
      }
    })
    item.once('done', async (_doneEvent, state) => {
      // Release the in-flight guard on every outcome so a later retry works.
      const live = expectedBundle?.key ? expectedBundles.get(expectedBundle.key) : undefined
      if (live && live.requestId === expectedBundle.requestId) live.downloadInFlight = false
      if (state !== 'completed') {
        if (state !== 'cancelled') publishError(`Download do bundle terminou em estado ${state}.`, filename, deliveryCacheKey)
        return
      }
      let retainedForAcknowledgement = false
      try {
        const bytes = await readFile(savePath)
        if (bytes.byteLength > maxBytes) throw new Error('Bundle Wharnex excede o limite de 16 MiB.')
        const validated = validateBundle(filename, bytes)
        recordValidBundle(expectedBundle, sourceURL, validated)
        if (recentlyDelivered(validated.requestId)) {
          console.warn(`[chatgpt-bundle-download] duplicate-suppressed file=${filename} request=${validated.requestId}`)
          return
        }
        if (pendingDeliveries.has(validated.requestId)) {
          console.warn(`[chatgpt-bundle-download] awaiting-ack duplicate-suppressed file=${filename} request=${validated.requestId}`)
          retainedForAcknowledgement = true
          return
        }
        pendingDeliveries.set(validated.requestId, { cacheKey: deliveryCacheKey, filename, filePath: savePath })
        retainedForAcknowledgement = true
        quiesceRecovery(validated.requestId, expectedBundle?.key || deliveryCacheKey)
        publishBundle({ cacheKey: deliveryCacheKey, filename, requestId: validated.requestId, contentBase64: bytes.toString('base64'), bytes: bytes.byteLength, sourceFilename, normalizedFilename: bundleCandidate.normalized, unrouted: Boolean(bundleCandidate.unrouted) }, sourceCacheKey)
        console.log(`[chatgpt-bundle-download] awaiting-ack file=${filename} bytes=${bytes.byteLength}`)
        if (live && live.requestId === validated.requestId) recordTaskEvent(live, 'chatgpt.bundle_validated', { filename, bytes: bytes.byteLength })
      } catch (error) {
        if (live && live.requestId === bundleRequestId) {
          live.invalidBundleCount = Number(live.invalidBundleCount || 0) + 1
          live.lastDOMClick = 0
          console.warn(`[chatgpt-bundle-download] protocol-invalid key=${expectedBundle?.key || '-'} request=${bundleRequestId} count=${live.invalidBundleCount}`)
          recordTaskEvent(live, 'chatgpt.bundle_rejected', {
            filename, error: String(error instanceof Error ? error.message : error).slice(0, 500), invalidBundleCount: live.invalidBundleCount,
          })
        }
        publishError(error instanceof Error ? error.message : String(error), filename, deliveryCacheKey)
      } finally {
        if (!retainedForAcknowledgement) try { await rm(savePath, { force: true }) } catch { /* best effort temp cleanup */ }
      }
    })
  }
}
