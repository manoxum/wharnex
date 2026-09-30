export const CHATGPT_NAVIGATION_TIMEOUT_MS = 25_000

export async function withChatGPTNavigationDeadline(load, stop, timeoutMs = CHATGPT_NAVIGATION_TIMEOUT_MS) {
  let timer
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      try { stop() } catch { /* the timeout must still release the scheduler */ }
      const error = new Error(`ChatGPT navigation did not settle within ${timeoutMs} ms`)
      error.code = 'WHARNEX_CHATGPT_NAVIGATION_TIMEOUT'
      reject(error)
    }, timeoutMs)
  })

  try {
    return await Promise.race([Promise.resolve().then(load), timeout])
  } finally {
    clearTimeout(timer)
  }
}
