import { readFile } from 'node:fs/promises'
import { compositionSection } from '../../entry/source.mjs'

// Preserve cross-domain regression assertions against the real ownership
// composition instead of keeping a second implementation in the entry point.
export async function expandDesktopOwnershipSource(main) {
  const [runtime, index, facade] = await Promise.all([
    readFile(new URL('./runtime.mjs', import.meta.url), 'utf8'),
    readFile(new URL('./index.mjs', import.meta.url), 'utf8'),
    readFile(new URL('../index.mjs', import.meta.url), 'utf8'),
  ])
  const { start, end } = compositionSection(main, 'ownership')
  const bodyStart = runtime.indexOf('  const {\n    windowStateForWebContents, trustedSender, windowStateForEntry,')
  const bodyEnd = runtime.lastIndexOf('\n  return {')
  if (Math.min(start, end, bodyStart, bodyEnd) < 0 || end <= start || bodyEnd <= bodyStart
      || !main.includes("compose(ctx, 'ownership', createDesktopOwnershipRuntime, {")
      || !index.includes("from './runtime.mjs'")
      || !facade.includes("from './ownership/index.mjs'")) {
    throw new Error('Desktop ownership composition missing')
  }
  const body = runtime.slice(bodyStart, bodyEnd).replace(/^  /gm, '').trim()
  return `${main.slice(0, start)}${body}\n${main.slice(end)}`
}
