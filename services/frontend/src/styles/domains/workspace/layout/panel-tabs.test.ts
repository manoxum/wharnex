import { describe, expect, it } from 'vitest'
import { css, lastRule } from '../../../cascade/styleRules'

describe('semantic panel tabs CSS', () => {
  it('keeps TODO and Git tabs on one row and collapses labels by strip width', () => {
    const todoTabs = lastRule('.project-todo-tabs')
    const gitTabs = lastRule('.git-tabs')
    const label = lastRule('.semantic-tab-label')

    expect(todoTabs).toContain('grid-template-columns: repeat(5, minmax(0, 1fr))')
    expect(gitTabs).toContain('grid-template-columns: repeat(5, minmax(0, 1fr))')
    expect(gitTabs).not.toContain('grid-template-columns: repeat(4, minmax(0, 1fr))')
    expect(label).toContain('white-space: nowrap')
    expect(css).toContain('container-name: semantic-panel')
    expect(css).toContain('@container semantic-panel (max-width: 520px)')
    expect(css).toContain('@container semantic-panel (max-width: 420px)')
    expect(css).toContain('clip-path: inset(50%)')
    expect(css).toContain('@container semantic-panel (max-width: 340px)')
  })
})
