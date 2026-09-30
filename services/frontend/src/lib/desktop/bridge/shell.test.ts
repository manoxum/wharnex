import { describe, expect, it } from 'vitest'
import { parseArgv } from './shell'

describe('parseArgv', () => {
  it('parses quoted arguments without a shell', () => {
    expect(parseArgv('go test "./internal/my package"')).toEqual(['go', 'test', './internal/my package'])
  })
  it('rejects unclosed quotes', () => {
    expect(() => parseArgv('git "status')).toThrow(/Aspas/)
  })
})
