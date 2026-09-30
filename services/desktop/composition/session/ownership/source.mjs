import { readFile } from 'node:fs/promises'

// Preserve cross-domain regression assertions against the real ownership
// composition instead of keeping a second implementation in main.mjs.
export async function expandDesktopOwnershipSource(main) {
  const [runtime, index, facade] = await Promise.all([
    readFile(new URL('./runtime.mjs', import.meta.url), 'utf8'),
    readFile(new URL('./index.mjs', import.meta.url), 'utf8'),
    readFile(new URL('../index.mjs', import.meta.url), 'utf8'),
  ])
  const start = main.indexOf('const {\n  windowStateForWebContents, trustedSender, windowStateForEntry, activeChatGPTEntry,')
  const end = main.indexOf('\nconst {\n  acquireProjectForWindow, suspendNativeSurfacesForWindow,', start)
  const bodyStart = runtime.indexOf('  const {\n    windowStateForWebContents, trustedSender, windowStateForEntry,')
  const bodyEnd = runtime.lastIndexOf('\n  return {')
  if (Math.min(start, end, bodyStart, bodyEnd) < 0 || end <= start || bodyEnd <= bodyStart
      || !main.includes('createDesktopOwnershipRuntime({')
      || !index.includes("from './runtime.mjs'")
      || !facade.includes("from './ownership/index.mjs'")) {
    throw new Error('Desktop ownership composition missing')
  }
  const body = runtime.slice(bodyStart, bodyEnd).replace(/^  /gm, '').trim()
  return `${main.slice(0, start)}${body}\n${main.slice(end)}`
}
