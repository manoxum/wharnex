import { describe, expect, it } from 'vitest'
import { lastRule } from '../../cascade/styleRules'

describe('operational surface visual hierarchy', () => {
  it('flattens library, execution errors and evidence into quiet IDE lists', () => {
    expect(lastRule('.file-library-card')).toContain('border-radius: 4px')
    expect(lastRule('.file-library-card')).toContain('box-shadow: none')
    expect(lastRule('.file-library-grid')).toContain('grid-auto-rows: max-content')
    const bundleCard = lastRule('.file-library-card.file-library-bundle-card')
    expect(bundleCard).toContain('aspect-ratio: 1 / 1')
    expect(bundleCard).toContain('border-radius: 12px')
    expect(lastRule('.file-library-card.file-library-bundle-card:hover')).toContain('transform: translateY(-2px)')
    expect(lastRule('.execution-errors-summary > span')).toContain('border-radius: 0')
    expect(lastRule('.execution-errors-list > button')).toContain('border-radius: 0')
    expect(lastRule('.evidence-metric')).toContain('border-radius: 0')
    expect(lastRule('.evolution-event-list article')).toContain('border-radius: 0')
  })
})
