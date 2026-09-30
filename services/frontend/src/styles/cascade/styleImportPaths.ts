import { readFileSync } from 'node:fs'
import { dirname, relative, resolve } from 'node:path'

/** Lists stylesheets reachable from an entry point in their cascade order. */
export function styleImportPaths(relativeEntry: string): string[] {
  const root = resolve(process.cwd(), 'src')
  const found: string[] = []
  function visit(path: string) {
    const source = readFileSync(path, 'utf8')
    found.push(relative(root, path).replaceAll('\\', '/'))
    for (const [, imported] of source.matchAll(/^@import '([^']+)';$/gm)) {
      visit(resolve(dirname(path), imported))
    }
  }
  visit(resolve(root, relativeEntry))
  return found
}
