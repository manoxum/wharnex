import { readFile } from 'node:fs/promises'
import { readConversationReadSource } from './conversation-read-source.mjs'

// Compose the health implementation for source-level regression tests while
// checking that main reaches it through the session facade.
export async function readHealthSource() {
  const main = await readConversationReadSource()
  const rate = await readFile(new URL('../../chatgpt/session/health/rate-limit.mjs', import.meta.url), 'utf8')
  const http = await readFile(new URL('../../chatgpt/session/health/http-status.mjs', import.meta.url), 'utf8')
  const session = await readFile(new URL('../../chatgpt/session/index.mjs', import.meta.url), 'utf8')
  const health = await readFile(new URL('../../chatgpt/session/health/index.mjs', import.meta.url), 'utf8')
  const start = main.indexOf('const { applyChatGPTRateLimit, noteChatGPTRateLimitGate } = createChatGPTRateLimit({')
  const end = main.indexOf('\nconst {\n  publishPlanDownload, publishPlanDownloadError,', start)
  const rateStart = rate.indexOf('  function applyChatGPTRateLimit(')
  const rateEnd = rate.lastIndexOf('\n  return {')
  const httpStart = http.indexOf('  function chatGPTInterpreterDownloadConversation(')
  const httpEnd = http.lastIndexOf('\n  return {')
  if (Math.min(start, end, rateStart, rateEnd, httpStart, httpEnd) < 0
      || !main.includes("from './chatgpt/session/index.mjs'")
      || !session.includes("from './health/index.mjs'")
      || !health.includes("from './rate-limit.mjs'") || !health.includes("from './http-status.mjs'")) {
    throw new Error('ChatGPT health domain composition missing')
  }
  const bodies = [rate.slice(rateStart, rateEnd), http.slice(httpStart, httpEnd)]
    .map((body) => body.replace(/^  /gm, '').trim())
  return `${main.slice(0, start)}${bodies.join('\n\n')}\n\n${main.slice(end)}`
}
