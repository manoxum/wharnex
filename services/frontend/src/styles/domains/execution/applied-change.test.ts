import { describe, expect, it } from 'vitest'
import { lastRule } from '../../cascade/styleRules'

describe('applied change summary CSS', () => {
  it('renders the total deletion count with the same red tone as file deletions', () => {
    const totalDeletions = lastRule('.change-summary-card > header > code i')
    expect(totalDeletions).toContain('color: #a05249')
    expect(totalDeletions).toContain('font-style: normal')
  })
})
