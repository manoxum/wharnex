import path from 'node:path'

const composerUploadInputExpression = `(() => {
  const composer = document.querySelector('#prompt-textarea, div[contenteditable="true"][data-testid*="composer"], div[contenteditable="true"][role="textbox"], textarea[placeholder]');
  const root = composer?.closest('[data-composer-surface]') || composer?.closest('form');
  if (!root) return null;
  const selectors = ['input#upload-files', 'input[type="file"][data-testid*="upload" i]', 'input[type="file"][multiple]'];
  for (const selector of selectors) { const input = root.querySelector(selector); if (input) return input; }
  return null;
})()`

function uploadRequestStage(details) {
  try {
    const url = new URL(String(details?.url || ''))
    const method = String(details?.method || 'POST').toUpperCase()
    if (url.protocol !== 'https:' || !(url.hostname === 'chatgpt.com' || url.hostname.endsWith('.chatgpt.com'))) return ''
    if (!['POST', 'PUT', 'PATCH'].includes(method)) return ''

    // ChatGPT has changed the concrete file-upload route over time. Observe a
    // deliberately narrow family rather than one literal endpoint so a route
    // revision cannot be mistaken for "the browser never started upload".
    // Keep the match under /backend-api and require upload semantics so normal
    // file metadata requests do not satisfy the delivery confirmation gate.
    const pathname = url.pathname.toLowerCase()
    if (method === 'POST' && pathname === '/backend-api/files') return 'metadata'
    if (method === 'POST' && /^\/backend-api\/files\/[^/]+\/uploaded\/?$/.test(pathname)) return 'complete'
    if (pathname === '/backend-api/files/process_upload_stream'
      || /^\/backend-api\/files\/[^/]*(?:upload|process_upload)[^/]*(?:\/|$)/.test(pathname)
      || /^\/backend-api\/uploads?(?:\/|$)/.test(pathname)) return 'complete'
    return ''
  } catch {
    return ''
  }
}

function isUploadRequest(details) { return uploadRequestStage(details) !== '' }

function ambiguousUploadFailure(message) {
  const error = new Error(message)
  error.retryFileSelection = false
  return error
}

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
    // id, explicit upload test id, composer-scoped multi-file input, then the
    // historical bounded multi-file fallback.
    const selectors = [
      'input#upload-files',
      'input[type="file"][data-testid*="upload" i]',
      'form input[type="file"][multiple]',
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

export class ChatGPTUploadCoordinator {
  constructor() {
    this.pendingByWebContents = new Map()
    this.pendingByRequest = new Map()
  }

  expect(webContentsId, { startTimeoutMs = 8_000, completionTimeoutMs = 90_000 } = {}) {
    if (!Number.isInteger(webContentsId) || webContentsId < 1) throw new Error('Invalid ChatGPT webContents id')
    const previous = this.pendingByWebContents.get(webContentsId)
    if (previous) previous.finish(new Error('ChatGPT upload observation was superseded'))

    return new Promise((resolve, reject) => {
      const state = {
        webContentsId,
        requestId: '',
        requestIds: new Set(),
        timer: undefined,
        finish: (error, result = { observed: true }) => {
          if (!this.pendingByWebContents.has(webContentsId)) return
          clearTimeout(state.timer)
          this.pendingByWebContents.delete(webContentsId)
          for (const requestId of state.requestIds) this.pendingByRequest.delete(requestId)
          if (error) reject(error)
          else resolve(result)
        },
      }
      state.timer = setTimeout(() => {
        state.finish(new Error('ChatGPT did not start the file upload before timeout'))
      }, startTimeoutMs)
      this.pendingByWebContents.set(webContentsId, state)
      state.completionTimeoutMs = completionTimeoutMs
    })
  }

  cancel(webContentsId, reason = 'ChatGPT upload observation cancelled') {
    const state = this.pendingByWebContents.get(webContentsId)
    if (!state) return false
    state.finish(new Error(reason))
    return true
  }

  stateFor(details) {
    const requestState = this.pendingByRequest.get(String(details?.id ?? ''))
    if (requestState) return requestState
    const direct = this.pendingByWebContents.get(details?.webContentsId)
    if (direct) return direct
    if (details?.webContentsId == null && this.pendingByWebContents.size === 1) return this.pendingByWebContents.values().next().value
    return undefined
  }

  onBeforeRequest(details) {
    const stage = uploadRequestStage(details)
    if (!stage) return false
    const state = this.stateFor(details)
    if (!state) return false
    clearTimeout(state.timer)
    state.requestId = String(details.id)
    state.requestIds.add(state.requestId)
    this.pendingByRequest.set(state.requestId, state)
    state.timer = setTimeout(() => state.finish(ambiguousUploadFailure('ChatGPT file upload did not complete before timeout')), state.completionTimeoutMs)
    return true
  }

  onCompleted(details) {
    const stage = uploadRequestStage(details)
    if (!stage) return false
    const state = this.stateFor(details)
    if (!state) return false
    if (details.statusCode < 200 || details.statusCode >= 300) {
      state.finish(new Error(`ChatGPT file upload HTTP ${details.statusCode}`))
    } else if (stage === 'complete') {
      state.finish()
    }
    return true
  }

  onErrorOccurred(details) {
    if (!isUploadRequest(details)) return false
    const state = this.stateFor(details)
    if (!state) return false
    state.finish(ambiguousUploadFailure(`ChatGPT file upload failed: ${details.error || 'network error'}`))
    return true
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
      if (lastError.retryFileSelection === false) {
        throw new Error(`ChatGPT upload state is uncertain after the provider upload started; refusing to select the same file again: ${lastError.message}`)
      }
      if (attempt === attempts) break
      onRetry({ attempt, nextAttempt: attempt + 1, error: lastError })
      await wait(Math.min(8_000, 500 * (2 ** (attempt - 1))))
    }
  }
  throw new Error(`ChatGPT upload failed after ${attempts} attempts: ${lastError?.message || 'unknown error'}`)
}
