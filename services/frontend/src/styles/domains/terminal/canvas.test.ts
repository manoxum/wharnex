import { describe, expect, it } from 'vitest'
import { terminalSource, lastRule } from '../../cascade/styleRules'

describe('terminal canvas and Agent chat strip refinement', () => {
  it('keeps the terminal inset on the active terminal theme instead of a dark frame', () => {
    expect(terminalSource).toContain('style={{ background: activeTerminalTheme().background }}')
    expect(terminalSource).toContain('const theme = activeTerminalTheme()')
    expect(terminalSource).toContain('terminalRootRef.current.style.background = theme.background')
  })

  it('lets the active chat resource tab occupy the full switcher height', () => {
    expect(lastRule('.agent-chat-switcher .chat-tabs')).toContain('height: 100%')
    expect(lastRule('.agent-chat-switcher .chat-tabs')).toContain('border-bottom: 0')
    expect(lastRule('.agent-chat-switcher .chat-tab-group')).toContain('height: 100%')
    expect(lastRule('.agent-chat-switcher .chat-tab-group')).toContain('min-height: 100%')
    expect(lastRule('.agent-chat-switcher .chat-tab,\n.agent-chat-switcher .chat-tab-remove')).toContain('height: 100%')
  })
})
