import { readFile } from 'node:fs/promises'
import { readArtifactWorkersSource } from '../utilities/artifact-worker-source.mjs'

// Legacy composition tests inspect the dispatch order and its preflight
// guards. Read the implementation from the execution domain after extraction.
export async function readTaskExecutionSource() {
  const main = await readArtifactWorkersSource()
  const module = await readFile(new URL('../../agent/scheduling/execution/dispatcher.mjs', import.meta.url), 'utf8')
  const start = module.indexOf('  async function executeChatAgentTask(')
  const end = module.lastIndexOf('\n  return { executeChatAgentTask }')
  const compositionStart = main.indexOf('const { executeChatAgentTask } = createChatAgentExecution({')
  const compositionEnd = main.indexOf('\nconst { queueChatGPTComment, hasPendingChatGPTComments, flushQueuedChatGPTComments } = createChatGPTCommentQueue({', compositionStart)
  const agent = await readFile(new URL('../../agent/index.mjs', import.meta.url), 'utf8')
  const scheduling = await readFile(new URL('../../agent/scheduling/index.mjs', import.meta.url), 'utf8')
  if (start < 0 || end <= start || compositionStart < 0 || compositionEnd <= compositionStart
      || !main.includes("from './agent/index.mjs'") || !agent.includes('createChatAgentExecution')
      || !scheduling.includes("from './execution/index.mjs'")) {
    throw new Error('Task dispatcher domain composition missing')
  }
  const dispatcher = module.slice(start, end).replace(/^  /gm, '').trim()
  return `${main.slice(0, compositionStart)}${dispatcher}\n${main.slice(compositionEnd)}`
}
