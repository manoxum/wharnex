import { readFile } from 'node:fs/promises'
import { readDesktopIPCSource } from '../ipc/source.mjs'

const sections = [
  ['slots', 'function retireChatGPTSupervisorSurface('],
  ['visibility', 'function chatGPTSurfaceShouldBeVisible('],
  ['navigation', 'function clearDeferredSupervisorNavigation('],
]

// Read the extracted slot, visibility and navigation logic in composition
// order for source-level tests, with the recursive facade checked first.
export async function readSupervisorSurfaceSource() {
  const main = await readDesktopIPCSource()
  const agent = await readFile(new URL('../../agent/index.mjs', import.meta.url), 'utf8')
  const supervision = await readFile(new URL('../../agent/supervision/index.mjs', import.meta.url), 'utf8')
  const surface = await readFile(new URL('../../agent/supervision/surface/index.mjs', import.meta.url), 'utf8')
  const start = main.indexOf('const {\n  retireChatGPTSupervisorSurface, supervisorKey, supervisorEntry,')
  const end = main.indexOf('function wait(ms)', start)
  if (start < 0 || end <= start || !main.includes("from './agent/index.mjs'")
      || !agent.includes("from './supervision/index.mjs'")
      || !supervision.includes("from './surface/index.mjs'")) {
    throw new Error('Supervisor surface domain composition missing')
  }
  const bodies = await Promise.all(sections.map(async ([file, signature]) => {
    const module = await readFile(new URL(`../../agent/supervision/surface/${file}.mjs`, import.meta.url), 'utf8')
    const bodyStart = module.indexOf(`  ${signature}`)
    const bodyEnd = module.lastIndexOf('\n  return {')
    const factory = `createSupervisorSurface${file[0].toUpperCase()}${file.slice(1)}`
    if (bodyStart < 0 || bodyEnd <= bodyStart || !surface.includes(`export { ${factory} } from './${file}.mjs'`)
        || !main.includes(`${factory}({`)) {
      throw new Error(`Supervisor surface section missing: ${file}`)
    }
    return module.slice(bodyStart, bodyEnd).replace(/^  /gm, '').trim()
  }))
  return `${main.slice(0, start)}${bodies.join('\n\n')}\n\n${main.slice(end)}`
}
