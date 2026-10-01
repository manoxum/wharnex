import { describe, expect, it } from 'vitest'
import { css, lastRule } from '../../../cascade/styleRules'

describe('premium optical refinement', () => {
  it('separates icon optics from hit areas across rails, Explorer and tool windows', () => {
    expect(css).toContain('/* v1.2.53 — premium optical refinement')
    expect(css).toContain('--icon-sm: 16px')
    expect(lastRule('.workspace-main-row > .agent-activity-bar')).toContain('width: 46px')
    expect(lastRule('.workspace-main-row > .agent-activity-bar button')).toContain('width: 40px')
    expect(lastRule('.workspace-main-row > .agent-activity-bar button')).toContain('height: 38px')
    expect(lastRule('.workspace-main-row > .agent-activity-bar button > svg')).toContain('width: 20px')
    expect(lastRule('.workspace-main-row > .workspace-side-rail .workspace-rail-pinned button > svg')).toContain('width: 20px')
    expect(lastRule(".workspace-main-row > .workspace-side-rail button[data-pinned='true']:not(.active)::after")).toContain('display: none')
    expect(lastRule('.workspace-main-row > .workspace-side-rail .workspace-rail-pin-target')).toContain('opacity: 0')
    expect(lastRule('.agent-tree-chevron > svg')).toContain('width: var(--icon-xs)')
    expect(lastRule('.workbench-status-bar')).toContain('font: 600 var(--ui-meta-size)/1 var(--ui-font-family)')
  })

  it('keeps Terminal frequent actions visible while rare actions use one compact overflow', () => {
    expect(lastRule('.terminal-tab-action')).toContain('width: var(--toolbar-hit)')
    expect(lastRule('.terminal-overflow-menu')).toContain('min-width: 176px')
    expect(lastRule('.terminal-overflow-menu button')).toContain('height: 30px')
    expect(lastRule('.terminal-tabs')).toContain('overflow-x: auto')
    expect(lastRule('.terminal-tabs')).toContain('scrollbar-width: none')
  })

  it('uses the same optical hierarchy for Docker, Library and Database Studio', () => {
    expect(lastRule('.docker-services-header')).toContain('min-height: 48px')
    expect(lastRule('.artifact-explorer-heading')).toContain('min-height: 46px')
    expect(lastRule('.artifact-explorer-heading strong')).toContain('font-size: var(--module-title-size)')
    expect(lastRule('.database-studio-header')).toContain('background: var(--theme-surface)')
    expect(lastRule('.database-workspace-tabs button')).toContain('font-size: var(--ui-text-size)')
  })
})
