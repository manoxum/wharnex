import { readFile } from 'node:fs/promises'
import { readConversationReadSource } from './conversation-read-source.mjs'
import { expandDesktopChatWorkflowSource } from './workflow/source.mjs'

// Compose the health implementation for source-level regression tests while
// checking that main reaches it through the session facade.
export async function readHealthSource() {
  let main = await expandDesktopChatWorkflowSource(await readConversationReadSource())
  const transportRuntime = await readFile(new URL('./transport-runtime.mjs', import.meta.url), 'utf8')
  const transportStart = transportRuntime.indexOf('  const {\n    canonicalBundleFilename,')
  const transportEnd = transportRuntime.lastIndexOf('\n  return {')
  const transportCompositionStart = main.indexOf('const {\n  canonicalBundleFilename,')
  const transportCompositionEnd = main.indexOf('\nconst {\n  closeInternalChatGPTBrowserForWindow,', transportCompositionStart)
  const facade = await readFile(new URL('./index.mjs', import.meta.url), 'utf8')
  if (Math.min(transportStart, transportEnd, transportCompositionStart, transportCompositionEnd) < 0
      || !main.includes('createDesktopChatTransportRuntime({')
      || !facade.includes("from './transport-runtime.mjs'")) {
    throw new Error('Desktop ChatGPT transport composition missing')
  }
  main = `${main.slice(0, transportCompositionStart)}${transportRuntime.slice(transportStart, transportEnd).replace(/^  /gm, '').replace(/\bd\./g, '').trim()}\n${main.slice(transportCompositionEnd)}`
  const runtime = await readFile(new URL('./view-health-runtime.mjs', import.meta.url), 'utf8')
  const runtimeStart = runtime.indexOf('  const {\n    closeInternalChatGPTBrowserForWindow,')
  const runtimeEnd = runtime.lastIndexOf('\n  return {')
  const compositionStart = main.indexOf('const {\n  closeInternalChatGPTBrowserForWindow,')
  const compositionEnd = main.indexOf('\nconst {\n  publishPlanDownload, publishPlanDownloadError,', compositionStart)
  if (Math.min(runtimeStart, runtimeEnd, compositionStart, compositionEnd) < 0
      || !main.includes('createDesktopChatViewHealthRuntime({')
      || !facade.includes("from './view-health-runtime.mjs'")) {
    throw new Error('Desktop view/health composition missing')
  }
  main = `${main.slice(0, compositionStart)}${runtime.slice(runtimeStart, runtimeEnd).replace(/^  /gm, '').replace(/\bd\./g, '').trim()}\n${main.slice(compositionEnd)}`
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
  main = `${main.slice(0, start)}${bodies.join('\n\n')}\n\n${main.slice(end)}`
  const downloadRuntime = await readFile(new URL('../downloads/runtime.mjs', import.meta.url), 'utf8')
  const downloadFacade = await readFile(new URL('../downloads/index.mjs', import.meta.url), 'utf8')
  const downloadStart = downloadRuntime.indexOf('  const {\n    publishPlanDownload,')
  const downloadEnd = downloadRuntime.lastIndexOf('\n  return {')
  const downloadCompositionStart = main.indexOf('const {\n  publishPlanDownload, publishPlanDownloadError,')
  const downloadCompositionEnd = main.indexOf("compose(ctx, 'auth-views'", downloadCompositionStart)
  if (Math.min(downloadStart, downloadEnd, downloadCompositionStart, downloadCompositionEnd) < 0
      || !main.includes('createDesktopDownloadRuntime({')
      || !downloadFacade.includes("from './runtime.mjs'")) {
    throw new Error('Desktop download composition missing')
  }
  return `${main.slice(0, downloadCompositionStart)}${downloadRuntime.slice(downloadStart, downloadEnd).replace(/^  /gm, '').replace(/\bd\./g, '').trim()}\n${main.slice(downloadCompositionEnd)}`
}
