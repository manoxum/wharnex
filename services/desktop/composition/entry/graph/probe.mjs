import { composeDesktop } from '../stages/index.mjs'

// Composes the Desktop exactly as main.mjs does and reports the shape of every
// dependency the entry point runtime receives.
function shape(value) {
  if (value === null || value === undefined) return String(value)
  if (typeof value === 'object') return `object:${Object.getPrototypeOf(value)?.constructor?.name ?? 'null'}`
  return typeof value
}

const desktop = composeDesktop(new URL('../../../main.mjs', import.meta.url).href)
const shapes = Object.fromEntries(Object.keys(desktop).map((key) => [key, shape(desktop[key])]))
process.stdout.write(`${JSON.stringify(shapes)}\n`, () => process.exit(0))
