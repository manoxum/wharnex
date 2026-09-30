import { describe, expect, it } from 'vitest'
import { css, lastRule, firstRule } from '../../cascade/styleRules'

describe('bootstrap composer CSS', () => {
  it('centers the project pill and keeps Chat and Orchestrator in one compact switch', () => {
    const topline = firstRule('.bootstrap-composer-topline')
    const project = firstRule('.bootstrap-project-name')
    const projectInput = lastRule('.bootstrap-project-name input')
    const modes = firstRule('.bootstrap-entry-modes')
    const modeButton = lastRule('.bootstrap-entry-modes > button')

    expect(topline).toContain('grid-template-columns:minmax(0,1fr) minmax(240px,360px) minmax(0,1fr)')
    expect(project).toContain('justify-self:center')
    expect(project).toContain('border-radius:999px')
    expect(projectInput).toContain('font:650 calc(8.6px * var(--ui-font-scale))')
    expect(projectInput).toContain('text-align:center')
    expect(modes).toContain('display:inline-flex')
    expect(modes).toContain('border-radius:999px')
    expect(modeButton).toContain('border-radius:999px')
    expect(css).not.toContain('.bootstrap-destination {')
  })
})
