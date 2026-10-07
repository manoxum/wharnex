import { chatTabsSource, tabBarSource, tabButtonSource } from '../../cascade/tabStyles'
import { describe, expect, it } from 'vitest'
import { terminalSource } from '../../cascade/styleRules'

describe('terminal canvas and Agent chat strip refinement', () => {
  it('keeps the terminal inset on the active terminal theme instead of a dark frame', () => {
    expect(terminalSource).toContain('style={{ background: activeTerminalTheme().background }}')
    expect(terminalSource).toContain('const theme = activeTerminalTheme()')
    expect(terminalSource).toContain('terminalRootRef.current.style.background = theme.background')
  })

  it('lets the active chat resource tab occupy the full switcher height', () => {
    expect(chatTabsSource).toContain('<TabBar appearance="conversation" label="Conversas abertas"')
    expect(tabButtonSource).toContain('[.agent-chat-switcher_&]:h-full')
    expect(tabBarSource).toContain('min-h-10')
    expect(tabButtonSource).toContain('min-h-[39px]')

  })
})
