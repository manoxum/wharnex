import { describe, expect, it } from 'vitest'
import { lastRule } from '../../cascade/styleRules'

describe('archived chats drawer CSS', () => {
  it('keeps sparse chat cards compact and aligned to the top', () => {
    const list = lastRule('.agent-archive-list')
    const card = lastRule('.agent-archive-item')
    const empty = lastRule('.agent-archive-empty')

    expect(list).toContain('align-content: start')
    expect(list).toContain('grid-auto-rows: max-content')
    expect(card).toContain('border: 1px solid var(--theme-border-soft)')
    expect(card).toContain('background: var(--theme-surface)')
    expect(empty).toContain('border: 1px dashed var(--theme-border)')
  })
})
