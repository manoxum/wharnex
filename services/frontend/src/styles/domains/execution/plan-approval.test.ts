import { describe, expect, it } from 'vitest'
import { lastRule, firstRule } from '../../cascade/styleRules'

describe('plan approval actions CSS', () => {
  it('keeps plan decisions compact, theme-aware and visually hierarchical', () => {
    const approval = lastRule('.plan-approval')
    const actions = firstRule('.message-plan > .plan-approval.plan-pending > div:last-child')
    const buttons = lastRule('.message-plan > .plan-approval.plan-pending > div:last-child > button')
    const primary = lastRule('.message-plan > .plan-approval.plan-pending > div:last-child > .apply-button')

    expect(approval).toContain('border-radius: 12px')
    expect(approval).toContain('var(--theme-elevated)')
    expect(actions).toContain('border-radius: 10px')
    expect(buttons).toContain('min-height: 29px')
    expect(primary).toContain('background: var(--theme-accent)')
    expect(primary).toContain('color: var(--theme-bg)')
  })
})
