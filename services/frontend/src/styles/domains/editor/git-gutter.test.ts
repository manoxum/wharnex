import { describe, expect, it } from 'vitest'
import { lastRule } from '../../cascade/styleRules'

describe('editor Git and Compose gutter CSS', () => {
  it('keeps clickable Git blocks and Compose runtime state visible in the editor gutter', () => {
    const marker = lastRule('.editor-git-change-marker')
    const added = lastRule('.editor-git-change-marker-added')
    const compose = lastRule('.editor-compose-glyph')
    const running = lastRule('.editor-compose-glyph.state-running')

    expect(marker).toContain('cursor: pointer')
    expect(added).toContain('var(--theme-success)')
    expect(compose).toContain('position: relative')
    expect(running).toContain('var(--theme-success)')
  })
})
