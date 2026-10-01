import { describe, expect, it } from 'vitest'
import { lastRule } from '../../cascade/styleRules'

describe('flat Git branch overlays', () => {
  it('does not restore rounded outlined frames around Git branch menus', () => {
    const gitMenu = lastRule('.project-git-menu')
    const branchMenu = lastRule('.project-git-branch-menu')
    const branchOption = lastRule('.project-git-branch-option')
    const branchMeta = lastRule('.project-git-branch-option-meta b')

    expect(gitMenu).toContain('border: 0')
    expect(gitMenu).toContain('border-radius: 0')
    expect(branchMenu).toContain('border: 0')
    expect(branchMenu).toContain('border-radius: 0')
    expect(branchOption).toContain('border-radius: 0')
    expect(branchMeta).toContain('border: 0')
    expect(branchMeta).toContain('border-radius: 0')
  })
})
