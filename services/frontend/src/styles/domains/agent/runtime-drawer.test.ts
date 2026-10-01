import { describe, expect, it } from 'vitest'
import { css, lastRule, firstRule } from '../../cascade/styleRules'

describe('agent runtime drawer CSS', () => {
  it('groups health, capacity and instance details into a calm card hierarchy', () => {
    const summary = lastRule('.agent-runtime-summary')
    const memorySummary = firstRule('.agent-runtime-memory-summary')
    const diagnostics = firstRule('.agent-runtime-diagnostics')
    const diagnosticRow = lastRule('.agent-runtime-diagnostic-row')
    const scale = firstRule('.agent-runtime-scale')
    const body = firstRule('.agent-runtime-body')
    const activeAgent = lastRule('.agent-runtime-list > button.active')
    const detail = lastRule('.agent-runtime-detail')

    // Four tiles since the shared pool gained cross-project occupancy: an
    // agent busy with another project has to be countable here, or the panel
    // reports no free Workers beside cards that all look idle.
    expect(summary).toContain('grid-template-columns:repeat(4,minmax(0,1fr))')
    expect(memorySummary).toContain('grid-template-columns:repeat(5,minmax(0,1fr))')
    expect(diagnostics).toContain('grid-template-columns:repeat(3,minmax(0,1fr))')
    expect(diagnosticRow).toContain('border-radius:10px')
    expect(scale).toContain('grid-template-columns:repeat(2,minmax(0,1fr))')
    expect(body).toContain('gap:9px')
    expect(activeAgent).toContain('box-shadow:inset 4px 0 0 var(--agent-state)')
    expect(lastRule('.agent-runtime-list > button.state-writing')).toContain('--agent-state:#9b6cff')
    expect(lastRule('.agent-runtime-list > button.state-listening')).toContain('--agent-state:#16a6c9')
    expect(lastRule('.agent-runtime-list > button.state-chat-empty')).toContain('--agent-state:#3f86d9')
    expect(detail).toContain('border-radius:10px')
  })

  it('adapts to the drawer width instead of the desktop viewport', () => {
    const drawer = firstRule('.agent-runtime-drawer')

    expect(drawer).toContain('container-type:inline-size')
    expect(drawer).toContain('container-name:agent-runtime')
    expect(css).toContain('@container agent-runtime (max-width: 560px)')
    expect(css).toContain('grid-template-columns:repeat(2,minmax(0,1fr))')
    expect(css).toContain('@container agent-runtime (max-width: 410px)')
    expect(css).toContain('.agent-runtime-body { grid-template-columns:1fr; align-content:start; }')
    expect(css).toContain('.agent-runtime-tab-panel.agents { display:block; overflow:auto; }')
  })
})
