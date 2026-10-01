import { readFile } from 'node:fs/promises'
import { readResponseSource } from './response-source.mjs'

const sections = [
  ['poll-key.mjs', 'async function pollExpectedChatGPTDownloadKey('],
  ['poll-all.mjs', 'async function pollExpectedChatGPTDownloads()'],
]

// Preserve the source-level ordering checked by legacy composition tests.
// The bodies are read from the actual download supervision modules.
export async function readDownloadSupervisionSource() {
  const main = await readResponseSource()
  const bodies = await Promise.all(sections.map(async ([file, signature]) => {
    const module = await readFile(new URL(`../../chatgpt/transport/downloads/supervision/${file}`, import.meta.url), 'utf8')
    const start = module.indexOf(`  ${signature}`)
    const end = module.lastIndexOf('\n  return {')
    if (start < 0 || end <= start) throw new Error(`Download supervision section missing: ${file}`)
    return module.slice(start, end).replace(/^  /gm, '').trim()
  }))
  const start = main.indexOf('const { pollExpectedChatGPTDownloadKey, pollExpectedChatGPTDownloads } = createExpectedBundleSupervision({')
  const end = main.indexOf('\nfunction registerIPC() {', start)
  const transport = await readFile(new URL('../../chatgpt/transport/index.mjs', import.meta.url), 'utf8')
  if (start < 0 || end <= start || !main.includes("from './chatgpt/transport/index.mjs'")
      || !transport.includes("createExpectedBundleSupervision")) {
    throw new Error('Download supervision domain composition missing')
  }
  return `${main.slice(0, start)}${bodies.join('\n\n')}\n${main.slice(end)}`
}
