import { describe, expect, it } from 'vitest'
import { css, lastRule } from '../../../cascade/styleRules'

describe('workspace readability and Git focus CSS', () => {
  it('routes every legacy micro font at or below 10px through the UI scale', () => {
    const directSmall = [...css.matchAll(/font-size\s*:\s*(\d+(?:\.\d+)?)px/g)].filter((match) => Number(match[1]) <= 10)
    const shorthandSmall = [...css.matchAll(/font\s*:\s*([^;]+);/g)].filter((match) => {
      if (match[1].includes('var(--ui-font-scale)')) return false
      const size = match[1].match(/(?:^|\s)(\d+(?:\.\d+)?)px/)
      return Boolean(size && Number(size[1]) <= 10)
    })
    expect(directSmall).toEqual([])
    expect(shorthandSmall).toEqual([])
  })

  it('keeps Git file state visible in Explorer and Editor without relying on colour alone', () => {
    expect(lastRule('.agent-project-git-summary')).toContain('var(--ui-font-scale)')
    expect(lastRule('.agent-tree-git-status')).toContain('display: inline-flex')
    expect(lastRule('.editor-git-file-state')).toContain('display: inline-flex')
    expect(lastRule('.agent-tree-row.git-changed::before')).toContain('width: 2px')
  })
})
