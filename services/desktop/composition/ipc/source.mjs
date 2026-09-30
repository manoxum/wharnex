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
  const index = await readFile(new URL('./index.mjs', import.meta.url), 'utf8')
  const start = main.indexOf('function registerIPC() {')
  const end = main.indexOf('\n}\n\napp.whenReady()', start)
  if (start < 0 || end <= start || !main.includes("from './composition/ipc/index.mjs'")) {
    throw new Error('Desktop IPC composition is missing from main.mjs')
  }
  const bodies = await Promise.all(registrations.map(async ([domain, firstCall, exported]) => {
    const module = await readFile(new URL(`./${domain}.mjs`, import.meta.url), 'utf8')
    const first = module.indexOf(`  ${firstCall}({`)
    const last = module.lastIndexOf('\n}')
    if (first < 0 || last <= first || !index.includes(exported)) {
      throw new Error(`Desktop ${domain} IPC registration is missing`)
    }
    return module.slice(first, last)
  }))
  return `${main.slice(0, end)}\n${bodies.join('\n')}${main.slice(end)}`
}
