import { readFile } from 'node:fs/promises'

// Older source-level tests inspect the transport, view and download sequence.
// Recover it from the runtime imported by Desktop before expanding each leaf.
export async function expandDesktopChatWorkflowSource(main) {
  const [runtime, index, facade] = await Promise.all([
    readFile(new URL('./runtime.mjs', import.meta.url), 'utf8'),
    readFile(new URL('./index.mjs', import.meta.url), 'utf8'),
    readFile(new URL('../index.mjs', import.meta.url), 'utf8'),
  ])
  const start = main.indexOf('const {\n  canonicalBundleFilename, authoritativeBundleFilename, armExpectedChatGPTBundle,')
  const end = main.indexOf('\nconst {\n  publishAuthComplete, cancelExternalAuthentication,', start)
  const bodyStart = runtime.indexOf('  const {\n    canonicalBundleFilename, authoritativeBundleFilename,')
  const bodyEnd = runtime.lastIndexOf('\n  return {')
  if (Math.min(start, end, bodyStart, bodyEnd) < 0 || end <= start || bodyEnd <= bodyStart
      || !main.includes('createDesktopChatWorkflowRuntime({')
      || !index.includes("from './runtime.mjs'")
      || !facade.includes("from './workflow/index.mjs'")) {
    throw new Error('Desktop ChatGPT workflow composition missing')
  }
  const body = runtime.slice(bodyStart, bodyEnd).replace(/^  /gm, '').trim()
  return `${main.slice(0, start)}${body}\n${main.slice(end)}`
}
