import { readFile } from 'node:fs/promises'
import { readOwnershipSource } from '../supervision/ownership-source.mjs'

const schedulers = [
  ['worker', 'chatAgentScheduler', 'createWorkerScheduler', 'workerScheduler'],
  ['translator', 'chatTranslatorScheduler', 'createTranslatorScheduler', 'translatorScheduler'],
  ['supervisor', 'chatSupervisorScheduler', 'createSupervisorScheduler', 'supervisorScheduler'],
]

// Source-level composition tests retain their older cross-module view, while
// checking that the entry point really delegates through the startup facade.
export async function readSchedulerStartupSource() {
  const main = await readOwnershipSource()
  const entrypoint = await readFile(new URL('../../main.mjs', import.meta.url), 'utf8')
  const agent = await readFile(new URL('../../agent/index.mjs', import.meta.url), 'utf8')
  const scheduling = await readFile(new URL('../../agent/scheduling/index.mjs', import.meta.url), 'utf8')
  const startup = await readFile(new URL('../../agent/scheduling/startup/index.mjs', import.meta.url), 'utf8')
  const lifecycle = await readFile(new URL('../../lifecycle/index.mjs', import.meta.url), 'utf8')
  const context = await readFile(new URL('../../lifecycle/startup/context.mjs', import.meta.url), 'utf8')
  const runtime = await readFile(new URL('../../lifecycle/startup/runtime.mjs', import.meta.url), 'utf8')
  const handlers = await readFile(new URL('../../lifecycle/startup/handlers.mjs', import.meta.url), 'utf8')
  const startupWiring = await readFile(new URL('../startup/runtime.mjs', import.meta.url), 'utf8')
  const startupFacade = await readFile(new URL('../startup/index.mjs', import.meta.url), 'utf8')
  const entry = await readFile(new URL('../entry/runtime.mjs', import.meta.url), 'utf8')
  const timing = await readFile(new URL('../../chatgpt/config/runtime-timing.mjs', import.meta.url), 'utf8')
  const config = await readFile(new URL('../../chatgpt/config/index.mjs', import.meta.url), 'utf8')
  if (!main.includes("from './agent/index.mjs'") || !agent.includes("from './scheduling/index.mjs'")
      || !scheduling.includes("from './startup/index.mjs'")
      || !entrypoint.includes('createDesktopEntrypointRuntime({')
      || !main.includes('desktopEntrypoint.start()')
      || !main.includes('desktopEntrypoint.registerLifecycle()')
      || !entry.includes('createDesktopStartupRuntime(')
      || !entry.includes('startDesktopRuntime(startup.startupContext())')
      || !startupWiring.includes('return createDesktopStartupContext({')
      || !startupWiring.includes('registerDesktopLifecycleHandlers({')
      || !startupFacade.includes("from './runtime.mjs'")
      || !lifecycle.includes("from './startup/index.mjs'")
      || !main.includes("from './chatgpt/config/index.mjs'")
      || !config.includes("from './runtime-timing.mjs'")) {
    throw new Error('Scheduler startup domain facade missing')
  }
  const bodies = []
  for (const [file, assignment, factory, scheduler] of schedulers) {
    const module = await readFile(new URL(`../../agent/scheduling/startup/${file}.mjs`, import.meta.url), 'utf8')
    const bodyStart = module.indexOf('  return new ChatAgentSchedulerClient({')
    const bodyEnd = module.lastIndexOf('\n}')
    if (bodyStart < 0 || bodyEnd <= bodyStart
        || !startup.includes(`export { ${factory} } from './${file}.mjs'`)
        || !main.includes(factory)
        || !startupWiring.includes(`${factory}: d.${factory}`)
        || !context.includes(`create: ${factory}`)
        || !runtime.includes(`${scheduler}.start()`)) {
      throw new Error(`Scheduler startup composition missing: ${file}`)
    }
    const body = module.slice(bodyStart, bodyEnd)
      .replace('return new ChatAgentSchedulerClient({', `${assignment} = new ChatAgentSchedulerClient({`)
    bodies.push(`${body}\n${assignment}.start()`)
  }
  if (!handlers.includes("app.on('before-quit'") || !handlers.includes("app.on('window-all-closed'")) {
    throw new Error('Desktop lifecycle composition missing')
  }
  return `${main}\n${entry}\n${startupWiring}\n${context}\n${runtime}\n${timing}\n${bodies.join('\n')}\n${handlers}`
}
