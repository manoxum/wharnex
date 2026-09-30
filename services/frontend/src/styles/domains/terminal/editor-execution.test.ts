import { describe, expect, it } from 'vitest'
import { css, lastRule } from '../../cascade/styleRules'

describe('terminal and editor execution CSS', () => {
  it('keeps terminal tabs compact without exposing the horizontal scrollbar', () => {
    const tabs = lastRule('.terminal-tabs')
    const activeTab = lastRule('.terminal-tab-shell.active')
    expect(tabs).toContain('overflow-x: auto')
    expect(tabs).toContain('scrollbar-width: none')
    expect(css).toContain('.terminal-tabs::-webkit-scrollbar { display: none; }')
    expect(activeTab).toContain('box-shadow: inset 0 -2px var(--theme-accent)')
  })

  it('renders package script actions as a green play affordance in the Monaco gutter', () => {
    const glyph = lastRule('.editor-run-glyph::before')
    expect(glyph).toContain("content: '▶'")
    expect(glyph).toContain('color: #78b841')
  })
})
