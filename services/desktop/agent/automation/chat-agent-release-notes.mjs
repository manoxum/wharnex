import { mkdirSync } from 'node:fs'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { pollWorkerExpectedDownload } from './chat-agent-download-poll.mjs'

export const RELEASE_NOTES_TIMEOUT_MS = 4 * 60 * 1000
export const MAX_RELEASE_NOTES_REQUEST_BYTES = 1 * 1024 * 1024
export const MAX_RELEASE_NOTES_RESULT_BYTES = 2 * 1024 * 1024
const POLL_MS = 1_000
const TASK_ID = /^cat_[a-f0-9]{20}$/

export function releaseNotesResultFilename(taskID) {
  const id = String(taskID || '').trim()
  if (!TASK_ID.test(id)) throw new Error('invalid release-notes task id')
  return `whx_release_notes_res_${id}.zip`
}

export function validateReleaseNotesWorkerPayload(taskID, payload) {
  if (payload?.protocol !== 'wharness.release-notes-input/v1' || payload?.task !== 'generate_release_notes') {
    throw new Error('invalid release-notes worker protocol payload')
  }
  if (String(payload.task_id || '').trim() !== String(taskID || '').trim()) throw new Error('release-notes payload names a foreign task')
  const filename = String(payload.result_filename || '')
  if (filename !== releaseNotesResultFilename(taskID)) throw new Error('release-notes payload names a foreign result artifact')
  const requestFilename = String(payload.request_filename || '')
  if (requestFilename !== `whx_release_notes_req_${String(taskID || '').trim()}.zip`) throw new Error('release-notes payload names a foreign request archive')
  if (!String(payload.branch || '').trim()) throw new Error('release-notes payload has no branch')
  const bootstrap = String(payload.bootstrap || '').trim()
  if (!bootstrap) throw new Error('release-notes payload has no composer bootstrap')
  let archive
  try { archive = Buffer.from(String(payload.archive_base64 || ''), 'base64') } catch { archive = undefined }
  if (!archive?.byteLength || archive.byteLength > MAX_RELEASE_NOTES_REQUEST_BYTES) throw new Error('release-notes request archive is invalid')
  return { filename, requestFilename, bootstrap, archive }
}

function normalizedDownloadName(filename) {
  return String(filename || '').replace(/ \([1-9][0-9]{0,3}\)(?=\.[^.]+$)/, '')
}

export function registerReleaseNotesBundleDownload(item, sourceFilename, expectedDownloads, tempRoot) {
  const rawFilename = path.basename(String(sourceFilename || ''))
  const filename = normalizedDownloadName(rawFilename)
  const expected = expectedDownloads.get(filename)
  const looksInternal = /^whx_release_notes_res_cat_[a-f0-9]{20}\.zip$/.test(filename)
  if (!expected && !looksInternal) return false
  if (!expected || Date.now() - expected.armedAt > RELEASE_NOTES_TIMEOUT_MS + 60_000) {
    item.cancel(); return true
  }
  expected.downloadStarted = true
  if (Number(item.getTotalBytes?.() || 0) > MAX_RELEASE_NOTES_RESULT_BYTES) {
    item.cancel(); expected.reject(new Error('Release-notes bundle exceeds the 2 MiB result limit')); return true
  }
  const dir = path.join(tempRoot, 'wharnex-release-notes', expected.taskId)
  const savePath = path.join(dir, filename)
  try { mkdirSync(dir, { recursive: true, mode: 0o700 }); item.setSavePath(savePath) }
  catch (error) { item.cancel(); expected.reject(error instanceof Error ? error : new Error(String(error))); return true }
  item.on('updated', () => {
    if (item.getReceivedBytes() > MAX_RELEASE_NOTES_RESULT_BYTES) {
      item.cancel(); expected.reject(new Error('Release-notes bundle exceeds the 2 MiB result limit'))
    }
  })
  item.once('done', async (_event, state) => {
    if (state !== 'completed') {
      if (state !== 'cancelled') expected.reject(new Error(`Release-notes bundle download ended in state ${state}`))
      return
    }
    try {
      const bytes = await readFile(savePath)
      if (bytes.byteLength > MAX_RELEASE_NOTES_RESULT_BYTES) throw new Error('Release-notes bundle exceeds the 2 MiB result limit')
      expected.resolve(bytes)
    } catch (error) { expected.reject(error instanceof Error ? error : new Error(String(error))) }
    finally { await rm(savePath, { force: true }).catch(() => undefined) }
  })
  return true
}

