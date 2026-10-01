import { describe, expect, it } from 'vitest'
import { lastRule } from '../../../cascade/styleRules'

describe('workspace panel toolbar CSS', () => {
  it('pins the shared controls to the upper-right edge of every side panel', () => {
    const toolbar = lastRule('.workspace-panel-toolbar')
    const button = lastRule('.workspace-panel-toolbar button')

    expect(toolbar).toContain('position: absolute')
    expect(toolbar).toContain('top: 6px')
    expect(toolbar).toContain('right: 7px')
    expect(toolbar).toContain('display: inline-flex')
    expect(button).toContain('width: var(--toolbar-hit)')
    expect(button).toContain('height: var(--toolbar-hit)')
  })
})
