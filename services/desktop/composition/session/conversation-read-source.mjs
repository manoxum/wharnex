import { readFile } from 'node:fs/promises'
import { readSupervisorSurfaceSource } from '../supervision/surface-source.mjs'
import { expandDesktopChatGPTPacingSource } from '../transport/pacing-source.mjs'

// Structural tests follow the composed read health, pacing and upload path.
export async function readConversationReadSource() {
  const main = await readSupervisorSurfaceSource()
  const session = await readFile(new URL('../../chatgpt/session/index.mjs', import.meta.url), 'utf8')
  const health = await readFile(new URL('../../chatgpt/session/health/index.mjs', import.meta.url), 'utf8')
  const reads = await readFile(new URL('../../chatgpt/session/health/conversation-reads/index.mjs', import.meta.url), 'utf8')
  if (!main.includes("from './chatgpt/session/index.mjs'")
      || !session.includes("from './health/index.mjs'")
      || !health.includes("from './conversation-reads/index.mjs'")
      || !reads.includes("from './health.mjs'")) {
    throw new Error('Conversation-read health domain composition missing')
  }
  return expandDesktopChatGPTPacingSource(main)
}
