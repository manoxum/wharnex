import { tabBarSource, tabButtonSource } from '../../cascade/tabStyles'
import { describe, expect, it } from 'vitest'
import { lastRule } from '../../cascade/styleRules'

describe('terminal and editor execution CSS', () => {
  it('keeps terminal tabs compact without exposing the horizontal scrollbar', () => {
    const tabs = tabBarSource
    const activeTab = tabButtonSource
    expect(tabs).toContain('overflow-x-auto')
    expect(tabs).toContain('[scrollbar-width:none]')
    expect(tabs).toContain('[&::-webkit-scrollbar]:hidden')
    expect(activeTab).toContain('aria-selected:after:bg-[var(--theme-tab-active)]')
  })

  it('renders package script actions as a green play affordance in the Monaco gutter', () => {
    const glyph = lastRule('.editor-run-glyph::before')
    expect(glyph).toContain("content: '▶'")
    expect(glyph).toContain('color: #78b841')
  })
})
