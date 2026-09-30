import { readFile } from 'node:fs/promises'
import { readCommentQueueSource } from '../transport/comment-source.mjs'

const sections = [
  ['../../agent/supervision/activity/poll.mjs', 'async function pollChatGPTVisibleActivity()'],
  ['../../chatgpt/transport/recovery/actions/action.mjs', 'async function performChatGPTRecoveryAction('],
  ['../../chatgpt/transport/recovery/actions/continuation.mjs', 'function escalateChatGPTContinuationFailure('],
]

export async function readActivityRecoverySource() {
  const main = await readCommentQueueSource()
  const bodies = await Promise.all(sections.map(async ([file, signature]) => {
    const module = await readFile(new URL(file, import.meta.url), 'utf8')
    const start = module.indexOf(`  ${signature}`)
    const end = module.lastIndexOf('\n  return {')
    if (start < 0 || end <= start) throw new Error(`Activity/recovery section missing: ${file}`)
    return module.slice(start, end).replace(/^  /gm, '').trim()
  }))
  const start = main.indexOf('const { pollChatGPTVisibleActivity } = createChatGPTActivityPoll({')
  const end = main.indexOf('\nasync function pollExpectedChatGPTDownloadKey(', start)
  if (start < 0 || end <= start || !main.slice(0, main.indexOf('\nconst here')).includes('createChatGPTActivityPoll')
      || !main.slice(0, main.indexOf('\nconst here')).includes('createChatGPTRecoveryActions')) {
    throw new Error('Activity/recovery domain composition missing')
  }
  return `${main.slice(0, start)}${bodies.join('\n\n')}\n${main.slice(end)}`
}
