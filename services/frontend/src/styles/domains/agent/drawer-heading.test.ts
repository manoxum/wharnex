import { describe, expect, it } from 'vitest'
import { css, lastRule } from '../../cascade/styleRules'

describe('drawer heading actions CSS', () => {
  it('keeps heading controls horizontal and out of the project tree hit area', () => {
    const title = lastRule('.agent-drawer-heading > div:first-child')
    const actions = lastRule('.agent-drawer-heading > .agent-runtime-heading-actions')

    expect(title).toContain('display: grid')
    expect(actions).toContain('display: flex')
    expect(actions).toContain('flex: 0 0 auto')
    expect(css).not.toContain('.agent-drawer-heading > div {')
  })
})
