import path from 'node:path'

function isUploadRequest(details) {
  try {
    const url = new URL(String(details?.url || ''))
    return url.protocol === 'https:'
      && (url.hostname === 'chatgpt.com' || url.hostname.endsWith('.chatgpt.com'))
      && url.pathname === '/backend-api/files/process_upload_stream'
  } catch {
    return false
  }
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
    const document = await client.sendCommand('DOM.getDocument', { depth: 0, pierce: false })
    const rootNodeId = Number(document?.root?.nodeId || 0)
    if (!rootNodeId) throw new Error('ChatGPT upload DOM root is unavailable')
    const target = await client.sendCommand('DOM.querySelector', { nodeId: rootNodeId, selector: 'input#upload-files' })
    const nodeId = Number(target?.nodeId || 0)
    if (!nodeId) throw new Error('ChatGPT upload file input was not found')
    await client.sendCommand('DOM.setFileInputFiles', { nodeId, files: [resolvedPath] })
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
        timer: undefined,
        finish: (error, result = { observed: true }) => {
          if (!this.pendingByWebContents.has(webContentsId)) return
          clearTimeout(state.timer)
          this.pendingByWebContents.delete(webContentsId)
          if (state.requestId) this.pendingByRequest.delete(state.requestId)
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

  stateFor(details) {
    const requestState = this.pendingByRequest.get(String(details?.id ?? ''))
    if (requestState) return requestState
    const direct = this.pendingByWebContents.get(details?.webContentsId)
    if (direct) return direct
    if (details?.webContentsId == null && this.pendingByWebContents.size === 1) return this.pendingByWebContents.values().next().value
    return undefined
  }

  onBeforeRequest(details) {
    if (!isUploadRequest(details)) return false
    const state = this.stateFor(details)
    if (!state) return false
    clearTimeout(state.timer)
    state.requestId = String(details.id)
    this.pendingByRequest.set(state.requestId, state)
    state.timer = setTimeout(() => state.finish(new Error('ChatGPT file upload did not complete before timeout')), state.completionTimeoutMs)
    return true
  }

  onCompleted(details) {
    if (!isUploadRequest(details)) return false
    const state = this.stateFor(details)
    if (!state) return false
    if (details.statusCode >= 200 && details.statusCode < 300) state.finish()
    else state.finish(new Error(`ChatGPT file upload HTTP ${details.statusCode}`))
    return true
  }

  onErrorOccurred(details) {
    if (!isUploadRequest(details)) return false
    const state = this.stateFor(details)
    if (!state) return false
    state.finish(new Error(`ChatGPT file upload failed: ${details.error || 'network error'}`))
    return true
  }
}

export async function pasteWithUploadRetry({
  beginUpload,
  paste,
  beforeAttempt = async () => {},
  attempts = 5,
  wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
  onRetry = () => {},
}) {
  let lastError
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    await beforeAttempt(attempt)
    const upload = beginUpload()
    try {
      await paste()
      return await upload
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error))
      if (attempt === attempts) break
      onRetry({ attempt, nextAttempt: attempt + 1, error: lastError })
      await wait(Math.min(8_000, 500 * (2 ** (attempt - 1))))
    }
  }
  throw new Error(`ChatGPT upload failed after ${attempts} attempts: ${lastError?.message || 'unknown error'}`)
}
