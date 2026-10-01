import { describe, expect, it } from 'vitest'
import { css, lastRule } from '../../../cascade/styleRules'

describe('side tool windows and Git visual consolidation', () => {
  it('keeps side drawers on one chrome system and Git free of nested horizontal scroll', () => {
    expect(css).toContain('/* v1.2.51 — unified side tool windows, Git surface and Explorer glyphs.')
    expect(lastRule('.workspace-side-drawer .agent-drawer-heading')).toContain('height: 40px')
    expect(lastRule('.workspace-side-drawer .agent-drawer-heading')).toContain('background: var(--theme-surface)')
    expect(lastRule('.file-glyph-mark')).toContain('border: 1px solid color-mix')
    expect(lastRule('.file-glyph-mark')).toContain('font: 750 calc(6.2px * var(--ui-font-scale))')
    expect(lastRule('.git-tabs')).toContain('overflow: hidden')
    expect(lastRule('.git-tab-content')).toContain('overflow-x: hidden')
    expect(lastRule('.git-section')).toContain('border: 1px solid var(--theme-border-soft)')
    expect(lastRule('.git-section')).toContain('background: var(--theme-surface)')
  })
})
