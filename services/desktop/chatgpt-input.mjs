export function dispatchChatGPTComposerClick(webContents, point) {
  if (!webContents || typeof webContents.sendInputEvent !== 'function') throw new Error('ChatGPT web contents are unavailable')
  const x = Math.max(0, Math.floor(Number(point?.x) || 0))
  const y = Math.max(0, Math.floor(Number(point?.y) || 0))
  webContents.sendInputEvent({ type: 'mouseDown', x, y, button: 'left', clickCount: 1 })
  webContents.sendInputEvent({ type: 'mouseUp', x, y, button: 'left', clickCount: 1 })
  return { x, y }
}

// Account menus are hover-driven: a Radix submenu keeps its own open state
// keyed on pointer movement, so the press has to be preceded by a move to the
// same point. This stays a renderer-level event and never moves the OS pointer.
export function dispatchChatGPTPointerClick(webContents, point) {
  if (!webContents || typeof webContents.sendInputEvent !== 'function') throw new Error('ChatGPT web contents are unavailable')
  const x = Math.max(0, Math.floor(Number(point?.x) || 0))
  const y = Math.max(0, Math.floor(Number(point?.y) || 0))
  webContents.sendInputEvent({ type: 'mouseMove', x, y })
  webContents.sendInputEvent({ type: 'mouseDown', x, y, button: 'left', clickCount: 1 })
  webContents.sendInputEvent({ type: 'mouseUp', x, y, button: 'left', clickCount: 1 })
  return { x, y }
}

// ChatGPT's account menus are Radix `div[role="menuitem"]` nodes whose select
// handlers ignore a synthetic HTMLElement.click(). Account automation therefore
// locates the control in the page and commits it with a trusted native event,
// exactly as the composer transport already does.
export function dispatchChatGPTAccountKey(webContents, keyCode) {
  if (!webContents || typeof webContents.sendInputEvent !== 'function') throw new Error('ChatGPT web contents are unavailable')
  const key = String(keyCode || '')
  if (!/^[A-Za-z]+$/.test(key)) throw new Error(`Unsupported ChatGPT account key ${key}`)
  webContents.sendInputEvent({ type: 'keyDown', keyCode: key })
  webContents.sendInputEvent({ type: 'keyUp', keyCode: key })
  return { method: `native-${key.toLowerCase()}` }
}

export function dispatchChatGPTSubmit(webContents) {
  if (!webContents || typeof webContents.sendInputEvent !== 'function') {
    throw new Error('ChatGPT web contents are unavailable')
  }

  // Electron accepts Accelerator key names, which are case-sensitive. Using
  // Enter avoids coupling submission to ChatGPT's responsive button position.
  webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Enter' })
  webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Enter' })
  return { method: 'native-enter' }
}

function isConversationSubmission(details) {
  try {
    const url = new URL(String(details?.url || ''))
    return details?.method === 'POST'
      && url.protocol === 'https:'
      && (url.hostname === 'chatgpt.com' || url.hostname.endsWith('.chatgpt.com'))
      && (
        url.pathname === '/backend-api/conversation'
        || url.pathname === '/backend-api/f/conversation'
        || url.pathname === '/backend-api/f/conversation/prepare'
      )
  } catch {
    return false
  }
}

export class ChatGPTSubmitCoordinator {
  constructor() {
    this.pending = new Map()
  }

  expect(webContentsId, { startTimeoutMs = 4_000 } = {}) {
    if (!Number.isInteger(webContentsId) || webContentsId < 1) throw new Error('Invalid ChatGPT webContents id')
    const previous = this.pending.get(webContentsId)
    if (previous) previous.finish(new Error('ChatGPT submit observation was superseded'))

    return new Promise((resolve, reject) => {
      const state = {
        timer: undefined,
        finish: (error, requestId = '') => {
          if (!this.pending.has(webContentsId)) return
          clearTimeout(state.timer)
          this.pending.delete(webContentsId)
          if (error) reject(error)
          else resolve({ accepted: true, requestId: String(requestId) })
        },
      }
      state.timer = setTimeout(() => state.finish(new Error('ChatGPT did not accept the submit command before timeout')), startTimeoutMs)
      this.pending.set(webContentsId, state)
    })
  }

  onBeforeRequest(details) {
    if (!isConversationSubmission(details)) return false
    const state = this.pending.get(details?.webContentsId)
      || (details?.webContentsId == null && this.pending.size === 1 ? this.pending.values().next().value : undefined)
    if (!state) return false
    state.finish(undefined, details.id)
    return true
  }
}

export async function submitWithoutReplay({
  beforeSubmit = async () => {},
  beginObservation,
  submit,
}) {
  await beforeSubmit()
  const observed = beginObservation()
  submit()
  try {
    return await observed
  } catch (error) {
    const observationError = error instanceof Error ? error.message : String(error)
    return { accepted: false, requestId: '', observationError }
  }
}

export async function submitWithRetry({
  beforeAttempt = async () => {},
  beginSubmission,
  submit,
  attempts = 5,
  wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
  onRetry = () => {},
}) {
  let lastError
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    await beforeAttempt(attempt)
    const accepted = beginSubmission()
    // Attach rejection handling before dispatch: if an asynchronous DOM
    // dispatch fails, its still-pending observation must not become an
    // unhandled rejection when the next attempt supersedes it.
    void accepted.catch(() => undefined)
    try {
      await submit()
      return await accepted
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error))
      if (attempt === attempts) break
      onRetry({ attempt, nextAttempt: attempt + 1, error: lastError })
      await wait(Math.min(4_000, 300 * (2 ** (attempt - 1))))
    }
  }
  throw new Error(`ChatGPT submit was not accepted after ${attempts} attempts: ${lastError?.message || 'unknown error'}`)
}
