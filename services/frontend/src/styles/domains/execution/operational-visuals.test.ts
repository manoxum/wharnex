import { describe, expect, it } from 'vitest'
import { lastRule } from '../../cascade/styleRules'

describe('operational surface visual hierarchy', () => {
  it('keeps execution errors and evidence in quiet IDE lists', () => {
    expect(lastRule('.execution-errors-summary > span')).toContain('border-radius: 0')
    expect(lastRule('.execution-errors-list > button')).toContain('border-radius: 0')
    expect(lastRule('.evidence-metric')).toContain('border-radius: 0')
    expect(lastRule('.evolution-event-list article')).toContain('border-radius: 0')
  })
})
