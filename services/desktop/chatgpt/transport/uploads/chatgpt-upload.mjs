import path from 'node:path'
import { composerLookupSource } from '../../dom/chatgpt-composer-lookup.mjs'
export { ChatGPTUploadCoordinator, chatGPTUploadThumbnailScript } from './chatgpt-upload-observation.mjs'

const composerUploadInputExpression = `(() => {
  ${composerLookupSource()}
  const root = composer?.closest('[data-composer-surface]') || composer?.closest('form');
  if (!root) return null;
  const selectors = [
    'input#upload-files',
    'input[type="file"][data-testid*="upload" i]',
    'input[type="file"]:not([accept])',
    'input[type="file"][accept=""]',
    'input[type="file"][multiple]',
  ];
  for (const selector of selectors) { const input = root.querySelector(selector); if (input) return input; }
  return null;
})()`


export function plannerPromptMarkdown(value) {
  const text = String(value || '').trimEnd()
  if (!text) throw new Error('Prepared prompt is empty')
  return {
    name: 'wharness-planner-prompt.md',
    bytes: Buffer.from(`${text}\n`, 'utf8'),
  }
}

export function chatGPTComposerPoint(bounds, currentURL = '') {
  let newChatSurface = false
  try {
    const url = new URL(currentURL)
    newChatSurface = url.protocol === 'https:'
      && (url.hostname === 'chatgpt.com' || url.hostname.endsWith('.chatgpt.com'))
      && url.pathname === '/'
  } catch { /* default to the conversation composer position */ }
  return {
    x: Math.max(80, Math.floor(bounds.width * 0.62)),
    y: Math.max(40, newChatSurface ? Math.floor(bounds.height * 0.47) : bounds.height - 58),
  }
}

export async function waitForChatGPTReady({
  isLoading,
  lastNetworkActivity,
  wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
  now = Date.now,
  stableMs = 1_000,
  timeoutMs = 30_000,
}) {
  const startedAt = now()
  while (now() - startedAt <= timeoutMs) {
    const quietFor = now() - Number(lastNetworkActivity() || 0)
    if (!isLoading() && quietFor >= stableMs) return { ready: true, quietFor }
    await wait(Math.min(100, Math.max(1, stableMs - quietFor)))
  }
  throw new Error('ChatGPT did not become ready for attachments before timeout')
}

