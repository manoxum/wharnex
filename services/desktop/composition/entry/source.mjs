import { readFileSync } from 'node:fs'
import { readFile } from 'node:fs/promises'

// Source-level regression tests read the Desktop composition as one text in
// execution order: the entry point's imports, the stage order and each stage,
// the entry point's start-up tail, then the context and state views the stages
// share. Wiring may move between stage files without changing what those
// tests can observe.
const entryFile = '../../main.mjs'
const entryTail = '\nconst desktop = composeDesktop('
const compositionFiles = [
  './stages/index.mjs',
  './stages/foundation.mjs',
  './stages/ownership.mjs',
  './stages/chat-workflow.mjs',
  './stages/browser-views.mjs',
  './stages/agent-scheduling.mjs',
  './stages/transport.mjs',
  './stages/workers.mjs',
  './stages/entrypoint.mjs',
]
const sharedFiles = ['../state/views.mjs', '../context/context.mjs']

function flatten([entry, ...rest]) {
  const tail = entry.indexOf(entryTail)
  if (tail < 0) throw new Error('Desktop entry point no longer creates its composition context')
  const stages = rest.slice(0, compositionFiles.length)
  const shared = rest.slice(compositionFiles.length)
  return [entry.slice(0, tail), ...stages, entry.slice(tail), ...shared].join('\n')
}

const allFiles = [entryFile, ...compositionFiles, ...sharedFiles]

export async function readDesktopCompositionSource() {
  return flatten(await Promise.all(allFiles.map((file) => readFile(new URL(file, import.meta.url), 'utf8'))))
}

// Locates one stage's `compose(ctx, '<stage>', ...)` call: from the start of
// its line to the next composition statement or stage function.
export function compositionSection(source, stage) {
  const call = source.indexOf(`compose(ctx, '${stage}'`)
  if (call < 0) return { start: -1, end: -1 }
  const start = source.lastIndexOf('\n', call) + 1
  const ends = ['\n  compose(ctx, ', '\n  provide(ctx, ', '\nexport function ', '\nimport ', '\nconst ']
    .map((marker) => source.indexOf(marker, start + 1))
    .filter((at) => at > start)
  return { start, end: ends.length ? Math.min(...ends) : source.length }
}

export function readDesktopCompositionSourceSync() {
  return flatten(allFiles.map((file) => readFileSync(new URL(file, import.meta.url), 'utf8')))
}
