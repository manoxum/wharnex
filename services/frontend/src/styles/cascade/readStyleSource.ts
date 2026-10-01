import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'

/** Reconstructs source order for style assertions after a sheet is split into imports. */
export function readStyleSource(relative: string): string {
  const path = resolve(process.cwd(), 'src', relative)
  const source = readFileSync(path, 'utf8')
  return source.replace(/^@import '([^']+)';\n/gm, (_, imported: string) => {
    const child = resolve(dirname(path), imported)
    return readStyleSourceFromPath(child)
  })
}

function readStyleSourceFromPath(path: string): string {
  const source = readFileSync(path, 'utf8')
  return source.replace(/^@import '([^']+)';\n/gm, (_, imported: string) => {
    return readStyleSourceFromPath(resolve(dirname(path), imported))
  })
}
