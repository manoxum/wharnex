import path from 'node:path'
import { mkdirSync } from 'node:fs'
import { readFile, rm } from 'node:fs/promises'
import { buildBundleName, parseBundleName, parseBundleNameWithDuplicateSuffix } from './bundlename.mjs'

const MAX_BYTES = 16 * 1024 * 1024

function canonicalFilename(source) {
  const parsed = parseBundleName(source) || parseBundleNameWithDuplicateSuffix(source)
  if (!parsed || parsed.kind !== 'res') return ''
  return buildBundleName(parsed.kind, parsed.chatId, parsed.requestId, parsed.subrequestId)
}

export function registerOrchestratorExecutionDownload(item, sourceFilename, expectedDownloads, tempRoot) {
  const filename = canonicalFilename(sourceFilename)
  const expected = expectedDownloads.get(filename)
  if (!expected) return false
  if (expected.downloadStarted) { item.cancel(); return true }
  expected.downloadStarted = true
  if (Number(item.getTotalBytes?.() || 0) > MAX_BYTES) {
    item.cancel()
    expected.reject(new Error('Orchestrator Agent bundle exceeds 16 MiB'))
    return true
  }
  const savePath = path.join(tempRoot, 'wharnex-orchestrator-execution', expected.taskId, filename)
  try {
    mkdirSync(path.dirname(savePath), { recursive: true, mode: 0o700 })
    item.setSavePath(savePath)
  } catch (error) {
    item.cancel()
    expected.reject(error)
    return true
  }
  item.on('updated', () => {
    if (item.getReceivedBytes() > MAX_BYTES) {
      item.cancel()
      expected.reject(new Error('Orchestrator Agent bundle exceeds 16 MiB'))
    }
  })
  item.once('done', async (_event, state) => {
    try {
      if (state !== 'completed') throw new Error(`Orchestrator Agent download ended in ${state}`)
      const bytes = await readFile(savePath)
      if (bytes.byteLength > MAX_BYTES) throw new Error('Orchestrator Agent bundle exceeds 16 MiB')
      expected.resolve(bytes)
    } catch (error) {
      expected.reject(error)
    } finally {
      await rm(savePath, { force: true }).catch(() => undefined)
    }
  })
  return true
}
