export const CHATGPT_DOM_EVALUATION_TIMEOUT_MS = 8_000

// A renderer stalled after a provider connection failure can leave Electron's
// executeJavaScript promise unresolved. Keep every named DOM probe bounded so
// the durable task can retry or surface an actionable error.
export async function evaluateChatGPTDOMWithDeadline(webContents, source, timeoutMs = CHATGPT_DOM_EVALUATION_TIMEOUT_MS) {
  let timer
  try {
    return await Promise.race([
      webContents.executeJavaScript(source, true),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`ChatGPT DOM evaluation exceeded ${timeoutMs} ms`)), timeoutMs)
      }),
    ])
  } finally {
    clearTimeout(timer)
  }
}
