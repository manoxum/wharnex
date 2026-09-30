import { readFile } from 'node:fs/promises'
import { readTaskExecutionSource } from '../workers/task-execution-source.mjs'

// Older composition tests inspect the queue next to response supervision.
// Reconstruct that sequence from the domain module and verify its facade.
export async function readCommentQueueSource() {
  const main = await readTaskExecutionSource()
  const module = await readFile(new URL('../../chatgpt/transport/comments/queue.mjs', import.meta.url), 'utf8')
  const transport = await readFile(new URL('../../chatgpt/transport/index.mjs', import.meta.url), 'utf8')
  const comments = await readFile(new URL('../../chatgpt/transport/comments/index.mjs', import.meta.url), 'utf8')
  const bodyStart = module.indexOf('  function chatGPTCommentFingerprint(')
  const bodyEnd = module.lastIndexOf('\n  return {')
  const compositionStart = main.indexOf('const { queueChatGPTComment, hasPendingChatGPTComments, flushQueuedChatGPTComments } = createChatGPTCommentQueue({')
  const compositionEnd = main.indexOf('\nconst { pollChatGPTVisibleActivity } = createChatGPTActivityPoll({', compositionStart)
  if (bodyStart < 0 || bodyEnd <= bodyStart || compositionStart < 0 || compositionEnd <= compositionStart
      || !main.includes("from './chatgpt/transport/index.mjs'")
      || !transport.includes("from './comments/index.mjs'")
      || !comments.includes("from './queue.mjs'")) {
    throw new Error('ChatGPT comment queue domain composition missing')
  }
  const body = module.slice(bodyStart, bodyEnd).replace(/^  /gm, '').trim()
  return `${main.slice(0, compositionStart)}${body}\n${main.slice(compositionEnd)}`
}
