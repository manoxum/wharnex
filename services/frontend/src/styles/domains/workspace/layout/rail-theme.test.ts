import { describe, expect, it } from 'vitest'
import { css, lastRule, firstRule } from '../../../cascade/styleRules'

describe('workbench rail and theme integrity CSS', () => {
  it('keeps styles.css structurally balanced so theme.css is never captured by a responsive block', () => {
    const opens = [...css.matchAll(/\{/g)].length
    const closes = [...css.matchAll(/\}/g)].length
    expect(opens).toBe(closes)
  })

  it('removes the extra Agent column when shortcuts use the existing workspace rail', () => {
    const unified = firstRule('.agent-workspace.agent-rail-unified')
    const slot = firstRule('.workspace-agent-rail-slot')
    // No pixel floor in either column: this was the last and most specific of
    // the rules pinning the centre's width, so it kept reimposing 886px after
    // the earlier ones had been relaxed.
    expect(lastRule('.agent-workspace.agent-rail-unified')).toContain('grid-template-columns:minmax(0,var(--agent-chat-width)) 6px minmax(0,1fr)')
    expect(unified).not.toContain('var(--agent-tools-width)')
    expect(slot).toContain('flex: 1 1 auto')
    expect(slot).toContain('border-top: 1px solid var(--theme-border)')
  })

  it('keeps the tunnel overview compact and gives the empty state its own hierarchy', () => {
    const modal = lastRule('.tunnel-overview')
    const empty = lastRule('.tunnel-empty')
    expect(modal).toContain('width: min(560px, calc(100vw - 32px))')
    expect(modal).toContain('border-radius: 12px')
    expect(empty).toContain('min-height: 138px')
    expect(empty).toContain('align-content: center')
  })
})
