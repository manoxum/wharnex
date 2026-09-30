import { readFile } from 'node:fs/promises'
import { readOwnershipSource } from '../supervision/ownership-source.mjs'

const schedulers = [
  ['worker', 'chatAgentScheduler', 'createWorkerScheduler', '  // Do not compete with the first local frontend paint.'],
  ['translator', 'chatTranslatorScheduler', 'createTranslatorScheduler', '  chatTranslatorScheduler.start()'],
  ['supervisor', 'chatSupervisorScheduler', 'createSupervisorScheduler', '  chatSupervisorScheduler.start()'],
]

// Composition tests inspect claim ordering and startup sequencing. Rebuild
// their view from the actual domain modules and verify the recursive facade.
export async function readSchedulerStartupSource() {
  let main = await readOwnershipSource()
  const agent = await readFile(new URL('../../agent/index.mjs', import.meta.url), 'utf8')
  const scheduling = await readFile(new URL('../../agent/scheduling/index.mjs', import.meta.url), 'utf8')
  const startup = await readFile(new URL('../../agent/scheduling/startup/index.mjs', import.meta.url), 'utf8')
  if (!main.includes("from './agent/index.mjs'") || !agent.includes("from './scheduling/index.mjs'")
      || !scheduling.includes("from './startup/index.mjs'")) {
    throw new Error('Scheduler startup domain facade missing')
  }
  for (const [file, assignment, factory, next] of schedulers) {
    const module = await readFile(new URL(`../../agent/scheduling/startup/${file}.mjs`, import.meta.url), 'utf8')
    const bodyStart = module.indexOf('  return new ChatAgentSchedulerClient({')
    const bodyEnd = module.lastIndexOf('\n}')
    const start = main.indexOf(`  ${assignment} = ${factory}({`)
    const end = main.indexOf(`\n${next}`, start)
    if (bodyStart < 0 || bodyEnd <= bodyStart || start < 0 || end <= start
        || !startup.includes(`export { ${factory} } from './${file}.mjs'`)) {
      throw new Error(`Scheduler startup composition missing: ${file}`)
    }
    const body = module.slice(bodyStart, bodyEnd).replace('return new ChatAgentSchedulerClient({', `${assignment} = new ChatAgentSchedulerClient({`)
    main = `${main.slice(0, start)}${body}${main.slice(end)}`
  }
  return main
}
