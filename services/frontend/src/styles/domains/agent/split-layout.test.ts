import { describe, expect, it } from 'vitest'
import { css, lastRule, firstRule } from '../../cascade/styleRules'
import { allocateSupportingPanels, primaryWorkspaceReserve } from '../../../components/workspace/shell/layout/panelAllocation'
import splitterSource from '../../../components/agent/workspace/AgentWorkspaceSplitter.tsx?raw'

describe('split Agent layout CSS', () => {
  it('keeps the resizable split while moving Agent shortcuts into a dedicated right rail', () => {
    const splitLayout = css.slice(css.lastIndexOf('/* v1.2.47'))
    expect(splitLayout).toContain('--agent-tools-width: 42px')
    expect(splitLayout).toContain('--agent-chat-width: calc((100% - 48px) * 0.6)')
    // The centre panel carries no pixel floor of its own, in either column.
    // Pixel floors here (and the matching 886px reserve the drawer drag used
    // to keep) were what made the centre the one panel an operator could not
    // shrink: both side drawers stopped dead the moment the centre reached
    // that width, on every screen size.
    expect(splitLayout).toContain('grid-template-columns: minmax(0, var(--agent-chat-width)) 6px minmax(0, 1fr) var(--agent-tools-width)')
    expect(splitLayout).toContain('grid-template-rows: 42px minmax(0, 1fr)')
    expect(splitLayout).toContain('.agent-commandbar {')
    expect(splitLayout).toContain('grid-column: 4')
    expect(splitLayout).toContain('grid-row: 1 / 3')
    expect(splitLayout).toContain('flex-direction: column')
    expect(splitLayout).toContain('.agent-chat-switcher { grid-column: 1 / 4; grid-row: 1; }')
    expect(splitLayout).toContain('.agent-chat-stage { grid-column: 1; grid-row: 2; }')
    expect(splitLayout).toContain('.agent-inspector-stage { grid-column: 3; grid-row: 2; }')
    expect(splitterSource).toContain('col-start-2 row-start-3')
    expect(css).not.toContain('.agent-splitter {')
    expect(splitLayout).toContain('.agent-commandbar .agent-attention-popover { right: calc(100% + 8px); top: 0; }')
    expect(splitLayout).toContain('grid-template-rows: repeat(4, 42px)')
    expect(lastRule('.topbar-indicator')).toContain('width: 27px')
  })

  // The floors were spread over five rules in three cascade layers, so the
  // last and most specific one kept reimposing 480 + 6 + 400 = 886px after the
  // earlier ones had already been relaxed. Assert every one of them.
  it('leaves the centre panel free to shrink, with no width floor in any layer', () => {
    expect(lastRule('.workspace-mode-surface > .agent-workspace')).toContain('min-width: 0')
    expect(lastRule('.workspace-mode-surface > .agent-workspace')).not.toContain('100vw / 3')
    expect(css).not.toContain('min-width: calc(100vw / 3)')
    // Supporting panels now project their saved widths around the primary
    // workspace, instead of relying on a uniform CSS fifth for every tool.
    const panels = allocateSupportingPanels(1280, 100, { tool: 'project', preferred: 400 }, { tool: 'docker', preferred: 600 })
    expect(panels.left + panels.right + primaryWorkspaceReserve(1280)).toBeLessThanOrEqual(1181)
    expect(panels.right).toBeGreaterThan(panels.left)
    expect(lastRule('.agent-workspace.agent-rail-unified')).toContain('grid-template-columns:minmax(0,var(--agent-chat-width)) 6px minmax(0,1fr)')
    // The right drawer refused to shrink at all, so the centre absorbed every
    // pixel of layout pressure by itself.
    expect(firstRule('.workspace-right-drawer')).toContain('flex: 0 1 ')
    // An `!important` floor here beat every later rule, so no drag could push
    // the centre past it.
    expect(css).not.toContain('min-width: 360px !important')
  })
})
