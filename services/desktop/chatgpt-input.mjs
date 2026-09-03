export function dispatchChatGPTSubmit(webContents) {
  if (!webContents || typeof webContents.focus !== 'function' || typeof webContents.sendInputEvent !== 'function') {
    throw new Error('ChatGPT web contents are unavailable')
  }

  // Electron accepts Accelerator key names, which are case-sensitive. Using
  // Enter avoids coupling submission to ChatGPT's responsive button position.
  webContents.focus()
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
  beforeAttempt,
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
    try {
      submit()
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