export async function executeReleaseNotesBundleTask(task, entry, key, payload, runtime) {
  let input
  try { input = validateReleaseNotesWorkerPayload(task.task_id, payload) }
  catch (error) { return { status: 'failed', error: error instanceof Error ? error.message : String(error) } }
  await runtime.pace()
  const initialDelay = runtime.rateLimitDelay()
  if (initialDelay > 0) return { status: 'waiting', delayMs: initialDelay, observation: true, error: 'ChatGPT rate-limit cooldown is active' }
  const dir = path.join(runtime.tempRoot, 'wharnex-release-notes', task.task_id)
  const sourcePath = path.join(dir, input.requestFilename)
  await rm(dir, { recursive: true, force: true }).catch(() => undefined)
  await mkdir(dir, { recursive: true, mode: 0o700 })
  await writeFile(sourcePath, input.archive, { mode: 0o600 })
  let resolveDownload
  let rejectDownload
  const download = new Promise((resolve, reject) => { resolveDownload = resolve; rejectDownload = reject })
  download.catch(() => undefined)
  const expected = { taskId: task.task_id, key, filename: input.filename, armedAt: Date.now(), resolve: resolveDownload, reject: rejectDownload }
  runtime.expectedDownloads.set(input.filename, expected); runtime.reconcile(key, entry)
  if (Number(task.attempt || 0) > 1) {
    const { wc } = runtime.requireEntry(key, entry); await runtime.pace(); wc.reload(); await runtime.waitSurfaceReady(key, entry)
  }
  let conversationUrl = ''
  try {
    const target = await runtime.targetComposer(key, entry)
    target.reasoningEffort = String(payload.reasoning_effort || 'instant')
    if (!(await runtime.executeDOM(key, target.entry, 'release-notes-fill', runtime.fillScript(input.bootstrap)))) throw new Error('ChatGPT release-notes composer could not be populated')
    await runtime.pasteFile(target.entry, sourcePath)
    await runtime.wait(runtime.settleDelay(input.archive.byteLength))
    await runtime.executeDOM(key, target.entry, 'release-notes-refill', runtime.fillScript(input.bootstrap))
    const assistantBaseline = await runtime.assistantTurnCount(target.wc)
    await runtime.submit(key, target)
    conversationUrl = await runtime.waitConversation(key, target.entry, target.conversationUrl)
    if (!conversationUrl) throw new Error('ChatGPT release-notes submission has no stable conversation id')
    const deadline = Date.now() + RELEASE_NOTES_TIMEOUT_MS
    expected.assistantBaseline = assistantBaseline
    while (Date.now() < deadline) {
      const outcome = await Promise.race([download.then((value) => ({ done: true, value }), (error) => ({ done: true, error })), runtime.wait(POLL_MS).then(() => ({ done: false }))])
      if (outcome.done) {
        if (outcome.error) throw outcome.error
        return { status: 'done', payload: { protocol: 'harness.release-notes/v1', task_id: task.task_id, filename: input.filename, bundle_base64: outcome.value.toString('base64') } }
      }
      const health = await runtime.executeDOM(key, target.entry, 'release-notes-health', runtime.humanActionScript())
      if (runtime.noteRateLimit(key, health)) return { status: 'waiting', delayMs: runtime.rateLimitDelay(), observation: true, error: 'ChatGPT rate-limit gate is active' }
      if (health?.required === true) {
        const kind = String(health.kind || 'verification'); runtime.setHumanAction(key, kind)
        return { status: 'attention', providerWide: true, error: runtime.humanActionMessage(kind) }
      }
      await pollWorkerExpectedDownload(expected,
        (script) => runtime.executeDOM(key, target.entry, 'release-notes-download', script), runtime.expectedDownloadScript)
    }
    throw new Error(`ChatGPT did not provide ${input.filename} before the release-notes timeout`)
  } finally {
    if (runtime.expectedDownloads.get(input.filename) === expected) { runtime.expectedDownloads.delete(input.filename); runtime.reconcile(key, entry) }
    await rm(dir, { recursive: true, force: true }).catch(() => undefined)
    if (conversationUrl) runtime.cleanup(task, key, conversationUrl)
  }
}
