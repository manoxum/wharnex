import { describe, expect, it } from 'vitest'
import { css } from '../../../cascade/styleRules'

describe('quiet premium workbench design system', () => {
  it('defines one restrained geometry scale and removes card chrome from core IDE surfaces', () => {
    expect(css).toContain('--control-md: 32px')
    expect(css).toContain('--radius-control: 4px')
    expect(css).toContain('/* v1.2.49 — quiet premium workbench grammar.')
    expect(css).toContain('.workspace-main-row > .agent-activity-bar button.active:not(:disabled)')
    expect(css).toContain('background: transparent')
    expect(css).toContain('.terminal-workspace:focus-within')
    expect(css).toContain('border-top-color: color-mix(in srgb, var(--theme-accent) 45%, var(--theme-border))')
    expect(css).toContain('.settings-premium-card:is(section, div)')
    expect(css).toContain('.agent-runtime-list > button.active:not(:disabled)')
    expect(css).toContain('box-shadow: inset 2px 0 var(--agent-state)')
  })

  it('keeps scrollbars quiet and universal actions compact', () => {
    expect(css).toContain('.workspace-body *::-webkit-scrollbar { width: 4px; height: 4px; }')
    expect(css).toContain('.editor-tabbar .editor-save {')
    expect(css).toContain('width: var(--control-sm)')
    expect(css).toContain('border-radius: var(--radius-control)')
  })
})
