import { describe, expect, it } from 'vitest'
import { css, lastRule, firstRule } from '../../cascade/styleRules'

describe('chat header CSS', () => {
  it('keeps the active chat header fixed while the transcript scrolls', () => {
    const header = firstRule('.chat-header')
    const stream = lastRule('.chat-stream')
    expect(header).toContain('position: sticky')
    expect(header).toContain('top: 0')
    expect(header).toContain('z-index: 12')
    expect(stream).toContain('overflow-x: hidden')
    expect(stream).toContain('overflow-y: auto')
  })

  it('keeps context identity, state and export in one compact header cluster', () => {
    const context = firstRule('.chat-header-context')
    const actions = firstRule('.chat-header-context-actions')
    const iconActions = firstRule('.chat-header-context-copy-button, .chat-header-context .chat-export-button')
    expect(context).toContain('max-width: min(300px, 42vw)')
    expect(context).toContain('display: flex')
    expect(actions).toContain('margin-left: auto')
    expect(iconActions).toContain('width: 28px')
    expect(iconActions).toContain('height: 28px')
    expect(css).not.toContain('.chat-header-context-copy {')
    expect(css).not.toContain('.chat-header-context small {')
  })

  it('keeps the bundle strip dedicated to recent bundle cards', () => {
    const strip = lastRule('.bundle-exchange-bar')
    expect(strip).toContain('grid-template-columns:minmax(0, 1fr)')
    expect(css).not.toContain('.bundle-exchange-summary')
    expect(css).not.toContain('.bundle-quota-indicator')
  })
})
