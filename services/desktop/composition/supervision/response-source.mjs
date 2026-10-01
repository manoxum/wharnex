import { readFile } from 'node:fs/promises'
import { readPromptTransportSource } from '../transport/prompt-source.mjs'

// Source-level supervision tests inspect the passive probe in the same order
// as the Desktop composition, while its implementation lives in its domain.
export async function readResponseSource() {
  const main = await readPromptTransportSource()
  const module = await readFile(new URL('../../agent/supervision/response/probe.mjs', import.meta.url), 'utf8')
  const start = module.indexOf('  async function probeChatAgentResponse(')
  const end = module.lastIndexOf('\n  return { probeChatAgentResponse }')
  const compositionStart = main.indexOf('const { probeChatAgentResponse } = createResponseProbe({')
  const compositionEnd = main.indexOf('\nasync function executeChatAgentWrite(', compositionStart)
  const agent = await readFile(new URL('../../agent/index.mjs', import.meta.url), 'utf8')
  const supervision = await readFile(new URL('../../agent/supervision/index.mjs', import.meta.url), 'utf8')
  if (start < 0 || end <= start || compositionStart < 0 || compositionEnd <= compositionStart
      || !main.includes("from './agent/index.mjs'") || !agent.includes('createResponseProbe')
      || !supervision.includes("from './response/index.mjs'")) {
    throw new Error('Response probe domain composition missing')
  }
  const probe = module.slice(start, end).replace(/^  /gm, '').trim()
  return `${main.slice(0, compositionStart)}${probe}\n${main.slice(compositionEnd)}`
}
