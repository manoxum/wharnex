import { readFile } from 'node:fs/promises'

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
  const main = await readFile(new URL('../../main.mjs', import.meta.url), 'utf8')
  const dependencyIndex = await readFile(new URL('../entry/dependencies/index.mjs', import.meta.url), 'utf8')
  const dependencyDomains = ['platform', 'agent', 'chatgpt', 'desktop', 'transport']
  if (!main.includes("from './composition/entry/dependencies/index.mjs'")
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
  const compositionStart = main.indexOf('const desktopEntrypoint = createDesktopEntrypointRuntime({')
  const compositionEnd = main.indexOf('\napp.whenReady()', compositionStart)
  if (Math.min(runtimeStart, runtimeEnd, compositionStart, compositionEnd) < 0
      || !index.includes("from './runtime.mjs'")
      || !index.includes("from './register.mjs'")
      || !main.includes("from './composition/entry/index.mjs'")
      || !entry.includes('const monitor = createBrowserMonitorPresentation({ ...deps, normalizeBounds })')
      || !entry.includes('createDesktopIPCRegistrar({ ...deps, ...browser, ...monitor, ...window })')) {
    throw new Error('Desktop IPC composition is missing from main.mjs')
  }
  const body = runtime.slice(runtimeStart, runtimeEnd + '\n  }'.length).replace(/^  /gm, '')
  const source = `${main.slice(0, compositionStart)}${body}\n${main.slice(compositionEnd)}`
  const start = source.indexOf('function registerIPC() {')
  const end = source.indexOf('\n}\n\napp.whenReady()', start)
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