// Injects the file through ChatGPT's own dedicated file input via the CDP
// DOM.setFileInputFiles command instead of a clipboard paste. A real input
// selection carries the OS filesystem path directly, so Chromium reads the
// canonical basename from disk; a clipboard `text/uri-list` paste instead
// asks Chromium to synthesize a File object from a bare URI; it may
// materialize an anonymous/renamed file (observed: a random UUID name) and
// can duplicate attachment state across upload retries.
export async function selectChatGPTUploadFile(webContents, filePath) {
  const rawPath = String(filePath || '').trim()
  if (!rawPath || !path.isAbsolute(rawPath) || !path.basename(rawPath)) throw new Error('Invalid ChatGPT upload file path')
  const resolvedPath = path.resolve(rawPath)
  const client = webContents?.debugger
  if (!client || typeof client.sendCommand !== 'function' || typeof client.isAttached !== 'function') throw new Error('ChatGPT upload debugger is unavailable')

  let attachedHere = false
  if (!client.isAttached()) {
    client.attach('1.3')
    attachedHere = true
  }
  try {
    // Prefer the upload input owned by the currently usable composer. IDs are
    // not guaranteed unique across dormant SPA surfaces, so a document-global
    // query can select a stale input that accepts CDP commands but has no live
    // upload listener.
    const scoped = await client.sendCommand('Runtime.evaluate', {
      expression: composerUploadInputExpression,
      returnByValue: false,
    })
    const scopedObjectId = String(scoped?.result?.objectId || '')
    let nodeId = 0
    if (scopedObjectId) {
      const requested = await client.sendCommand('DOM.requestNode', { objectId: scopedObjectId })
      nodeId = Number(requested?.nodeId || 0)
    }

    // A comma-separated selector returns whichever matching element appears
    // first in document order, not whichever selector is listed first. Once
    // ChatGPT added another earlier multi-file control, that made Wharnex set
    // files on the wrong input while reporting a misleading upload timeout.
    // Query the closed preference ladder one selector at a time: exact stable
    // id, explicit upload test id, composer-scoped general-file input, then
    // the historical bounded multi-file fallback. ChatGPT now places two
    // media-only inputs before the general input, so `[multiple]` alone can
    // select an input that rejects ZIP bundles.
    const selectors = [
      'input#upload-files',
      'input[type="file"][data-testid*="upload" i]',
      'form[data-chatgpt-composer] input[type="file"]:not([accept])',
      'form[data-chatgpt-composer] input[type="file"][accept=""]',
      'form input[type="file"]:not([accept])',
      'form input[type="file"][accept=""]',
      'form input[type="file"][multiple]',
      'input[type="file"]:not([accept])',
      'input[type="file"][accept=""]',
      'input[type="file"][multiple]',
    ]
    if (!nodeId) {
      const document = await client.sendCommand('DOM.getDocument', { depth: 0, pierce: false })
      const rootNodeId = Number(document?.root?.nodeId || 0)
      if (!rootNodeId) throw new Error('ChatGPT upload DOM root is unavailable')
      for (const selector of selectors) {
        const target = await client.sendCommand('DOM.querySelector', { nodeId: rootNodeId, selector })
        nodeId = Number(target?.nodeId || 0)
        if (nodeId) break
      }
    }
    if (!nodeId) throw new Error('ChatGPT upload file input was not found')
    await client.sendCommand('DOM.setFileInputFiles', { nodeId, files: [resolvedPath] })
    // DOM.setFileInputFiles performs Chromium's native file-selection
    // lifecycle. Replaying input/change manually makes frameworks that listen
    // to both paths process the same File twice; ChatGPT rejects that second
    // pass with "already uploaded this file" before another network request is
    // visible to the upload coordinator.
    return { selected: true, name: path.basename(resolvedPath) }
  } finally {
    if (attachedHere && client.isAttached()) client.detach()
  }
}

export async function pasteWithUploadRetry({
  beginUpload,
  cancelUpload = () => {},
  paste,
  beforeAttempt = async () => {},
  attempts = 5,
  wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
  onRetry = () => {},
  // May turn a failure into a typed error that ends the retries at once
  // (the account upload limit): repeating the selection cannot succeed.
  classifyFailure = async () => null,
}) {
  let lastError
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      // Composer readiness is part of the attempt. A SPA navigation or a
      // short network interruption can temporarily unmount it before the
      // file input is selected; that must consume a bounded retry instead of
      // escaping the retry loop on the first transient miss.
      await beforeAttempt(attempt)
      const upload = beginUpload()
      // Selection itself can fail before Chromium emits any upload request.
      // Attach a handler immediately and cancel the observation in that path;
      // otherwise each retry leaves an 8-second timer behind, the next attempt
      // supersedes it, and the final orphan reports the misleading
      // "did not start" error as an unhandled rejection.
      void upload.catch(() => undefined)
      try {
        await paste()
      } catch (error) {
        cancelUpload(error)
        await upload.catch(() => undefined)
        throw error
      }
      return await upload
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error))
      // Some failures are deliberate pre-flight deferrals: no upload was
      // attempted and retrying locally would only spin inside a provider-wide
      // cooldown. Preserve the typed error so the scheduler/supervisor can
      // defer the whole operation without escalating it as a transport fault.
      if (lastError.retryUpload === false) throw lastError
      const classified = await classifyFailure(lastError)
      if (classified) throw classified
      if (lastError.retryFileSelection === false) {
        throw Object.assign(new Error(`ChatGPT upload state is uncertain after the provider upload started; refusing to select the same file again: ${lastError.message}`), { retryFileSelection: false, retryTransport: false })
      }
      if (attempt === attempts) break
      onRetry({ attempt, nextAttempt: attempt + 1, error: lastError })
      await wait(Math.min(8_000, 500 * (2 ** (attempt - 1))))
    }
  }
  throw new Error(`ChatGPT upload failed after ${attempts} attempts: ${lastError?.message || 'unknown error'}`)
}
