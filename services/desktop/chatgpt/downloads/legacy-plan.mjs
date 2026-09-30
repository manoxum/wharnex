import path from 'node:path'
import { mkdirSync } from 'node:fs'
import { readFile, rm } from 'node:fs/promises'

export function createLegacyPlanDownload({ tempPath, maxBytes, requestIdFromFilename, validatePlanFile, publishPlan, publishError, humanBrowsing, sanitizeURL }) {
  return function handleLegacyPlanDownload(item, filename, sourceWebContents, sourceCacheKey) {
    const requestId = requestIdFromFilename(filename)
    if (!requestId) {
      if (filename.startsWith('wharness-plan-')) {
        item.cancel()
        publishError('Nome do ficheiro de plano inválido; esperado wharness-plan-<request_id>.json.', filename, sourceCacheKey)
        return
      }
      // Unknown automation downloads fail closed; only explicit human browsing
      // retains Chromium's ordinary download behavior.
      if (humanBrowsing(sourceWebContents)) return
      item.cancel()
      console.warn(`[chatgpt-download] unrecognized artifact cancelled file=${filename} key=${sourceCacheKey || '-'} mime=${item.getMimeType?.() || '-'} source=${sanitizeURL(sourceWebContents?.getURL?.() || '')}`)
      return
    }
    const sourceURL = sourceWebContents?.getURL?.() || ''
    console.log(`[chatgpt-plan-download] started file=${filename} source=${sanitizeURL(sourceURL)}`)

    const total = item.getTotalBytes()
    if (total > maxBytes) {
      item.cancel()
      publishError('Plano Wharnex excede o limite de 2 MiB.', filename, sourceCacheKey)
      return
    }

    const dir = path.join(tempPath(), 'wharness-plans')
    const savePath = path.join(dir, filename)
    try {
      mkdirSync(dir, { recursive: true, mode: 0o700 })
      item.setSavePath(savePath)
    } catch (error) {
      item.cancel()
      publishError(`Não foi possível preparar o download: ${error instanceof Error ? error.message : String(error)}`, filename, sourceCacheKey)
      return
    }

    item.on('updated', () => {
      if (item.getReceivedBytes() > maxBytes) {
        item.cancel()
        publishError('Plano Wharnex excede o limite de 2 MiB.', filename, sourceCacheKey)
      }
    })
    item.once('done', async (_doneEvent, state) => {
      if (state !== 'completed') {
        if (state !== 'cancelled') publishError(`Download do plano terminou em estado ${state}.`, filename, sourceCacheKey)
        return
      }
      try {
        const bytes = await readFile(savePath)
        if (bytes.byteLength > maxBytes) throw new Error('Plano Wharnex excede o limite de 2 MiB.')
        const validated = validatePlanFile(filename, bytes.toString('utf8'))
        publishPlan({ cacheKey: sourceCacheKey, filename, requestId: validated.requestId, text: validated.text, bytes: bytes.byteLength })
        console.log(`[chatgpt-plan-download] imported file=${filename} bytes=${bytes.byteLength}`)
      } catch (error) {
        publishError(error instanceof Error ? error.message : String(error), filename, sourceCacheKey)
      } finally {
        try { await rm(savePath, { force: true }) } catch { /* best effort temp cleanup */ }
      }
    })
  }
}
