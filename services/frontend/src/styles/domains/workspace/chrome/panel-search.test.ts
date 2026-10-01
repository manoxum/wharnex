import { describe, expect, it } from 'vitest'
import { lastRule } from '../../../cascade/styleRules'

describe('panel search controls CSS', () => {
  it('shares one polished search treatment across compact drawers and utility panels', () => {
    const field = lastRule('.panel-search-field')
    const focused = lastRule('.panel-search-field:focus-within')
    const input = lastRule('.panel-search-field input')
    const archiveCount = lastRule('.agent-archive-filter-count')
    const artifactControls = lastRule('.artifact-explorer-toolbar > select, .artifact-explorer-toolbar > button, .artifact-explorer-filters select, .artifact-explorer-filters input')

    expect(field).toContain('height: 38px')
    expect(field).toContain('border-radius: 10px')
    expect(field).toContain('background: color-mix')
    expect(focused).toContain('box-shadow: 0 0 0 2px')
    expect(input).toContain('background: transparent')
    expect(input).toContain('var(--ui-font-family)')
    expect(archiveCount).toContain('border-radius: 999px')
    expect(artifactControls).toContain('height: 38px')
    expect(artifactControls).toContain('border-radius: 10px')
  })
})
