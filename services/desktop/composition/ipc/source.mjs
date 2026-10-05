import { readFile } from 'node:fs/promises'
import { compositionSection, readDesktopCompositionSource } from '../entry/source.mjs'

const registrations = [
  ['window', 'registerWindowIPC', 'registerWindowDomainIPC'],
  ['chatgpt', 'registerChatGPTSurfaceIPC', 'registerChatGPTDomainIPC'],
  ['agent', 'registerAgentIPC', 'registerAgentDomainIPC'],
  ['browser', 'registerBrowserDataIPC', 'registerBrowserDomainIPC'],
  ['attachments', 'registerChatAttachmentIPC', 'registerAttachmentsDomainIPC'],
  ['clipboard', 'registerClipboardIPC', 'registerClipboardDomainIPC'],
]

// Source-level regression tests can inspect the real domain registrars in the
// same order as the Electron composition entry point.
export async function readDesktopIPCSource() {
  const main = await readDesktopCompositionSource()
  const dependencyIndex = await readFile(new URL('../entry/dependencies/index.mjs', import.meta.url), 'utf8')
  const dependencyDomains = ['platform', 'agent', 'chatgpt', 'desktop', 'transport']
  if (!main.includes("from '../dependencies/index.mjs'")
      || dependencyDomains.some((domain) => !dependencyIndex.includes(`from './${domain}.mjs'`))) {
    throw new Error('Desktop dependency domain composition is missing')
  }
  const dependencySource = (await Promise.all(dependencyDomains.map((domain) =>
    readFile(new URL(`../entry/dependencies/${domain}.mjs`, import.meta.url), 'utf8'))))
    .join('\n').replaceAll("from '../../../", "from './")
  const index = await readFile(new URL('./index.mjs', import.meta.url), 'utf8')
  const register = await readFile(new URL('./register.mjs', import.meta.url), 'utf8')
  const runtime = await readFile(new URL('./runtime.mjs', import.meta.url), 'utf8')
  const entry = await readFile(new URL('../entry/runtime.mjs', import.meta.url), 'utf8')
  const runtimeStart = runtime.indexOf('  function registerIPC() {')
  const runtimeEnd = runtime.indexOf('\n  }\n\n  return registerIPC', runtimeStart)
  const { start: compositionStart, end: compositionEnd } = compositionSection(main, 'entrypoint')
  if (Math.min(runtimeStart, runtimeEnd, compositionStart, compositionEnd) < 0
      || !index.includes("from './runtime.mjs'")
      || !index.includes("from './register.mjs'")
      || !main.includes("from './composition/entry/index.mjs'")
      || !entry.includes('const monitor = createBrowserMonitorPresentation({ ...deps, normalizeBounds })')
      || !entry.includes('createDesktopIPCRegistrar({ ...deps, ...browser, ...monitor, ...window })')) {
    throw new Error('Desktop IPC composition is missing from the Desktop composition')
  }
  const body = runtime.slice(runtimeStart, runtimeEnd + '\n  }'.length).replace(/^  /gm, '')
  const source = `${main.slice(0, compositionStart)}${body}\n${main.slice(compositionEnd)}`
  const end = compositionStart + body.lastIndexOf('\n}')
  const bodies = await Promise.all(registrations.map(async ([domain, firstCall, exported]) => {
    const module = await readFile(new URL(`./${domain}.mjs`, import.meta.url), 'utf8')
    const first = module.indexOf(`  ${firstCall}({`)
    const last = module.lastIndexOf('\n}')
    if (first < 0 || last <= first || !register.includes(exported)) {
      throw new Error(`Desktop ${domain} IPC registration is missing`)
    }
    return module.slice(first, last)
  }))
  return `${dependencySource}\n${source.slice(0, end)}\n${bodies.join('\n')}${source.slice(end)}`
}
