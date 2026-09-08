import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const source = readFileSync(resolve(process.cwd(), 'src/App.tsx'), 'utf8')

describe('App bundle routing', () => {
  it('classifies a bundle with no pending workspace owner as a non-terminal routing duplicate', () => {
    const routingCheck = source.indexOf('if (!targetSession || !targetChat)')
    expect(routingCheck).toBeGreaterThan(-1)
    expect(source.slice(routingCheck, routingCheck + 360)).toContain('throw new BundleRoutingError')

    const catchBranch = source.indexOf('if (isNonTerminalBundleRoutingError(e))')
    expect(catchBranch).toBeGreaterThan(-1)
    expect(source.slice(catchBranch, catchBranch + 260)).toContain('Bundle atrasado ou duplicado ignorado.')
  })
})
