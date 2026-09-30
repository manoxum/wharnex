import { readFile } from 'node:fs/promises'

const sections = [
  ['../../chatgpt/session/health/conversation-reads/health.mjs', '  const CHATGPT_CONVERSATION_LOAD_BACKOFF_MS =', '\n  return { chatGPTConversationReadCooldownMs,'],
  ['./pacing/runtime.mjs', '  function noteOrchestrationTaskPin(', '\n  const resume = createChatGPTRateLimitResume({'],
  ['../../chatgpt/session/health/rate-limit-resume.mjs', '  function chatAgentRateLimitDelayMs()', '\n  return { chatAgentRateLimitDelayMs,'],
  ['../../agent/scheduling/residency/worker-pacing.mjs', '  function chatAgentNavigationGapMs()', '\n  return {\n    ChatGPTRateLimitDeferral,'],
  ['../../chatgpt/transport/uploads/paste-runtime.mjs', '  async function pasteChatGPTFile(', '\n  return { pasteChatGPTFile }'],
]

// Structural tests read the implementation each composed domain actually runs.
export async function expandDesktopChatGPTPacingSource(main) {
  const start = main.indexOf('const chatGPTPacingDependencies = {')
  const end = main.indexOf('\nconst promptDispatchDependencies = {', start)
  const runtime = await readFile(new URL('./pacing/runtime.mjs', import.meta.url), 'utf8')
  const entry = await readFile(new URL('./pacing/index.mjs', import.meta.url), 'utf8')
  if (start < 0 || end <= start || !main.includes('createDesktopChatGPTPacing(chatGPTPacingDependencies)')
      || !runtime.includes('createChatGPTConversationReadHealth({')
      || !runtime.includes('createChatGPTRateLimitResume({')
      || !runtime.includes('createWorkerPacing({')
      || !runtime.includes('createChatGPTFileUpload({')
      || !entry.includes("from './runtime.mjs'")) {
    throw new Error('Desktop ChatGPT pacing composition missing from main.mjs')
  }
  const bodies = await Promise.all(sections.map(async ([file, first, last]) => {
    const source = await readFile(new URL(file, import.meta.url), 'utf8')
    const from = source.indexOf(first)
    const to = source.lastIndexOf(last)
    if (from < 0 || to <= from) throw new Error(`Desktop ChatGPT pacing source missing: ${file}`)
    return source.slice(from, to).replace(/^  /gm, '').trim()
  }))
  return `${main.slice(0, start)}${bodies.join('\n\n')}\n${main.slice(end)}`
}
