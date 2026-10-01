import { describe, expect, it } from 'vitest'
import { lastRule } from '../../cascade/styleRules'

describe('execution output CSS', () => {
  it('uses stream-aware rows and a distinct stderr background without visible prefixes', () => {
    const segment = lastRule('.execution-output-segment')
    const stderr = lastRule('.execution-output-segment.stderr')

    expect(segment).toContain('white-space: pre-wrap')
    expect(segment).toContain('background: transparent')
    expect(stderr).toContain('background: rgba(184,110,102,.16)')
  })
})
