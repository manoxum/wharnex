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
