import { readFile } from 'node:fs/promises'
import { readSupervisorSurfaceSource } from '../supervision/surface-source.mjs'

// Source-level regressions inspect the cooldown, recovery and parking path as
// one sequence. Read its actual domain module and verify the session facade.
export async function readConversationReadSource() {
  let main = await readSupervisorSurfaceSource()
  const module = await readFile(new URL('../../chatgpt/session/health/conversation-reads/health.mjs', import.meta.url), 'utf8')
  const session = await readFile(new URL('../../chatgpt/session/index.mjs', import.meta.url), 'utf8')
  const health = await readFile(new URL('../../chatgpt/session/health/index.mjs', import.meta.url), 'utf8')
  const reads = await readFile(new URL('../../chatgpt/session/health/conversation-reads/index.mjs', import.meta.url), 'utf8')
  const bodyStart = module.indexOf('  const CHATGPT_CONVERSATION_LOAD_BACKOFF_MS =')
  const parkStart = module.indexOf('  function parkChatGPTWorkerAfterLoadFailure(', bodyStart)
  const bodyEnd = module.lastIndexOf('\n  return {')
  const compositionStart = main.indexOf('const {\n  chatGPTConversationReadCooldownMs, chatGPTConversationReadGateMs,')
  const compositionEnd = main.indexOf('function noteOrchestrationTaskPin(', compositionStart)
  if (Math.min(bodyStart, parkStart, bodyEnd, compositionStart, compositionEnd) < 0
      || !main.includes("from './chatgpt/session/index.mjs'")
      || !session.includes("from './health/index.mjs'")
      || !health.includes("from './conversation-reads/index.mjs'")
      || !reads.includes("from './health.mjs'")) {
    throw new Error('Conversation-read health composition missing')
  }
  const body = module.slice(bodyStart, parkStart).replace(/^  /gm, '').trim()
  const park = module.slice(parkStart, bodyEnd).replace(/^  /gm, '').trim()
  main = `${main.slice(0, compositionStart)}${body}\n\n${main.slice(compositionEnd)}`
  const parkPosition = main.indexOf('const {\n  chatAgentRateLimitDelayMs, chatAgentRateLimitResumeBlocked,')
  if (parkPosition < 0) throw new Error('Conversation-read parking composition missing')
  return `${main.slice(0, parkPosition)}${park}\n\n${main.slice(parkPosition)}`
}
