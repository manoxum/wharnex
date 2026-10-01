import { describe, expect, it } from 'vitest'
import { css, lastRule, firstRule } from '../../cascade/styleRules'

describe('editor search palette CSS', () => {
  it('renders global search and double-shift file lookup as compact IDE overlays', () => {
    const backdrop = firstRule('.editor-search-backdrop')
    const palette = firstRule('.editor-search-palette')
    const input = lastRule('.editor-search-input')
    const options = lastRule('.editor-search-options button')
    const result = lastRule(".editor-search-results > button[role='option']")

    expect(backdrop).toContain('position: fixed')
    expect(backdrop).toContain('place-items: start center')
    expect(palette).toContain('width: min(760px, calc(100vw - 40px))')
    expect(palette).toContain('border-radius: 13px')
    expect(input).toContain('grid-template-columns: auto minmax(0, 1fr) auto')
    expect(options).toContain('white-space: nowrap')
    expect(result).toContain('grid-template-columns: 20px minmax(0, 1fr)')
    expect(lastRule('.editor-search-input input')).toContain('font-size: calc(13px * var(--ui-font-scale))')
    expect(lastRule(".editor-search-results > button[role='option'] strong")).toContain('font-size: calc(12.5px * var(--ui-font-scale))')
    expect(css).toContain(".editor-search-options button[aria-pressed='true']")
  })
})
